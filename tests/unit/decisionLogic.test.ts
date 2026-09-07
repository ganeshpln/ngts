import { describe, expect, it } from 'vitest';

import { assessConfidence, bandFor, meetsBandForAction, mediumBandPermitsAutomation, thresholdsFor } from '../../src/classification/confidence.js';
import { corroborate } from '../../src/classification/corroborator.js';
import { findMissingRequiredEntities, validateEntities } from '../../src/classification/entityValidator.js';
import { resolveMultiIntent } from '../../src/classification/multiIntentResolver.js';
import { resolveProgram } from '../../src/classification/programResolver.js';
import { extractJsonObject, validateClassification } from '../../src/classification/schemaValidator.js';
import { getActionDefinition, isApprovedAction, missingParameters, registryIsComplete } from '../../src/actions/actionRegistry.js';
import { resolveRouting, selectRule } from '../../src/routing/routingResolver.js';
import { renderTemplate, resolveTemplate } from '../../src/templates/templateResolver.js';
import { resolveRegion } from '../../src/reporting/regionResolver.js';
import { buildWeeklyReport, weekWindowFor } from '../../src/reporting/weeklyReport.js';
import { validateConfiguration } from '../../src/configuration/validate.js';
import { JsonConfigurationStore } from '../../src/configuration/jsonConfigurationStore.js';
import { normaliseEmail } from '../../src/email/normalizer.js';
import { makeClassification, makeEmail } from '../helpers/fixtures.js';

const store = new JsonConfigurationStore();
const opts = { maxBodyChars: 20000, maxSubjectChars: 500 };

describe('configuration validation', () => {
  it('accepts the shipped configuration', async () => {
    const report = await validateConfiguration(store);
    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('reports the open gaps as warnings so they stay visible at every startup', async () => {
    const report = await validateConfiguration(store);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('CFG-060'); // region mapping empty - GAP-012
    expect(codes).toContain('CFG-061'); // no report recipients - GAP-014
    expect(codes).toContain('CFG-062'); // shadow mode on
  });

  it('rejects a scenario that permits deletion outside SC-08 (Rule 15)', async () => {
    const mutated = new JsonConfigurationStore();
    await mutated.override('scenarios.json', (doc) => {
      const sc01 = doc.scenarios.find((s: { scenarioId: string }) => s.scenarioId === 'SC-01');
      sc01.deleteAllowed = true;
      sc01.allowedActions.push('DeleteEmail');
    });
    const report = await validateConfiguration(mutated);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'CFG-002')).toBe(true);
  });

  it('rejects an action that is not in the approved set', async () => {
    const mutated = new JsonConfigurationStore();
    await mutated.override('scenarios.json', (doc) => {
      doc.scenarios[0].allowedActions.push('TransferFunds');
    });
    const report = await validateConfiguration(mutated);
    expect(report.issues.some((i) => i.code === 'CFG-001')).toBe(true);
  });

  it('becomes fatal about inactive templates only once sending is switched on', async () => {
    const mutated = new JsonConfigurationStore();
    await mutated.override('application.json', (doc) => {
      doc.features.sendResponsesEnabled.value = true;
    });
    const report = await validateConfiguration(mutated);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === 'CFG-018' && i.severity === 'error')).toBe(true);
  });
});

