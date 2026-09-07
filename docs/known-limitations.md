# Known Limitations
## PEP Passport SPA Box Automation – Agentic (WIT 504)

An honest statement of what this solution does not do, or does not yet do. Read alongside
`docs/requirements-analysis.md` §15 (gaps) and `docs/test-matrix.md` §3 (coverage gaps).

---

## 1. Not verified against live Microsoft services

Rule 6 says not to claim an integration works unless it has been implemented and tested. In this
build environment there is no Microsoft 365 tenant, no Azure subscription and no Power Platform
environment. So:

- **The Microsoft Graph calls have not been executed.** They are written from the documented v1.0
  API and no endpoint is invented (Rule 5), but "correct per the documentation" is not "verified".
- **The Azure OpenAI client has not made a real call.**
- **Dataverse persistence has not run.** The idempotency guarantee depends on the alternate key on
  `spa_internetmessageid` being present and enforced — a platform behaviour that must be confirmed
  in DEV before outbound actions are enabled.
- **The Power Automate flows are designed, not built.** `infrastructure/power-platform/flows/`
  specifies them precisely; someone must construct them.
- **The Copilot Studio agent is configured, not deployed.**

Everything above is a DEV smoke-test item in `docs/production-checklist.md`.

---

## 2. Blocked on business input

| Capability | Blocked by | State |
|---|---|---|
| Any automated email response | GAP-004 — no approved wording exists | Templates ship inactive; sending is code-blocked |
| Change-request routing (5 scenarios) | GAP-003 — process mechanics unknown | Target modelled, disabled, no destination configured |
| Region-based reporting | GAP-012 — "To be Provided by Amy" | Everything aggregates to `UNMAPPED`, and the report says so weekly |
| Filing for 9 of 12 scenarios | GAP-005 — folder names not supplied | Only *Pep Passport Change Requests*, *Schoox* and *Resolved* are known; no move happens for the rest |
| The Friday report actually being sent | GAP-014 — no recipients | The flow logs and skips rather than guessing an address |
| Sending email content to the model | GAP-009 — privacy approval outstanding | **Blocking for PROD** |
| SC-01/SC-02 escalation on persistence | GAP-010 — no detection rule or waiting period | Only screenshot and GPID triggers are implemented; the rule ships disabled |

None of these is a technical limitation. Each is a business decision the BRD does not record, and
each is a configuration change once answered.

---

## 3. Design limitations

### 3.1 Sub-intent ambiguity sends work to humans
SC-03, SC-05 and SC-09 branch to different teams. When the classifier cannot tell which branch
applies, the email goes to human review rather than to a default. This is deliberate — the BRD gives
no precedence — but it means those three scenarios will have a higher review rate than the others.

### 3.2 Confidence is not calibrated
The model's self-reported confidence is not a calibrated probability. The penalties and
corroboration in `src/classification/confidence.ts` compensate, but the thresholds are the BRD's
suggested starting values, not empirically derived. **They must be tuned against the shadow-mode
pilot** — using them untuned is the single most likely cause of early misbehaviour.

### 3.3 Attachment content is never read
Screenshots are detected but not read. The BRD requires detection only (FR-080/081), so a learner
whose entire problem is visible in a screenshot and absent from the body will classify weakly and
land in human review. If OCR is wanted, the handler interface exists (FR-083); the answer to Q-20
decides.

### 3.4 English only
The prompts are English and non-English content is penalised into human review. This is safe but
not a solution; Q-19 decides whether more is needed.

### 3.5 No SLA-driven behaviour
Nothing in the system knows how quickly it is expected to act. There is no ageing, no priority and
no time-based escalation, because no SLA has been stated (GAP-002).

### 3.6 Thread context is best-effort
Owner-response suppression (FR-011) depends on the thread context the caller supplies. If Flow 1's
thread query fails or is trimmed, suppression can miss and the BOT may respond on a thread an owner
has already answered. The conversation outbound cap bounds the damage.

### 3.7 Region resolution assumes region is derivable from the message
The `RegionMapping` table supports sender domain, sender address, learner location and distribution
list. If the business's actual region key is none of these, a new match type is needed (`Custom` is
reserved for exactly this). ASM-09 records the assumption.

---

## 4. Operational limitations

- **Configuration cache is 5 minutes.** A change in Dataverse takes up to `cacheTtlSeconds` to take
  effect. That includes turning shadow mode back on in an incident — it is not instant.
- **No automated rollback of a bad prompt.** Reverting is a deployment. The prompt version on each
  `ClassificationResult` identifies the affected rows.
- **Human review has no SLA or escalation.** Items sit until a person works them (GAP-008).
- **Shadow mode audits but does not prove sending works.** A shadow run proves the *decisions* are
  right; the first live send is still a first.

---

## 5. Deliberate non-goals

| Not built | Why |
|---|---|
| The AI writing customer-facing text | BRD §16 and Rule 14 prohibit it. |
| The AI calling Graph directly | Rule 12. The agent holds no mailbox connector. |
| Automatic learning from corrections | Corrections are captured (FR-064) but applied by a human. A prompt is a business rule and changes under review. |
| A keyword rules engine | BRD §28 explicitly rejects it. |
| Bulk reprocessing of historical mail | Not requested, and idempotency would treat it all as new. |

---

## 6. The honest summary

The **deterministic control layer** is implemented, tested and, within the limits of §1, verified:
206 tests cover the twelve scenarios, the routing matrix, the confidence model, the action gates and
the threat model.

The **AI layer** is designed, prompted and bounded, but its real-world accuracy is unmeasured. That
is what the shadow-mode pilot is for, and no claim about classification accuracy should be made
before it has run.

The **integration layer** is specified against real Microsoft APIs and has not been executed. Treat
DEV smoke testing as mandatory rather than a formality.
