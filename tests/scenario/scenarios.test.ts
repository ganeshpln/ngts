/**
 * Scenario suite (BRD Phase 5 and Phase 6, Rule 10).
 *
 * Every one of the twelve BRD scenarios is exercised end to end through the real pipeline, with
 * the model's answer scripted so the test asserts on the DETERMINISTIC behaviour: which owner the
 * email is routed to, which folder it lands in, whether a reply is permitted, and whether the item
 * escalates.
 */

import { describe, expect, it } from 'vitest';

import { actionTypes, AMY, JORDAN, JOSH, LIVE, liveWith, run } from '../helpers/harness.js';
import { makeEmail } from '../helpers/fixtures.js';

describe('SC-01 learner cannot advance', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('cannot be automated at all in the shipped configuration, and says so', async () => {
    // The honest state today: the approved troubleshooting wording does not exist (GAP-004) and no
    // folder is named for this scenario (GAP-005), so nothing executable remains and a human takes
    // it. This test exists so that closing those gaps is a visible, deliberate change.
    const { decision } = await run(
      makeEmail({ subject: 'Stuck on island 3', body: 'I cannot move on in my FIT journey, the next button is greyed out.' }),
      { scenarioId: 'SC-01', program: 'FIT', confidence: 0.95 },
      LIVE,
    );

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-04');
    expect(decision.warnings.join(' ')).toContain('GAP-004');
  });

  it('sends the troubleshooting template to the sender once approved wording exists, and does NOT forward on first contact', async () => {
    // BRD section 6 Scenario 1 sequences this explicitly: the template is the initial response, and
    // the owner is involved only on escalation.
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Stuck on island 3', body: 'I cannot move on in my FIT journey, the next button is greyed out.' }),
      { scenarioId: 'SC-01', program: 'FIT', confidence: 0.95 },
      liveWith({ activateTemplates: ['TPL-SC01-TSHOOT'] }),
    );

    expect(actionTypes(decision)).toContain('SendResponse');
    expect(mailbox.recipients()).toEqual(['learner@pepsico.com']);
    expect(mailbox.recipients()).not.toContain(JORDAN);
  });

  it('routes a FIT escalation to Jordan when the sender supplies a GPID', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Still stuck', body: 'I still cannot move on in FIT, the survey is greyed out. My GPID is 1234567.' }),
      {
        scenarioId: 'SC-01',
        program: 'FIT',
        extractedEntities: {
          learnerName: null, gpid: '1234567', email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enableEscalation: ['SC-01'] }),
    );

    expect(actionTypes(decision)).toContain('RouteToProgramOwner');
    expect(mailbox.recipients()).toContain(JORDAN);
    expect(mailbox.recipients()).not.toContain(JOSH);
  });

  it('routes a FLO escalation to Josh', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Cannot submit', body: 'Trouble submitting the FLO questionnaire, data not saved. GPID 7654321.' }),
      {
        scenarioId: 'SC-01',
        program: 'FLO',
        programEvidence: [{ source: 'explicitProgramMention' }],
        extractedEntities: {
          learnerName: null, gpid: '7654321', email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enableEscalation: ['SC-01'] }),
    );
    expect(mailbox.recipients()).toContain(JOSH);
    expect(mailbox.recipients()).not.toContain(JORDAN);
  });

  it('applies the BRD fallback and routes to BOTH owners when the programme is not established', async () => {
    // BRD section 8, explicit: "If FIT/FLO is not mentioned in the email, send the email to both
    // Josh and Jordon." This is FR-027 / Rule R-1.
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Stuck', body: 'I am stuck and cannot advance, the survey is greyed out and data not saved. GPID 1112223.' }),
      {
        scenarioId: 'SC-01',
        program: 'UNKNOWN',
        programEvidence: [{ source: 'genericKeyword' }],
        extractedEntities: {
          learnerName: null, gpid: '1112223', email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enableEscalation: ['SC-01'] }),
    );

    expect(decision.programResolution.program).toBe('UNKNOWN');
    expect(decision.programResolution.appliedFallbackRule).toBe(true);
    expect(mailbox.recipients()).toEqual(expect.arrayContaining([JORDAN, JOSH]));
  });
});