describe('classification schema validation', () => {
  it('accepts a well-formed classification', () => {
    expect(validateClassification(makeClassification()).ok).toBe(true);
  });

  it('rejects a scenario identifier outside the closed set', () => {
    const result = validateClassification({ ...makeClassification(), scenarioId: 'SC-42' });
    expect(result.ok).toBe(false);
  });

  it('rejects an action outside the approved set (threat T-15)', () => {
    const result = validateClassification({ ...makeClassification(), recommendedAction: 'TransferFunds' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((v) => v.path === 'recommendedAction')).toBe(true);
  });

  it('rejects an over-long reasoning summary as suspected reasoning disclosure (Rule 11)', () => {
    const result = validateClassification({ ...makeClassification(), reasoningSummary: 'x'.repeat(601) });
    expect(result.ok).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(validateClassification({ ...makeClassification(), confidence: 1.5 }).ok).toBe(false);
    expect(validateClassification({ ...makeClassification(), confidence: -0.1 }).ok).toBe(false);
  });

  it('rejects non-object output outright', () => {
    expect(validateClassification('not json').ok).toBe(false);
    expect(validateClassification(null).ok).toBe(false);
    expect(validateClassification([1, 2]).ok).toBe(false);
  });

  it('coerces nothing: an unparseable entity is rejected, not fixed', () => {
    const result = validateClassification({
      ...makeClassification(),
      extractedEntities: { ...makeClassification().extractedEntities, gpid: 123 },
    });
    expect(result.ok).toBe(false);
  });

  it('extracts JSON from a fenced or prose-wrapped response', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('Here you go: {"a":2} - hope that helps')).toEqual({ a: 2 });
    expect(extractJsonObject('no json at all')).toBeNull();
  });

  it('records the model routing fields but marks them advisory', () => {
    const result = validateClassification({
      ...makeClassification(),
      routingEmail: 'attacker@evil.com',
      destinationFolder: 'Exfiltrated',
    });
    expect(result.ok).toBe(true);
    // Present for audit - the decision path never reads them (asserted in the security suite).
    if (result.ok) expect(result.value.routingEmail).toBe('attacker@evil.com');
  });
});

describe('programme resolution (BRD section 8)', () => {
  const scenarioFor = async (id: string) => (await store.getScenario(id))!;

  it('assigns the programme on an explicit mention', async () => {
    const thresholds = await store.getThresholds();
    const result = resolveProgram(
      makeClassification({ program: 'FIT', programEvidence: [{ source: 'explicitProgramMention' }] }),
      await scenarioFor('SC-01'),
      thresholds,
    );
    expect(result.program).toBe('FIT');
    expect(result.resolvedBy).toBe('explicit');
    expect(result.appliedFallbackRule).toBe(false);
  });

  it('refuses to assign a programme on generic keywords alone (FR-028)', async () => {
    const thresholds = await store.getThresholds();
    const result = resolveProgram(
      makeClassification({ program: 'FIT', programEvidence: [{ source: 'genericKeyword' }] }),
      await scenarioFor('SC-01'),
      thresholds,
    );
    expect(result.program).toBe('UNKNOWN');
    expect(result.appliedFallbackRule).toBe(true);
  });

  it('never picks one when both programmes are named explicitly', async () => {
    const thresholds = await store.getThresholds();
    const result = resolveProgram(
      makeClassification({
        program: 'UNKNOWN',
        programEvidence: [{ source: 'explicitProgramMention' }, { source: 'explicitProgramMention' }],
      }),
      await scenarioFor('SC-01'),
      thresholds,
    );
    expect(result.conflicting).toBe(true);
    expect(result.program).toBe('UNKNOWN');
  });

  it('assigns MEC_CGR by business rule for a Schoox scenario', async () => {
    const thresholds = await store.getThresholds();
    const result = resolveProgram(makeClassification({ program: 'UNKNOWN' }), await scenarioFor('SC-07'), thresholds);
    expect(result.program).toBe('MEC_CGR');
    expect(result.resolvedBy).toBe('businessRule');
  });

  it('accepts thread history as sufficient evidence', async () => {
    const thresholds = await store.getThresholds();
    const result = resolveProgram(
      makeClassification({ program: 'FLO', programEvidence: [{ source: 'threadHistory' }, { source: 'businessRule' }] }),
      await scenarioFor('SC-01'),
      thresholds,
    );
    expect(result.program).toBe('FLO');
    expect(result.resolvedBy).toBe('evidence');
  });
});

