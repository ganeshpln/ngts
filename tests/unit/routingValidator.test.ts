/**
 * Unit tests for the routing_decision_validator (prompt 5).
 *
 * The property that matters throughout: nothing malformed, missing or ambiguous may ever be read
 * as agreement. Agreement has to be explicit, because it is the only thing that lets a medium-band
 * multi-intent email be handled automatically.
 */

import { describe, expect, it } from 'vitest';

import { parseValidatorVerdict, shouldConsultValidator } from '../../src/classification/routingValidator.js';
import { MAX_REASONING_SUMMARY_CHARS } from '../../src/classification/schemaValidator.js';

const parse = (raw: unknown) => parseValidatorVerdict(raw, '1.0.0', 12);

describe('parsing a validator verdict', () => {
  it('accepts a well-formed agreement', () => {
    const result = parse({ agrees: true, confidence: 0.88, concern: null, suggestedScenarioId: null, injectionSuspected: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agrees).toBe(true);
      expect(result.value.promptVersion).toBe('1.0.0');
      expect(result.value.latencyMs).toBe(12);
    }
  });

  it('accepts a disagreement carrying a concern and an advisory suggestion', () => {
    const result = parse({
      agrees: false,
      confidence: 0.7,
      concern: 'The email also raises a manager change.',
      suggestedScenarioId: 'SC-03',
      injectionSuspected: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agrees).toBe(false);
      expect(result.value.concern).toContain('manager change');
      expect(result.value.suggestedScenarioId).toBe('SC-03');
    }
  });

  it('rejects a missing agrees field rather than assuming agreement', () => {
    const result = parse({ confidence: 0.9, concern: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((v) => v.path === 'agrees')).toBe(true);
  });

  it('rejects a non-boolean agrees field', () => {
    expect(parse({ agrees: 'yes' }).ok).toBe(false);
    expect(parse({ agrees: 1 }).ok).toBe(false);
    expect(parse({ agrees: null }).ok).toBe(false);
  });

  it('rejects output that is not a JSON object', () => {
    expect(parse('agrees').ok).toBe(false);
    expect(parse(null).ok).toBe(false);
    expect(parse([{ agrees: true }]).ok).toBe(false);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(parse({ agrees: true, confidence: 1.4 }).ok).toBe(false);
    expect(parse({ agrees: true, confidence: -1 }).ok).toBe(false);
  });

  it('rejects a suggested scenario outside the closed set', () => {
    expect(parse({ agrees: false, suggestedScenarioId: 'SC-42' }).ok).toBe(false);
  });

  it('rejects an over-long concern as suspected reasoning disclosure (Rule 11)', () => {
    const long = 'x'.repeat(MAX_REASONING_SUMMARY_CHARS + 1);
    const result = parse({ agrees: false, concern: long });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((v) => v.path === 'concern')).toBe(true);
  });

  it('treats an empty concern as absent', () => {
    const result = parse({ agrees: true, concern: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.concern).toBeNull();
  });

  it('tolerates the optional fields being omitted entirely', () => {
    const result = parse({ agrees: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.confidence).toBe(0);
      expect(result.value.concern).toBeNull();
      expect(result.value.suggestedScenarioId).toBeNull();
      expect(result.value.injectionSuspected).toBe(false);
    }
  });

  it('carries an injection flag raised by the validator itself', () => {
    const result = parse({ agrees: false, injectionSuspected: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.injectionSuspected).toBe(true);
  });
});

describe('deciding whether to consult the validator', () => {
  const both = { onMediumBand: true, onMultiIntent: true };

  it('never asks about a LOW-band item, which is already bound for a human', () => {
    expect(shouldConsultValidator('LOW', false, both)).toBe(false);
    expect(shouldConsultValidator('LOW', true, both)).toBe(false);
  });

  it('asks about a medium-band item', () => {
    expect(shouldConsultValidator('MEDIUM', false, both)).toBe(true);
  });

  it('asks about a multi-intent item even at high confidence', () => {
    expect(shouldConsultValidator('HIGH', true, both)).toBe(true);
  });

  it('does not ask about a straightforward high-confidence single-intent item', () => {
    expect(shouldConsultValidator('HIGH', false, both)).toBe(false);
  });

  it('honours each trigger being switched off independently', () => {
    expect(shouldConsultValidator('MEDIUM', false, { onMediumBand: false, onMultiIntent: true })).toBe(false);
    expect(shouldConsultValidator('HIGH', true, { onMediumBand: true, onMultiIntent: false })).toBe(false);
    expect(shouldConsultValidator('MEDIUM', true, { onMediumBand: false, onMultiIntent: true })).toBe(true);
  });
});