describe('SC-02 login and access issues', () => {
  it('routes a FIT access escalation to Jordan', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Cannot access FIT', body: 'The authenticator will not let me sign in to FIT and I cannot access anything. GPID 2223334.' }),
      {
        scenarioId: 'SC-02',
        program: 'FIT',
        extractedEntities: {
          learnerName: null, gpid: '2223334', email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enableEscalation: ['SC-02'] }),
    );
    expect(mailbox.recipients()).toContain(JORDAN);
  });

  it('routes an unattributed access escalation to both owners', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Login problem', body: 'I am unable to access the platform, it says I am not registered when I sign in. GPID 3334445.' }),
      {
        scenarioId: 'SC-02',
        program: 'UNKNOWN',
        programEvidence: [{ source: 'genericKeyword' }],
        extractedEntities: {
          learnerName: null, gpid: '3334445', email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enableEscalation: ['SC-02'] }),
    );
    expect(mailbox.recipients()).toEqual(expect.arrayContaining([JORDAN, JOSH]));
  });
});

describe('SC-03 manager access and manager change', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('escalates a change request while the change-request destination is unknown (GAP-003)', async () => {
    const { decision } = await run(
      makeEmail({ subject: 'Manager change', body: 'My manager change is needed - my new manager is Jane Smith, please update my direct supervisor.' }),
      { scenarioId: 'SC-03', subIntent: 'change_request', program: 'UNKNOWN' },
      liveWith({ enable: ['changeRequestRoutingEnabled'] }),
    );

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.warnings.join(' ')).toMatch(/GAP-003|no recipient/i);
  });

  it('sends a manager CHANGE to the change-request process, not to a programme owner', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Manager change', body: 'My manager change is needed - my new manager is Jane Smith, please update my direct supervisor.' }),
      { scenarioId: 'SC-03', subIntent: 'change_request', program: 'UNKNOWN' },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );

    expect(actionTypes(decision)).toContain('RouteToChangeRequest');
    expect(mailbox.recipients()).toContain(CR);
    expect(mailbox.recipients()).not.toContain(JORDAN);
    expect(mailbox.recipients()).not.toContain(JOSH);
  });

  it('sends a manager TECHNICAL problem to the programme owner', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Manager cannot see check-ins', body: 'My manager has manager access in FIT but cannot see my check-ins at all.' }),
      { scenarioId: 'SC-03', subIntent: 'technical', program: 'FIT' },
      LIVE,
    );
    expect(actionTypes(decision)).toContain('RouteToProgramOwner');
    expect(mailbox.recipients()).toContain(JORDAN);
  });

  it('escalates when the branch cannot be determined, rather than guessing', async () => {
    // The two branches route to different teams and the BRD gives no default, so a null sub-intent
    // must reach a human instead of the engine picking one.
    const { decision } = await run(
      makeEmail({ subject: 'Manager', body: 'I have a question about manager access for my team and would like some help please.' }),
      { scenarioId: 'SC-03', subIntent: null, program: 'UNKNOWN' },
      LIVE,
    );
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-04');
  });
});

describe('SC-04 change request form notification', () => {
  it('files it and marks it read with no response, per the BRD', async () => {
    const { decision, mailbox } = await run(
      makeEmail({
        subject: 'New response for Pep Passport Change Request Form',
        body: 'Request ID: CR-10293. You have submitted your request.',
        from: { address: 'noreply@forms.microsoft.com', name: 'Microsoft Forms' },
      }),
      { scenarioId: 'SC-04', program: 'ALL', senderType: 'system', confidence: 0.98 },
      LIVE,
    );

    expect(actionTypes(decision)).toEqual(['MoveEmail', 'MarkAsRead']);
    expect(mailbox.kinds()).toEqual(['move', 'markAsRead']);
    expect(mailbox.calls.find((c) => c.kind === 'move')?.payload).toMatchObject({
      destinationFolder: 'Pep Passport Change Requests',
    });
    expect(mailbox.kinds()).not.toContain('sendReply');
  });
});

describe('SC-05 peer trainer access', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('routes a trainer CHANGE to the change-request process', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'New peer trainer', body: 'Please assign a new peer trainer for this learner for their skills check.' }),
      { scenarioId: 'SC-05', subIntent: 'change_request', program: 'UNKNOWN' },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(actionTypes(decision)).toContain('RouteToChangeRequest');
    expect(mailbox.recipients()).toContain(CR);
  });

  it('routes an existing trainer access fault to the programme owner', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Trainer dropdown', body: 'The peer trainer has trainer access but does not show name in the dropdown for the FLO skills check.' }),
      { scenarioId: 'SC-05', subIntent: 'technical', program: 'FLO' },
      LIVE,
    );
    expect(mailbox.recipients()).toContain(JOSH);
  });
});