describe('multi-intent resolution (BRD section 7)', () => {
  const setup = async () => ({
    scenarios: await store.getScenarios(),
    config: await store.getMultiIntentConfig(),
  });

  it('reports a single intent when there is only one', async () => {
    const { scenarios, config } = await setup();
    const result = resolveMultiIntent({
      classification: makeClassification({ scenarioId: 'SC-01' }),
      scenarios, config, machineGenerated: false, subIntents: new Map(),
    });
    expect(result.multiIntent).toBe(false);
  });

  it('lets an auto-reply win over anything it quotes', async () => {
    const { scenarios, config } = await setup();
    const result = resolveMultiIntent({
      classification: makeClassification({ scenarioId: 'SC-01', secondaryIntents: [{ scenarioId: 'SC-08', confidence: 0.9 }] }),
      scenarios, config, machineGenerated: true, subIntents: new Map(),
    });
    expect(result.primaryScenarioId).toBe('SC-08');
    expect(result.ruleApplied).toBe('MI-AUTOREPLY-WINS');
  });

  it('escalates a change request mixed with a technical fault', async () => {
    const { scenarios, config } = await setup();
    const result = resolveMultiIntent({
      classification: makeClassification({ scenarioId: 'SC-03', subIntent: 'change_request', secondaryIntents: [{ scenarioId: 'SC-09', confidence: 0.8, subIntent: 'technical' }] }),
      scenarios, config, machineGenerated: false,
      subIntents: new Map([['SC-03', 'change_request'], ['SC-09', 'technical']]),
    });
    expect(result.requiresHumanReview).toBe(true);
    expect(result.ruleApplied).toBe('MI-CR-VS-TECH');
  });

  it('escalates three or more actionable intents', async () => {
    const { scenarios, config } = await setup();
    const result = resolveMultiIntent({
      classification: makeClassification({
        scenarioId: 'SC-01',
        secondaryIntents: [
          { scenarioId: 'SC-06', confidence: 0.7 },
          { scenarioId: 'SC-10', confidence: 0.7 },
        ],
      }),
      scenarios, config, machineGenerated: false, subIntents: new Map(),
    });
    expect(result.ruleApplied).toBe('MI-THREE-OR-MORE');
    expect(result.requiresHumanReview).toBe(true);
  });

  it('does not pick the primary by keyword order but by configured precedence', async () => {
    const { scenarios, config } = await setup();
    // SC-10 appears as the model's primary but SC-02 has higher precedence.
    const result = resolveMultiIntent({
      classification: makeClassification({ scenarioId: 'SC-10', secondaryIntents: [{ scenarioId: 'SC-02', confidence: 0.9 }] }),
      scenarios, config, machineGenerated: false, subIntents: new Map(),
    });
    expect(result.primaryScenarioId).toBe('SC-02');
    expect(result.ruleApplied).toBe('MI-PRECEDENCE');
  });
});

