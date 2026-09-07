# Power Automate Implementation Design
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Five cloud flows, packaged in the managed solution `SPAMailboxAutomation`. Every flow uses
connection references and environment variables — no environment-specific value is embedded
(NFR-021).

The flows **orchestrate and execute**. They do not decide: every branch below switches on a value
the Decision Service returned (see `docs/architecture.md` §1).

---

## Environment variables (solution-scoped)

| Name | Type | Purpose | Source |
|---|---|---|---|
| `spa_MailboxUpn` | Text | SPA shared mailbox UPN | GAP-013 / Q-14 |
| `spa_DecisionServiceBaseUrl` | Text | `https://{functionApp}/api` | Bicep output |
| `spa_GraphBaseUrl` | Text | `https://graph.microsoft.com/v1.0` | fixed |
| `spa_ReviewTeamsChannelId` | Text | Human review channel | GAP-008 / Q-13 |
| `spa_ReportRecipients` | Text | Friday report recipients | GAP-014 / Q-12 — **empty by default** |
| `spa_ReportHourLocal` | Number | Friday report hour | GAP-014 |

## Connection references

| Name | Connector | Used by |
|---|---|---|
| `spa_office365` | Office 365 Outlook | Flow 1 trigger |
| `spa_graphHttp` | HTTP with Microsoft Entra ID | Flows 1, 2 |
| `spa_decisionService` | SPA Decision Service (custom) | Flows 1, 3, 4 |
| `spa_dataverse` | Microsoft Dataverse | Flows 3, 4, 5 |
| `spa_teams` | Microsoft Teams | Flow 3 |

---

## Flow 1 — Email Intake

**Trigger:** *When a new email arrives in a shared mailbox (V2)*
`Original Mailbox Address = @{variables('MailboxUpn')}`, `Folder = Inbox`,
`Include Attachments = Yes`, **trigger concurrency = 1** during the pilot.

| # | Action | Detail |
|---|---|---|
| 1 | Initialize `correlationId` | `guid()` |
| 2 | **HTTP with Entra ID** — `GET {graph}/users/{mailbox}/messages/{triggerBody()?['id']}` with the `$select`/`$expand` from `docs/integration-design.md` G-01 | The connector trigger does not reliably surface `internetMessageId` or `internetMessageHeaders`, and both are load-bearing for idempotency and loop prevention (AD-021). |
| 3 | **HTTP with Entra ID** — `GET {graph}/users/{mailbox}/messages?$filter=conversationId eq '…'&$top=10` | Thread context for FR-011. |
| 4 | **Scope: Decide** → `ProcessEmail` on the custom connector | Sends the Graph message plus thread context. |
| 5 | **Switch** on `outcome` | see below |
| 6 | `RecordActionResults` | Audit (FR-013). |

Switch branches:

| `outcome` | Flow 1 does |
|---|---|
| `EXECUTE` | Call **Flow 2** with the `actionPlan`. |
| `SHADOW` | Call `RecordActionResults` with every item `Shadowed`. No mailbox call. |
| `HUMAN_REVIEW` | Create the `spa_humanreviewqueue` row (Flow 3 picks it up). No mailbox call. |
| `SUPPRESS` | Optionally mark read; nothing else. |
| `DUPLICATE` | Terminate `Succeeded`. |

**Error handling:** the *Decide* scope has a parallel scope configured to run on
`has failed`/`is skipped`/`has timed out`, which writes a `spa_processingerror` row and terminates
`Failed`. The email is left untouched, so nothing is lost (NFR-002).

> **Why the guards are inside the Decision Service.** BRD §5 lists duplicate checking and
> automated-message identification as flow steps. As separate Power Automate actions that would be
> a Dataverse read, then a gap, then a write — and a retry of the same trigger can pass the check
> inside that gap. Executing them in one service call behind a conditional insert on a unique key
> makes duplicate processing *impossible* rather than unlikely (AD-022, FR-070). The BRD's logical
> sequence is preserved exactly; only the execution boundary differs.

---

## Flow 2 — Action Execution (child flow)