describe('SC-06 remove learner', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('routes to the change-request process when the learner is identified', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Remove learner', body: 'Please remove from PEP Passport John Doe, he is no longer with the organization.' }),
      {
        scenarioId: 'SC-06',
        program: 'ALL',
        extractedEntities: {
          learnerName: 'John Doe', gpid: null, email: null, program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(actionTypes(decision)).toContain('RouteToChangeRequest');
    expect(mailbox.recipients()).toContain(CR);
  });

  it('escalates when the learner to remove is not identified (HIL-06)', async () => {
    const { decision } = await run(
      makeEmail({ subject: 'Remove', body: 'Please remove from PEP Passport the employee who has now left us entirely.' }),
      { scenarioId: 'SC-06', program: 'ALL' },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-06');
  });
});

describe('SC-07 Schoox / MEC / CGR', () => {
  it('routes directly to Amy and files into Schoox', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'MEC workweek deck', body: 'Where can I find the Merch Effectiveness Coach workweek 3 deck on Schoox?' }),
      { scenarioId: 'SC-07', program: 'MEC_CGR', confidence: 0.94 },
      LIVE,
    );

    expect(mailbox.recipients()).toEqual([AMY]);
    expect(decision.programResolution.program).toBe('MEC_CGR');
    expect(mailbox.calls.find((c) => c.kind === 'move')?.payload).toMatchObject({ destinationFolder: 'Schoox' });
  });

  it('does not involve the FIT/FLO owners for a Schoox-only email', async () => {
    // BRD section 6 Scenario 7, explicit exclusion (Rule R-2).
    const { mailbox } = await run(
      makeEmail({ subject: 'CGR resources', body: 'The CGR pathway resources are not loading in Schoox.' }),
      { scenarioId: 'SC-07', program: 'MEC_CGR' },
      LIVE,
    );
    expect(mailbox.recipients()).not.toContain(JORDAN);
    expect(mailbox.recipients()).not.toContain(JOSH);
  });

  it('involves the FIT/FLO owner as well when a separate FIT/FLO issue is present', async () => {
    const { decision, mailbox } = await run(
      makeEmail({
        subject: 'MEC deck and FIT login',
        body: 'Where is the MEC capstone deck on Schoox? Also I am unable to access FIT, the authenticator fails.',
      }),
      {
        scenarioId: 'SC-07',
        program: 'MEC_CGR',
        multiIntent: true,
        secondaryIntents: [{ scenarioId: 'SC-02', confidence: 0.82 }],
      },
      LIVE,
    );

    expect(decision.multiIntentResolution.ruleApplied).toBe('MI-SCHOOX-PLUS');
    expect(mailbox.recipients()).toContain(AMY);
    // Programme is MEC_CGR by business rule, so the FIT/FLO secondary route falls back to both
    // owners rather than guessing between them.
    expect(mailbox.recipients()).toEqual(expect.arrayContaining([JORDAN, JOSH]));
  });
});

describe('SC-08 automatic replies', () => {
  it('marks read and soft-deletes, with no response', async () => {
    const { decision, mailbox } = await run(
      makeEmail({
        subject: 'Automatic reply: Out of office',
        body: 'I am currently out of the office with limited access to email. For urgent issues contact my colleague.',
        headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }],
      }),
      { scenarioId: 'SC-08', program: 'ALL', senderType: 'system', confidence: 0.97 },
      LIVE,
    );

    expect(actionTypes(decision)).toEqual(['DeleteEmail', 'MarkAsRead']);
    expect(mailbox.kinds()).toContain('softDelete');
    expect(mailbox.kinds()).not.toContain('hardDelete');
    expect(mailbox.kinds()).not.toContain('sendReply');
  });

  it('never permanently deletes unless hard delete is explicitly configured', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Automatic reply', body: 'Out of office.', headers: [{ name: 'Auto-Submitted', value: 'auto-generated' }] }),
      { scenarioId: 'SC-08', program: 'ALL', senderType: 'system' },
      liveWith({ safety: { hardDeleteEnabled: false } }),
    );
    expect(mailbox.kinds()).not.toContain('hardDelete');
  });
});