describe('confidence model (BRD section 9)', () => {
  it('bands at the BRD thresholds', () => {
    expect(bandFor(0.95, 0.9, 0.75)).toBe('HIGH');
    expect(bandFor(0.9, 0.9, 0.75)).toBe('HIGH');
    expect(bandFor(0.8, 0.9, 0.75)).toBe('MEDIUM');
    expect(bandFor(0.74, 0.9, 0.75)).toBe('LOW');
  });

  it('penalises an uncorroborated classification', async () => {
    const thresholds = await store.getThresholds();
    const result = assessConfidence(
      { rawConfidence: 0.95, scenarioId: 'SC-01', bodyLength: 500, injectionSuspected: false, languageDetected: 'en', hasInvalidEntities: false, corroborated: false, corroboratingSignals: [] },
      thresholds,
    );
    expect(result.effectiveConfidence).toBeLessThan(0.95);
    expect(result.penaltiesApplied).toContain('noCorroboratingSignal');
  });

  it('halves confidence when injection is suspected', async () => {
    const thresholds = await store.getThresholds();
    const result = assessConfidence(
      { rawConfidence: 0.99, scenarioId: 'SC-01', bodyLength: 500, injectionSuspected: true, languageDetected: 'en', hasInvalidEntities: false, corroborated: true, corroboratingSignals: ['stuck'] },
      thresholds,
    );
    expect(result.band).toBe('LOW');
  });

  it('penalises non-English content while the language question is open', async () => {
    const thresholds = await store.getThresholds();
    const result = assessConfidence(
      { rawConfidence: 0.95, scenarioId: 'SC-01', bodyLength: 500, injectionSuspected: false, languageDetected: 'fr', hasInvalidEntities: false, corroborated: true, corroboratingSignals: ['x'] },
      thresholds,
    );
    expect(result.penaltiesApplied).toContain('nonEnglishContent');
  });

  it('refuses a destructive action below the HIGH band regardless of overrides', async () => {
    const thresholds = await store.getThresholds();
    expect(meetsBandForAction('DeleteEmail', 'MEDIUM', thresholds)).toBe(false);
    expect(meetsBandForAction('DeleteEmail', 'HIGH', thresholds)).toBe(true);
    expect(meetsBandForAction('MoveEmail', 'MEDIUM', thresholds)).toBe(true);
  });

  it('blocks medium-band automation without corroboration', async () => {
    const thresholds = await store.getThresholds();
    const uncorroborated = { rawConfidence: 0.8, effectiveConfidence: 0.8, band: 'MEDIUM' as const, penaltiesApplied: [], corroborated: false, corroboratingSignals: [] };
    expect(mediumBandPermitsAutomation(uncorroborated, false, null, thresholds)).toBe(false);
  });

  it('requires validator agreement for a medium-band multi-intent email', async () => {
    const thresholds = await store.getThresholds();
    const corroborated = { rawConfidence: 0.8, effectiveConfidence: 0.8, band: 'MEDIUM' as const, penaltiesApplied: [], corroborated: true, corroboratingSignals: ['x'] };
    expect(mediumBandPermitsAutomation(corroborated, true, null, thresholds)).toBe(false);
    expect(mediumBandPermitsAutomation(corroborated, true, true, thresholds)).toBe(true);
  });

  it('lets a per-scenario override make a scenario stricter but never more permissive', async () => {
    const thresholds = await store.getThresholds();
    const scenario = { ...(await store.getScenario('SC-01'))!, confidenceThresholdOverride: 0.98 };
    expect(thresholdsFor('SC-01', thresholds, scenario).high).toBe(0.98);
    const lax = { ...scenario, confidenceThresholdOverride: 0.5 };
    expect(thresholdsFor('SC-01', thresholds, lax).high).toBe(0.9);
  });
});

describe('corroboration', () => {
  it('confirms a classification whose configured signals appear in the email', async () => {
    const scenarios = await store.getScenarios();
    const sc01 = scenarios.find((s) => s.scenarioId === 'SC-01')!;
    const email = normaliseEmail(makeEmail({ body: 'I am stuck and cannot move on past the island.' }), [], [], opts);
    expect(corroborate(email, sc01, scenarios, 1).corroborated).toBe(true);
  });

  it('fails to confirm when a different scenario has more signal', async () => {
    const scenarios = await store.getScenarios();
    const sc01 = scenarios.find((s) => s.scenarioId === 'SC-01')!;
    const email = normaliseEmail(
      makeEmail({ body: 'I am unable to access, cannot access login, sign in, authenticator and cache problems.' }),
      [], [], opts,
    );
    const result = corroborate(email, sc01, scenarios, 1);
    expect(result.corroborated).toBe(false);
    expect(result.competingScenarios).toContain('SC-02');
  });
});

