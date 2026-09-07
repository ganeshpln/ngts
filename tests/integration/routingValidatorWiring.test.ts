/**
 * The routing_decision_validator wired into the pipeline (prompt 5, BRD section 11).
 *
 * These tests are about the asymmetry that makes a model call safe to have in this position:
 * disagreement demotes to a human, agreement never promotes past a gate already failed, and
 * anything that is not an explicit agreement fails safe.
 */

import { describe, expect, it } from 'vitest';

import {
  AMY,
  JORDAN,
  JOSH,
  LIVE,
  VALIDATOR_AGREES,
  VALIDATOR_DISAGREES,
  actionTypes,
  liveWith,
  run,
} from '../helpers/harness.js';
import { makeEmail } from '../helpers/fixtures.js';

/** Medium-band multi-intent: a Schoox question that also raises a separate FIT/FLO access issue. */
const MULTI_INTENT_EMAIL = makeEmail({
  subject: 'MEC deck and login trouble',
  body:
    'Where is the MEC capstone deck on Schoox for workweek 5? Also I am unable to access the platform ' +
    'this morning - the authenticator never sends me a code and I cannot sign in at all.',
});

const MULTI_INTENT_CLASSIFICATION = {
  scenarioId: 'SC-07',
  program: 'MEC_CGR' as const,
  confidence: 0.80,
  multiIntent: true,
  secondaryIntents: [{ scenarioId: 'SC-02', confidence: 0.89 }],
};

describe('when the validator agrees', () => {
  it('lets a medium-band multi-intent email route to both owners', async () => {
    const { decision, mailbox } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    expect(decision.confidence.band).toBe('MEDIUM');
    expect(decision.outcome).toBe('EXECUTE');
    expect(decision.multiIntentResolution.ruleApplied).toBe('MI-SCHOOX-PLUS');
    // BRD Scenario 7 exclusion rule: the Schoox owner takes it, and the FIT/FLO owners are involved
    // only because a separate FIT/FLO issue is present.
    expect(mailbox.recipients()).toContain(AMY);
    expect(mailbox.recipients()).toEqual(expect.arrayContaining([JORDAN, JOSH]));
  });
});

describe('when the validator disagrees', () => {
  it('demotes a medium-band item to human review and reports the concern', async () => {
    const { decision, mailbox } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_DISAGREES }),
    );

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-02');
    expect(decision.warnings.join(' ')).toContain('different team');
    expect(mailbox.calls).toHaveLength(0);
  });

  it('shows the reviewer the advisory suggestion without acting on it', async () => {
    const { decision } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_DISAGREES }),
    );

    const warnings = decision.warnings.join(' ');
    expect(warnings).toContain('SC-03');
    expect(warnings).toContain('advisory only');
    // The suggestion changed nothing: the classification is still what the classifier produced.
    expect(decision.classification.scenarioId).toBe('SC-07');
  });

  it('demotes even a HIGH-confidence classification', async () => {
    // Disagreement demotes at any band. A confident classification the second opinion reads
    // differently is exactly the case worth a human's minute.
    const { decision } = await run(
      MULTI_INTENT_EMAIL,
      { ...MULTI_INTENT_CLASSIFICATION, confidence: 0.99 },
      liveWith({ routingValidation: VALIDATOR_DISAGREES }),
    );

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-02');
  });
});

describe('when the validator cannot be trusted', () => {
  it('fails safe when it is unreachable', async () => {
    // No scripted response - the call fails, so there is no agreement to rely on.
    const { decision, mailbox } = await run(MULTI_INTENT_EMAIL, MULTI_INTENT_CLASSIFICATION, LIVE);

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(mailbox.calls).toHaveLength(0);
  });

  it('fails safe for a HIGH-confidence multi-intent email too', async () => {
    // High confidence in the PRIMARY label is not confidence that acting on it alone is right when
    // a second intent would involve a different team.
    const { decision } = await run(
      MULTI_INTENT_EMAIL,
      { ...MULTI_INTENT_CLASSIFICATION, confidence: 0.98 },
      LIVE,
    );

    expect(decision.confidence.band).toBe('HIGH');
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-02');
    expect(decision.warnings.join(' ')).toContain('no second opinion');
  });

  it('fails safe on a malformed response rather than reading it as agreement', async () => {
    const { decision } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: 'I think this looks fine to me.' }),
    );
    expect(decision.outcome).toBe('HUMAN_REVIEW');
  });

  it('fails safe when it omits the agrees field', async () => {
    const { decision } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: { confidence: 0.95, concern: null } }),
    );
    expect(decision.outcome).toBe('HUMAN_REVIEW');
  });
});