describe('SC-09 dashboard and reporting', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('routes an access request to the change-request process', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Dashboard access', body: 'Please give me dashboard access for my full location view across the region.' }),
      { scenarioId: 'SC-09', subIntent: 'change_request', program: 'UNKNOWN' },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(actionTypes(decision)).toContain('RouteToChangeRequest');
    expect(mailbox.recipients()).toContain(CR);
  });

  it('routes a broken dashboard to the programme owner', async () => {
    const { mailbox } = await run(
      makeEmail({ subject: 'Dashboard empty', body: 'The FIT dashboard shows no direct reports even though I already have dashboard access.' }),
      { scenarioId: 'SC-09', subIntent: 'technical', program: 'FIT' },
      LIVE,
    );
    expect(mailbox.recipients()).toContain(JORDAN);
  });
});

describe('SC-10 content and materials', () => {
  it('routes to the programme owner and sends no response, because the BRD does not authorise one', async () => {
    // Rule 14: silence in the BRD is not permission to send (AD-002).
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'Rise module', body: 'The Rise module for week 4 will not open in FIT - is there a PDF?' }),
      { scenarioId: 'SC-10', program: 'FIT' },
      LIVE,
    );

    expect(mailbox.recipients()).toContain(JORDAN);
    expect(actionTypes(decision)).not.toContain('SendResponse');
  });
});

describe('SC-11 resolved confirmation', () => {
  it('files into Resolved and marks read, with no response', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'RE: access', body: 'Thank you, that worked - I am able to work through the modules now.' }),
      { scenarioId: 'SC-11', program: 'ALL', confidence: 0.93 },
      LIVE,
    );

    expect(actionTypes(decision)).toEqual(['MoveEmail', 'MarkAsRead']);
    expect(mailbox.calls.find((c) => c.kind === 'move')?.payload).toMatchObject({ destinationFolder: 'Resolved' });
    expect(mailbox.kinds()).not.toContain('sendReply');
  });

  it('escalates when a thanks also raises an outstanding issue', async () => {
    const { decision } = await run(
      makeEmail({ subject: 'RE: access', body: 'Thanks for the help, but I still cannot submit the questionnaire.' }),
      {
        scenarioId: 'SC-11',
        program: 'UNKNOWN',
        multiIntent: true,
        secondaryIntents: [{ scenarioId: 'SC-01', confidence: 0.8 }],
      },
      LIVE,
    );

    expect(decision.multiIntentResolution.ruleApplied).toBe('MI-RESOLVED-PLUS');
    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-02');
  });
});

describe('SC-12 learner email address update', () => {
  const CR = 'pep.passport.changes@pepsico.com';

  it('routes to the change-request process when the new address is supplied', async () => {
    const { decision, mailbox } = await run(
      makeEmail({ subject: 'New email address', body: 'My new email address is ready, please update it in PEP Passport for me.' }),
      {
        scenarioId: 'SC-12',
        program: 'ALL',
        senderType: 'learner',
        extractedEntities: {
          learnerName: 'Sam Learner', gpid: null, email: 'sam.learner@pepsico.com',
          program: null, island: null, week: null, errorMessage: null,
        },
      },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(actionTypes(decision)).toContain('RouteToChangeRequest');
    expect(mailbox.recipients()).toContain(CR);
  });

  it('escalates when the new address is missing (HIL-06)', async () => {
    const { decision } = await run(
      makeEmail({ subject: 'Email change', body: 'There is an incorrect email on my profile, please can you update it for me.' }),
      { scenarioId: 'SC-12', program: 'ALL', senderType: 'learner' },
      liveWith({ enable: ['changeRequestRoutingEnabled'], changeRequestAddress: CR }),
    );
    expect(decision.humanReviewReason).toBe('HIL-06');
  });
});

describe('SC-99 unknown', () => {
  it('escalates to human review and touches nothing', async () => {
    const { decision, mailbox, humanReview } = await run(
      makeEmail({ subject: 'Hello', body: 'Can you help?' }),
      { scenarioId: 'SC-99', program: 'UNKNOWN', confidence: 0.2, requiresHumanReview: true },
      LIVE,
    );

    expect(decision.outcome).toBe('HUMAN_REVIEW');
    expect(decision.humanReviewReason).toBe('HIL-07');
    expect(mailbox.calls).toHaveLength(0);
    expect(humanReview.items).toHaveLength(1);
  });
});