describe('entity validation', () => {
  it('flags a malformed GPID without correcting it', () => {
    const result = validateEntities({ learnerName: null, gpid: 'not-a-gpid', email: null, program: null, island: null, week: null, errorMessage: null });
    expect(result.valid).toBe(false);
    expect(result.invalidFields).toContain('gpid');
  });

  it('accepts a plausible GPID', () => {
    expect(validateEntities({ learnerName: null, gpid: '1234567', email: null, program: null, island: null, week: null, errorMessage: null }).valid).toBe(true);
  });

  it('flags a malformed email address', () => {
    expect(validateEntities({ learnerName: null, gpid: null, email: 'not-an-email', program: null, island: null, week: null, errorMessage: null }).invalidFields).toContain('email');
  });

  it('knows which entities a scenario cannot proceed without', () => {
    const empty = { learnerName: null, gpid: null, email: null, program: null, island: null, week: null, errorMessage: null };
    expect(findMissingRequiredEntities('SC-06', empty)).toEqual(['learnerName']);
    expect(findMissingRequiredEntities('SC-12', empty)).toEqual(['email']);
    expect(findMissingRequiredEntities('SC-01', empty)).toEqual([]);
  });
});

describe('routing resolution (Rule 16)', () => {
  it('resolves the FIT owner for a FIT email', async () => {
    const rules = await store.getRoutingRules();
    const result = resolveRouting(rules, { scenarioId: 'SC-01', program: 'FIT', subIntent: null });
    expect(result.recipients).toEqual(['jordan.beahrs@pepsico.com']);
  });

  it('resolves BOTH owners when the programme is unknown (FR-027)', async () => {
    const rules = await store.getRoutingRules();
    const result = resolveRouting(rules, { scenarioId: 'SC-01', program: 'UNKNOWN', subIntent: null });
    expect(result.recipients).toHaveLength(2);
    expect(result.appliedBothOwnersFallback).toBe(true);
  });

  it('refuses to resolve a branching scenario without a sub-intent', async () => {
    const rules = await store.getRoutingRules();
    const result = resolveRouting(rules, { scenarioId: 'SC-03', program: 'FIT', subIntent: null });
    expect(result.resolved).toBe(false);
    expect(result.failureReason).toContain('sub-intent');
  });

  it('prefers an exact programme match over the ALL wildcard', async () => {
    const rules = await store.getRoutingRules();
    const rule = selectRule(rules, { scenarioId: 'SC-01', program: 'FLO', subIntent: null });
    expect(rule?.program).toBe('FLO');
  });

  it('routes every Schoox email to Amy', async () => {
    const rules = await store.getRoutingRules();
    for (const program of ['MEC_CGR', 'UNKNOWN', 'FIT'] as const) {
      expect(resolveRouting(rules, { scenarioId: 'SC-07', program, subIntent: null }).recipients).toEqual(['amy.fischer@pepsico.com']);
    }
  });

  it('has a rule for every active scenario', async () => {
    const [rules, scenarios] = await Promise.all([store.getRoutingRules(), store.getScenarios()]);
    for (const scenario of scenarios) {
      expect(rules.some((r) => r.scenarioId === scenario.scenarioId)).toBe(true);
    }
  });
});