describe('agreement never promotes', () => {
  it('does not authorise a send when the template is inactive (GAP-004)', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Stuck', body: 'I cannot move on in my FIT journey, the next button is greyed out.' }),
      { scenarioId: 'SC-01', program: 'FIT', confidence: 0.82 },
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    expect(actionTypes(decision)).not.toContain('SendResponse');
    expect(mailbox.kinds()).not.toContain('sendReply');
  });

  it('does not authorise a delete below the HIGH band (AD-005)', async () => {
    const { decision } = await run(
      makeEmail({
        subject: 'Automatic reply',
        body: 'I am out of the office with limited access to email.',
        headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }],
      }),
      { scenarioId: 'SC-08', program: 'ALL', senderType: 'system', confidence: 0.80 },
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    expect(decision.confidence.band).not.toBe('HIGH');
    expect(actionTypes(decision)).not.toContain('DeleteEmail');
  });
});

describe('when the validator is consulted at all', () => {
  const promptsCalled = (calls: { promptName: string }[]) => calls.map((c) => c.promptName);

  it('is not consulted for a straightforward high-confidence single-intent email', async () => {
    const { model, decision } = await run(
      makeEmail({ subject: 'MEC deck', body: 'Where is the MEC capstone deck on Schoox for workweek 3?' }),
      { scenarioId: 'SC-07', program: 'MEC_CGR', confidence: 0.96 },
      LIVE,
    );

    expect(decision.confidence.band).toBe('HIGH');
    expect(promptsCalled(model.calls)).toEqual(['email_intent_classifier']);
  });

  it('is not consulted for a LOW-band email, which is already bound for a human', async () => {
    const { model, decision } = await run(
      makeEmail({ subject: 'Hi', body: 'Can you help?' }),
      { scenarioId: 'SC-01', program: 'UNKNOWN', confidence: 0.4 },
      LIVE,
    );

    expect(decision.confidence.band).toBe('LOW');
    expect(promptsCalled(model.calls)).toEqual(['email_intent_classifier']);
  });

  it('is consulted for a medium-band email', async () => {
    const { model, decision } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    expect(decision.confidence.band).toBe('MEDIUM');
    expect(promptsCalled(model.calls)).toContain('routing_decision_validator');
  });

  it('is not consulted for a suppressed email, which is never acted on anyway', async () => {
    const { model, decision } = await run(
      makeEmail({ from: { address: 'spa@pepsico.com' }, body: 'An automated reply this system sent.' }),
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    expect(decision.outcome).toBe('SUPPRESS');
    expect(model.calls).toHaveLength(0);
  });

  it('sends the email content to the validator inside the content delimiters', async () => {
    const { model } = await run(
      MULTI_INTENT_EMAIL,
      MULTI_INTENT_CLASSIFICATION,
      liveWith({ routingValidation: VALIDATOR_AGREES }),
    );

    const call = model.calls.find((c) => c.promptName === 'routing_decision_validator');
    expect(call).toBeDefined();
    // The proposed decision is in the instruction lane; the email stays inside the delimiters.
    expect(call!.userMessage).toContain('Proposed decision:');
    expect(call!.userMessage).toContain('<<<EMAIL_CONTENT_START>>>');
    const between = call!.userMessage.slice(
      call!.userMessage.indexOf('<<<EMAIL_CONTENT_START>>>'),
      call!.userMessage.indexOf('<<<EMAIL_CONTENT_END>>>'),
    );
    expect(between).toContain('MEC capstone deck');
  });
});