**Trigger:** *Manually trigger a flow* (child) — inputs `messageId`, `processingId`, `actionPlan` (array).

`Apply to each` over `actionPlan`, **sequentially** (concurrency off — order is part of the plan).
A `Switch` on `actionType` maps each item to one Graph call (`docs/integration-design.md` §1):

| `actionType` | Call |
|---|---|
| `SendResponse` | `POST …/messages/{id}/reply` with the rendered body **and** the `X-SPA-Bot-ProcessingId` internet header |
| `ForwardEmail`, `RouteToProgramOwner`, `RouteToChangeRequest` | `POST …/messages/{id}/forward` with `toRecipients` from the plan |
| `MoveEmail` | `POST …/messages/{id}/move` — **store the returned `id` in `currentMessageId`** |
| `MarkAsRead` | `PATCH …/messages/{currentMessageId}` `{"isRead": true}` |
| `DeleteEmail` | `POST …/move` → `deleteditems` (soft) or `DELETE …` (hard, only when the plan says so) |
| `EscalateToHumanReview` | Dataverse create; no mailbox call |

Two rules the flow must not break:

1. **`MoveEmail` changes the message id.** Every subsequent action uses `currentMessageId`.
2. **On failure, stop.** `Configure run after` is left at `is successful` so a failed action ends
   the loop; the failure is recorded and the original message is neither moved nor deleted.

Flow 2 performs **no validation** — every parameter it receives has already passed
`ActionValidator`. Adding a second opinion here would create a second decision path to keep in sync.

---

## Flow 3 — Human Review

**Trigger:** *When a row is added* — `spa_humanreviewqueue`.

1. Get the related `spa_emailprocessing` and `spa_classificationresult` rows.
2. **Teams — post an adaptive card and wait for a response** to `spa_ReviewTeamsChannelId`,
   showing subject, scenario, programme, confidence, extracted entities, the proposed plan, and a
   deep link to the message in Outlook (FR-061).
3. Buttons: **Approve** · **Reject** · **Correct** (scenario, programme, routing).
4. `POST /api/review/{id}/decision` — the service records the correction (FR-064) and **re-runs the
   Decision Engine** with the corrected inputs.
5. On an approved plan, call **Flow 2**.

A reviewer's correction goes back through the same engine, so a human-corrected item passes exactly
the same gates as an automatic one — a reviewer cannot approve a send from an inactive template or
a delete outside SC-08.

---

## Flow 4 — Weekly Friday Report

**Trigger:** *Recurrence* — weekly, Friday, at `spa_ReportHourLocal`.

1. `GenerateWeeklyReport` on the custom connector.
2. Create a `spa_weeklyreportrun` row (audit).
3. **Condition** on `deliverable`:
   - `true` → send the HTML summary to `spa_ReportRecipients`.
   - `false` → log and skip. **GAP-014: with no recipients configured there is no default to fall
     back on, so the flow does not guess an address.**
4. Optionally post to a Teams channel.

The report always states `unmappedRegionCount`, so the missing region mapping (GAP-012) stays
visible to the business every week rather than silently degrading.

---

## Flow 5 — Retry / Dead-letter Sweeper

**Trigger:** *Recurrence* — every `retry.sweepIntervalMinutes`.

`List rows` on `spa_processingerror` where
`spa_deadlettered eq false and spa_nextretryat le utcNow() and spa_attemptnumber lt spa_maxattempts`,
then resume from `spa_stage`. Rows at `maxAttempts` are dead-lettered, escalated (HIL-08) and
alerted (NFR-003, NFR-004). The original email is untouched throughout.

---

## Solution packaging (ALM)

`SPAMailboxAutomation` (managed for TEST and PROD, unmanaged in DEV) contains: the five flows, the
custom connector, the Copilot Studio agent, the model-driven review app, all Dataverse tables, the
environment variables and the connection references.

DEV (unmanaged) → export managed → TEST → PROD. Configuration data (scenarios, routing rules,
templates, thresholds) is moved with the **Configuration Migration Tool**, not embedded in the
solution, so Business can change a routing address in PROD without a deployment (NFR-015).