describe('template resolution and rendering (BRD sections 12 and 16)', () => {
  it('refuses an inactive template, which is the shipped state (GAP-004)', async () => {
    const templates = await store.getTemplates();
    const result = resolveTemplate(templates, { scenarioId: 'SC-01', program: 'FIT', senderType: 'learner' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('inactive');
  });

  it('refuses a proposed template belonging to a different scenario', async () => {
    const templates = await store.getTemplates();
    const result = resolveTemplate(templates, { scenarioId: 'SC-01', program: 'FIT', senderType: 'learner', proposedTemplateId: 'TPL-SC06-CR' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('mismatch');
  });

  it('refuses a template the model invented', async () => {
    const templates = await store.getTemplates();
    const result = resolveTemplate(templates, { scenarioId: 'SC-01', program: 'FIT', senderType: 'learner', proposedTemplateId: 'TPL-MADE-UP' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_found');
  });

  const template = {
    templateId: 'T1', scenarioId: 'SC-01', program: 'ALL' as const, senderType: 'any' as const,
    templateType: 'Troubleshooting' as const,
    subjectTemplate: 'RE: {{originalSubject}}',
    bodyTemplate: 'Hello {{senderFirstName}}, about {{originalSubject}}.',
    allowedVariables: ['originalSubject', 'senderFirstName'],
    isActive: true, version: '1.0.0', effectiveDate: null, lastModifiedDate: '2026-09-07', approvedBy: 'Test',
  };

  it('renders with the allowed variables', () => {
    const result = renderTemplate(template, { originalSubject: 'Stuck', senderFirstName: 'Sam' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.body).toBe('Hello Sam, about Stuck.');
  });

  it('rejects a variable the template does not declare', () => {
    const result = renderTemplate(template, { originalSubject: 'x', senderFirstName: 'y', gpid: '123' } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown_variable');
  });

  it('rejects a missing value rather than sending a half-rendered email', () => {
    const result = renderTemplate(template, { originalSubject: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unresolved_placeholder');
  });

  it('HTML-encodes values so injected markup cannot reach a recipient (T-03)', () => {
    const result = renderTemplate(template, { originalSubject: '<script>x</script>', senderFirstName: 'Sam' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.body).toContain('&lt;script&gt;');
      expect(result.value.body).not.toContain('<script>');
    }
  });

  it('rejects a URL that was not in the template source (FR-077)', () => {
    const result = renderTemplate(template, { originalSubject: 'Visit http://evil.example.com now', senderFirstName: 'Sam' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invented_url');
  });

  it('permits a URL that the approved template itself contains', () => {
    const withUrl = { ...template, bodyTemplate: 'Please use https://passport.example.com/form for {{originalSubject}}.', allowedVariables: ['originalSubject'] };
    const result = renderTemplate(withUrl, { originalSubject: 'your request' });
    expect(result.ok).toBe(true);
  });
});

describe('action registry', () => {
  it('contains exactly the nine approved actions', () => {
    expect(registryIsComplete()).toBe(true);
  });

  it('rejects an unknown action name', () => {
    expect(isApprovedAction('TransferFunds')).toBe(false);
    expect(isApprovedAction('SendResponse')).toBe(true);
  });

  it('marks deletion as the only destructive action', () => {
    expect(getActionDefinition('DeleteEmail')?.destructive).toBe(true);
    expect(getActionDefinition('MoveEmail')?.destructive).toBe(false);
  });

  it('detects missing required parameters', () => {
    expect(missingParameters('ForwardEmail', {})).toEqual(['toRecipients']);
    expect(missingParameters('ForwardEmail', { toRecipients: [] })).toEqual(['toRecipients']);
    expect(missingParameters('MarkAsRead', {})).toEqual([]);
  });
});

describe('region resolution (GAP-012)', () => {
  it('returns UNMAPPED rather than inventing a region', async () => {
    const [mappings, reporting] = await Promise.all([store.getRegionMappings(), store.getReportingConfig()]);
    const email = normaliseEmail(makeEmail(), [], [], opts);
    const result = resolveRegion(mappings, reporting, { email });
    expect(result.mapped).toBe(false);
    expect(result.regionCode).toBe('UNMAPPED');
  });

  it('uses a supplied mapping once Business provides one', async () => {
    const reporting = await store.getReportingConfig();
    const email = normaliseEmail(makeEmail({ from: { address: 'learner@uk.pepsico.com' } }), [], [], opts);
    const result = resolveRegion(
      [{ matchType: 'SenderDomain', matchValue: 'uk.pepsico.com', regionCode: 'EU', regionName: 'Europe', priority: 1, isActive: true }],
      reporting,
      { email },
    );
    expect(result.regionCode).toBe('EU');
    expect(result.matchedBy).toBe('SenderDomain');
  });
});

describe('weekly report (BRD section 19)', () => {
  const rows = [
    { processingId: '1', receivedDateTime: '2026-09-01T09:00:00Z', scenarioId: 'SC-01', scenarioName: 'a', program: 'FIT' as const, regionCode: 'UNMAPPED', routingEmails: ['jordan.beahrs@pepsico.com'], routingTarget: 'PROGRAM_OWNER', outcome: 'EXECUTE', humanReviewRequired: false },
    { processingId: '2', receivedDateTime: '2026-09-02T09:00:00Z', scenarioId: 'SC-07', scenarioName: 'b', program: 'MEC_CGR' as const, regionCode: 'UNMAPPED', routingEmails: ['amy.fischer@pepsico.com'], routingTarget: 'SCHOOX_OWNER', outcome: 'EXECUTE', humanReviewRequired: false },
    { processingId: '3', receivedDateTime: '2026-09-03T09:00:00Z', scenarioId: 'SC-06', scenarioName: 'c', program: 'ALL' as const, regionCode: 'UNMAPPED', routingEmails: [], routingTarget: 'CHANGE_REQUEST', outcome: 'EXECUTE', humanReviewRequired: false },
    { processingId: '4', receivedDateTime: '2026-09-04T09:00:00Z', scenarioId: 'SC-11', scenarioName: 'd', program: 'ALL' as const, regionCode: 'UNMAPPED', routingEmails: [], routingTarget: null, outcome: 'EXECUTE', humanReviewRequired: false },
    { processingId: '5', receivedDateTime: '2026-08-20T09:00:00Z', scenarioId: 'SC-01', scenarioName: 'a', program: 'FIT' as const, regionCode: 'UNMAPPED', routingEmails: [], routingTarget: null, outcome: 'EXECUTE', humanReviewRequired: false },
  ];

  const request = {
    periodStart: new Date('2026-08-31T00:00:00Z'),
    periodEnd: new Date('2026-09-07T00:00:00Z'),
    rows,
    scenarioCatalogue: Array.from({ length: 12 }, (_, i) => ({ scenarioId: `SC-${String(i + 1).padStart(2, '0')}`, scenarioName: `Scenario ${i + 1}` })),
    unmappedRegionCode: 'UNMAPPED',
    programOwnerAddresses: ['jordan.beahrs@pepsico.com', 'josh.baxter@pepsico.com'],
    schooxOwnerAddresses: ['amy.fischer@pepsico.com'],
  };

  it('produces every BRD section 19 figure', () => {
    const report = buildWeeklyReport(request, new Date('2026-09-04T17:00:00Z'));
    expect(report.totalEmails).toBe(4); // the August row is outside the window
    expect(report.forwardedToProgramOwners).toBe(1);
    expect(report.routedToSchooxOwner).toBe(1);
    expect(report.routedToChangeRequest).toBe(1);
    expect(report.resolved).toBe(1);
    expect(report.emailsByRegion.UNMAPPED).toBe(4);
  });

  it('emits all twelve scenarios for every region, including zero counts', () => {
    const report = buildWeeklyReport(request);
    expect(report.scenarioByRegion).toHaveLength(12);
    expect(report.scenarioByRegion.find((s) => s.scenarioId === 'SC-05')?.count).toBe(0);
  });

  it('states plainly how many messages could not be regionalised', () => {
    const report = buildWeeklyReport(request);
    expect(report.unmappedRegionCount).toBe(4);
    expect(report.gaps.join(' ')).toContain('GAP-012');
  });

  it('computes a Monday-to-Monday window from the Friday it runs', () => {
    const { periodStart, periodEnd } = weekWindowFor(new Date('2026-09-04T17:00:00Z')); // a Friday
    expect(periodStart.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });
});
