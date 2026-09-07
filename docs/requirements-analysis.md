# PEP Passport SPA Box Automation – Agentic (WIT 504)
# Phase 0 — Business Requirements Analysis

| Field | Value |
|---|---|
| Document | Requirements Analysis (Phase 0 deliverable) |
| Work item | WIT 504 – PEP Passport SPA Box Automation – Agentic |
| Version | 1.0 |
| Status | For Business / Architecture review |
| Source of truth | Business Requirements Document (BRD) for WIT 504 |

---

## 0. Source-of-truth notice — read first

> **`REQUIREMENT GAP` GAP-001 — The BRD file itself was not present in the repository or the
> working environment.** The only BRD content available to this analysis is the structured
> restatement of it contained in the project development brief (12 scenarios, routing owners,
> recognition keywords, actions, reporting requirements, and the mandated Copilot Studio /
> Power Automate / Outlook–Teams technology direction).
>
> Every requirement in this document is therefore traced to **that restatement**, cited as
> `BRD§<section>` using the brief's numbering. Before production sign-off the original BRD must be
> attached to this repository at `docs/source/BRD-WIT504.<ext>` and this analysis re-verified
> line-by-line against it. Requirements that exist only in the brief and cannot be confirmed in
> the original BRD are flagged individually as `UNVERIFIED`.
>
> No business requirement in this document has been invented. Where the brief is silent, the gap
> is recorded in §15 rather than filled with an assumption.

---

## 1. Executive summary

The SPA shared mailbox is currently triaged manually. Every inbound message must be read, its
intent understood, its programme (FIT, FLO, MEC/CGR) identified, a response sent where one is
owed, the message forwarded to the right owner, filed into the right Outlook folder, and marked
read. A weekly report of volumes by region and scenario is produced every Friday.

This solution automates that triage with an **Agentic AI decisioning system wrapped in
deterministic enterprise controls**. The separation is mandatory and is the defining property of
the architecture:

| Layer | Responsibility | Technology |
|---|---|---|
| **AI decides what the email *means*** | intent, scenario, programme, entities, confidence | Copilot Studio agent + Azure OpenAI (Azure AI Foundry) |
| **Business rules decide what is *permitted*** | action allow-list, routing destinations, templates, thresholds | Decision Service + Dataverse configuration |
| **Microsoft services *execute*** | reply, forward, move, mark read, delete | Power Automate + Microsoft Graph |
| **Dataverse/Azure provide *state, audit, reporting*** | idempotency, audit trail, human review, Friday report | Dataverse + Power BI + Application Insights |

The AI never performs a mailbox operation and never chooses a destination address. It emits a
structured, schema-validated classification; deterministic code maps that classification onto an
approved action drawn from configuration. Anything the AI is not confident about, or that
configuration does not sanction, goes to a human review queue rather than to the mailbox.

Twelve business scenarios are in scope. Nine of the twelve resolve to a routing or filing action
that is fully specified by the BRD. Three (change-request routing, region-based reporting, and the
approved response-template bodies) depend on information the business has not yet supplied; those
are implemented as configuration-driven capability that becomes operative the moment the values
arrive, and are listed as blocking gaps in §15.

**Recommended posture for go-live:** run the system in *shadow mode* (classify, log, and produce
the human-review queue, but suppress outbound sends) until the confidence thresholds in §9 have
been tuned against real traffic, then enable auto-action scenario-by-scenario. This is an
implementation decision (AD-014), not a BRD requirement.

---

## 2. Functional requirements

Derived from `BRD§1` (business objective list), `BRD§6` (scenarios), `BRD§19` (reporting).

### 2.1 Core processing

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-001 | Monitor incoming email in the SPA shared mailbox and trigger processing on arrival. | BRD§1.1 | Must |
| FR-002 | Read and capture email subject, body, sender information and attachments. | BRD§1.2 | Must |
| FR-003 | Understand the intent and context of the email (semantic, not keyword-only). | BRD§1.3, §28 | Must |
| FR-004 | Identify the applicable business scenario from the twelve defined scenarios. | BRD§1.4, §6 | Must |
| FR-005 | Identify the programme where applicable: FIT, FLO, MEC/CGR, or All. | BRD§1.5 | Must |
| FR-006 | Determine the appropriate routing/action for the classified email. | BRD§1.6 | Must |
| FR-007 | Send an automated response where the scenario requires one. | BRD§1.7 | Must |
| FR-008 | Forward or route the email to the appropriate owner/team. | BRD§1.8 | Must |
| FR-009 | Move the email into the appropriate Outlook folder. | BRD§1.9 | Must |
| FR-010 | Mark the email as read where required. | BRD§1.10 | Must |
| FR-011 | Suppress further BOT processing on a thread once the designated human owner has responded. | BRD§1.11 | Must |
| FR-012 | Handle low-confidence and unknown requests through human intervention. | BRD§1.12 | Must |
| FR-013 | Maintain an auditable record of every processed email and every action taken. | BRD§1.13 | Must |
| FR-014 | Produce the required weekly Friday report. | BRD§1.14, §19 | Must |

### 2.2 Classification and decisioning

| ID | Requirement | Source | Priority |
|---|---|---|---|
| FR-020 | Classification must return a structured JSON object conforming to a published schema. | BRD§5 Flow 2 | Must |
| FR-021 | Classification output must be schema-validated before any action is executed; invalid output routes to human review. | BRD§5 Flow 1.8, §10 | Must |
| FR-022 | The classification must carry a numeric confidence score. | BRD§5, §9 | Must |
| FR-023 | The classification must carry a business-readable `reasoningSummary`; chain-of-thought must not be exposed. | BRD§5, Rule 11 | Must |
| FR-024 | Support multi-intent emails: identify all intents, select the primary actionable intent, and set a `multiIntent` flag. | BRD§7 | Must |
| FR-025 | Escalate to human review when multiple intents cannot be safely reconciled or produce contradictory routing. | BRD§7.5 | Must |
| FR-026 | Determine FIT vs FLO from explicit mention, context, keywords, thread history, business rules and sender information. | BRD§8 | Must |
| FR-027 | **Deterministic fallback:** when FIT/FLO is not established, route to *both* Josh Baxter and Jordan Beahrs. | BRD§8 (explicit) | Must |
| FR-028 | Do not assign FIT/FLO with high confidence when evidence is insufficient; emit `UNKNOWN`. | BRD§8, §11 | Must |
| FR-029 | Extract entities: learner name, GPID, email, programme, island, week, error message. | BRD§5 schema | Must |
| FR-030 | Confidence thresholds must be centrally configurable and tunable by Business without code change. | BRD§9 | Must |
| FR-031 | The agent may select only from an explicitly defined action set; it must not invent actions. | BRD§2, Rule 12 | Must |
| FR-032 | Return `UNKNOWN` rather than guessing when evidence is insufficient. | BRD§11 | Must |

### 2.3 Actions (the approved action set)

| ID | Action | Source |
|---|---|---|
| FR-040 | `SendResponse` — send a templated reply to the original sender. | BRD§4 Phase 4 |
| FR-041 | `ForwardEmail` — forward to a configured routing address. | BRD§4 Phase 4 |
| FR-042 | `MoveEmail` — move to a configured Outlook folder. | BRD§4 Phase 4 |
| FR-043 | `MarkAsRead` — set the message read flag. | BRD§4 Phase 4 |
| FR-044 | `DeleteEmail` — delete the message (Scenario 8 only). | BRD§4 Phase 4, §6 SC-08 |
| FR-045 | `RouteToChangeRequest` — direct the requester into the formal PEP Passport change-request process. | BRD§4 Phase 4 |
| FR-046 | `RouteToProgramOwner` — route to the FIT/FLO/Schoox owner from configuration. | BRD§4 Phase 4 |
| FR-047 | `EscalateToHumanReview` — place the item in the human review queue. | BRD§4 Phase 4, §10 |
| FR-048 | `GenerateReport` — produce the weekly report. | BRD§4 Phase 4, §19 |
| FR-049 | Every action must validate its inputs before execution; destinations must resolve from configuration only. | Rule 16 |
| FR-050 | No email may be sent unless the selected scenario explicitly permits sending. | Rule 14 |
| FR-051 | No message may be deleted unless the selected scenario explicitly permits deletion. | Rule 15 |

### 2.4 Human-in-the-loop

| ID | Requirement | Source |
|---|---|---|
| FR-060 | Trigger human review on: low confidence; conflicting scenarios; undeterminable FIT/FLO; unknown routing owner; invalid AI output; missing required information; unexpected scenario; repeated downstream failure. | BRD§10 |
| FR-061 | The reviewer can view the original email, the AI classification, and the extracted entities. | BRD§10 |
| FR-062 | The reviewer can change scenario, programme and routing. | BRD§10 |
| FR-063 | The reviewer can approve or reject the proposed action, and supply a correction. | BRD§10 |
| FR-064 | Human corrections are recorded for future prompt/model improvement. | BRD§10 |

### 2.5 Integrity, safety and idempotency

| ID | Requirement | Source |
|---|---|---|
| FR-070 | An email must never be processed more than once unintentionally. | BRD§15 |
| FR-071 | Idempotency keys: Message ID, Internet Message ID, processing status, and body hash where required. | BRD§15 |
| FR-072 | Safely absorb Power Automate retries, duplicate triggers, transient failures, agent timeout, Graph timeout and downstream failure. | BRD§15 |
| FR-073 | The system must not process its own outgoing responses. | BRD§17 |
| FR-074 | Prevent infinite reply/forward loops. | BRD§17 |
| FR-075 | Identify and suppress automated/system messages. | BRD§5 Flow 1.5, §6 SC-08 |
| FR-076 | Customer-facing text must come from approved templates; free generation is prohibited. | BRD§16, Rule 14 |
| FR-077 | Where dynamic text is unavoidable it must be constrained and validated: no invented URLs, no invented instructions, no unsupported promises, no internal disclosure. | BRD§16 |
| FR-078 | Email content is untrusted input; embedded instructions must never be followed. | BRD§Phase 7, Rule 13 |

### 2.6 Attachments

| ID | Requirement | Source |
|---|---|---|
| FR-080 | Detect the presence of attachments and capture file name, extension, MIME type, size, message ID and attachment ID. | BRD§18 |
| FR-081 | The AI must be aware that an attachment exists (as a classification signal). | BRD§18 |
| FR-082 | Do not automatically process arbitrary file types unless explicitly supported. | BRD§18 |
| FR-083 | Attachment processing must be an extensible interface (screenshot/document handlers pluggable). | BRD§18 |

### 2.7 Reporting

| ID | Requirement | Source |
|---|---|---|
| FR-090 | Report emails received per region. | BRD§19.1 |
| FR-091 | Report emails per scenario per region. | BRD§19.2 |
| FR-092 | Report count forwarded to Josh / Jordan. | BRD§19.3 |
| FR-093 | Report count routed to Amy / Schoox. | BRD§19.4 |
| FR-094 | Report count routed to Change Request. | BRD§19.5 |
| FR-095 | Report count resolved. | BRD§19.6 |
| FR-096 | Report scenario counts for all twelve scenarios across all regions. | BRD§19.7 |
| FR-097 | Region mapping must be table-driven and configurable; it must not be invented. | BRD§19 ("To be Provided by Amy") |
| FR-098 | The Friday report must be generated automatically. | BRD§19 |

---

## 3. Non-functional requirements

| ID | Category | Requirement | Source |
|---|---|---|---|
| NFR-001 | Reliability | Every external dependency has timeout, retry, exponential backoff and a maximum retry count. | BRD§22 |
| NFR-002 | Reliability | Failure must never result in silent email loss; the original message is preserved. | BRD§22 |
| NFR-003 | Reliability | On failure: record, preserve, prevent duplicate processing, route to exception queue, alert. | BRD§22 |
| NFR-004 | Reliability | Dead-letter handling for terminally failed items. | BRD§22 |
| NFR-005 | Observability | Capture correlation ID, processing ID, message ID, flow execution, AI call status, AI latency, classification result, confidence, selected action, execution result, errors, retries, human intervention, completion time. | BRD§20 |
| NFR-006 | Observability | Use Application Insights / Azure Monitor / Power Platform monitoring / Dataverse auditing. | BRD§20 |
| NFR-007 | Privacy | Never log sensitive email content unnecessarily. | BRD§20 |
| NFR-008 | Security | Authenticate via Microsoft Entra ID. | BRD§21 |
| NFR-009 | Security | No passwords, client secrets, API keys or tokens in source code. | BRD§21, Rule 4 |
| NFR-010 | Security | Managed Identity preferred; Azure Key Vault where secrets are unavoidable. | BRD§21 |
| NFR-011 | Security | Least privilege and RBAC throughout. | BRD§21 |
| NFR-012 | Security | All required permissions documented. | BRD§21 |
| NFR-013 | Security | Resist prompt injection, HTML injection, malicious attachment names and instruction injection. | BRD§Phase 7 |
| NFR-014 | Security | No data leakage through AI responses. | BRD§Phase 7 |
| NFR-015 | Configurability | Business rules, routing, templates and thresholds configurable without code change. | BRD§12, §13, §9, Rule 3 |
| NFR-016 | Maintainability | Clean architecture with separation of concerns. | Rule 8 |
| NFR-017 | Maintainability | Prompts version-controlled and externalised from application code. | BRD§11 |
| NFR-018 | Testability | Every scenario has automated tests. | Rule 10 |
| NFR-019 | Traceability | Every business rule traceable to the BRD or explicitly marked an implementation decision. | Rule 9 |
| NFR-020 | Deployability | DEV/TEST/PROD with environment-specific configuration; IaC via Bicep and Power Platform ALM. | BRD§Phase 8 |
| NFR-021 | Deployability | No environment-specific values in source code. | BRD§Phase 8 |
| NFR-022 | Governance | The LLM must not perform unrestricted mailbox operations. | Rule 12 |

> `REQUIREMENT GAP` GAP-002 — **No quantitative NFR targets are stated.** Expected daily/weekly
> mail volume, peak burst rate, end-to-end latency target, auto-response SLA, availability target
> and RPO/RTO are all absent. The architecture is sized for a small-to-moderate shared mailbox
> (order 10²–10³ messages/week) as implementation decision AD-015; this must be confirmed.

---

## 4. The twelve business scenarios

Recognition keywords below are reproduced verbatim from `BRD§6`. They are used as *evidence
signals and retrieval hints*, **not** as the classification mechanism — §28 of the brief is
explicit that this is not a keyword bot. Keywords live in configuration (`config/scenarios.json`)
and feed both the few-shot prompt context and the deterministic corroboration check.

### SC-01 — Learner cannot advance in FIT/FLO journey
- **Intent:** Learner is blocked progressing through the FIT or FLO journey.
- **Signals:** cannot move on, stuck, island, advance, proceed, submit, questionnaire, survey, greyed out, trouble submitting, data not saved.
- **Programme:** FIT or FLO (determined per §8; fallback FR-027).
- **Routing:** FIT → Jordan.Beahrs@pepsico.com · FLO → Josh.Baxter@pepsico.com.
- **Response:** approved troubleshooting template (initial contact).
- **Escalation:** if the user confirms the issue persists, or supplies a screenshot or GPID, escalate to the programme owner.
- **Actions:** `SendResponse` → `MoveEmail` → `MarkAsRead`; on escalation `ForwardEmail`/`RouteToProgramOwner`.
- **Gaps:** GAP-004 (template body), GAP-005 (destination folder), GAP-010 (how "persists" is detected and how long to wait).

### SC-02 — FIT/FLO login, access, authenticator or cache issue
- **Intent:** Learner cannot log in or access the platform.
- **Signals:** unable to access, login, sign in, authenticator, cache, access permissions, not registered, enrollment, cannot access.
- **Programme:** FIT or FLO (fallback FR-027).
- **Routing:** FIT → Jordan.Beahrs@pepsico.com · FLO → Josh.Baxter@pepsico.com.
- **Response:** approved troubleshooting response **before** escalation where applicable.
- **Actions:** `SendResponse` → `MoveEmail` → `MarkAsRead`; escalate via `RouteToProgramOwner`.
- **Gaps:** GAP-004, GAP-005.

### SC-03 — Manager access / manager change
- **Intent:** Manager assignment, manager change, or manager-side access problem.
- **Signals:** manager access, manager change, new manager, manager ID, manager email, check-ins, direct supervisor.
- **Branching rule (BRD-explicit):**
  - *Change request* (assign/replace a manager) → formal PEP Passport change-request process → `RouteToChangeRequest`.
  - *Technical access problem* (manager cannot get in / cannot see check-ins) → FIT/FLO owner → `RouteToProgramOwner`.
- **Gaps:** GAP-003 (change-request process mechanics), GAP-005.

### SC-04 — PEP Passport Change Request form notification / acknowledgement
- **Intent:** System notification that a change-request form was submitted or completed.
- **Signals:** "New response for Pep Passport Change Request Form", Request ID, submitted your request, completed.
- **Actions (BRD-explicit):** **no response**; `MarkAsRead`; `MoveEmail` → *Pep Passport Change Requests* folder.
- **Notes:** highest-precision scenario — the trigger phrases are machine-generated and near-deterministic.

### SC-05 — Peer trainer access / trainer not showing in dropdown
- **Intent:** Peer-trainer assignment or trainer-visibility problem.
- **Signals:** peer trainer, trainer access, dropdown, does not show name, assign, skills check.
- **Branching rule (BRD-explicit):**
  - *Trainer change required* → `RouteToChangeRequest`.
  - *Existing trainer has a technical access issue* → `RouteToProgramOwner` (FIT/FLO).
- **Gaps:** GAP-003, GAP-005.

### SC-06 — Remove learner
- **Intent:** Request to remove a learner from PEP Passport / FLO.
- **Signals:** remove from PEP Passport, no longer with organization, remove from FLO, duplication, both onboarding paths, employee no longer.
- **Action (BRD-explicit):** `RouteToChangeRequest` (formal change-request process).
- **Gaps:** GAP-003, GAP-005.

### SC-07 — Schoox / MEC / CGR
- **Intent:** Anything relating to the Merch Effectiveness Coach pathway, Schoox, or CGR.
- **Signals:** Merch Effectiveness Coach, MEC, Schoox pathway, workweeks, deck, resources, capstone, responsibilities, CGR.
- **Routing (BRD-explicit):** direct to amy.fischer@pepsico.com.
- **Folder:** *Schoox*.
- **Exclusion rule (BRD-explicit):** do **not** route to FIT/FLO owners unless the email contains a *separate* FIT/FLO issue — i.e. this scenario interacts with multi-intent handling (§7).
- **Actions:** `ForwardEmail` → `MoveEmail` → `MarkAsRead`.

### SC-08 — Automatic replies / out-of-office
- **Intent:** Machine-generated auto-reply.
- **Signals:** automatic reply, out of office, limited access, urgent issues.
- **Actions (BRD-explicit):** `MarkAsRead`; `DeleteEmail`; **no response**.
- **Notes:** must also be detectable from RFC headers (`Auto-Submitted`, `X-Auto-Response-Suppress`) — see AD-009. This is the only scenario permitted to delete (FR-051).
- **Gaps:** GAP-006 (soft delete to Deleted Items vs hard delete; retention/compliance).

### SC-09 — Dashboard / reporting
- **Intent:** Dashboard access, location visibility or reporting request.
- **Signals:** dashboard, location visibility, reporting, full location view, dashboard access.
- **Branching rule (BRD-explicit):**
  - *Access/visibility grant* → `RouteToChangeRequest` where applicable.
  - *Technical issue* → FIT → Jordan.Beahrs@pepsico.com · FLO → Josh.Baxter@pepsico.com.
- **Gaps:** GAP-003, GAP-005, GAP-011 (the boundary between "change request where applicable" and "technical issue" is judgement-based; codified as a configurable sub-intent rule).

### SC-10 — Content / materials / resources
- **Intent:** Question about learning content or materials.
- **Signals:** Articulate360, Rise, PowerPoint, PPT, PDF, content, certification, capstone.
- **Routing:** FIT → Jordan.Beahrs@pepsico.com · FLO → Josh.Baxter@pepsico.com.
- **Folder:** "appropriate inquiry folder".
- **Gaps:** GAP-005 — "appropriate inquiry folder" is not named anywhere in the BRD.
- **Note:** "capstone" is a signal for both SC-07 and SC-10 — an intentional overlap that must be
  disambiguated by MEC/Schoox context, not by keyword. See §8 conflict rules.

### SC-11 — Request completed / sender confirms resolved
- **Intent:** Sender thanks the team or confirms the issue is resolved.
- **Signals:** thank you, resolved, all good, confirmed access, completed, able to work.
- **Actions (BRD-explicit):** `MarkAsRead`; `MoveEmail` → *Resolved* folder; **no response**.
- **Note:** interacts with FR-011 — a "thanks" arriving on a thread the human owner already
  answered must close the thread, not restart processing.

### SC-12 — Learner email address update
- **Intent:** Learner's email address is wrong or has changed.
- **Signals:** new email, email address ready, incorrect email, email change.
- **Action (BRD-explicit):** `RouteToChangeRequest`.
- **Response:** template selected **by sender type**.
- **Gaps:** GAP-003, GAP-007 (the sender-type taxonomy is referenced but never defined), GAP-004.

### SC-99 — Unknown / unclassifiable *(implementation decision AD-001)*
Not a BRD scenario. A terminal bucket required by FR-012, FR-032 and BRD§10 so that anything the
agent cannot place lands in the human review queue instead of being forced into one of the twelve.
Action: `EscalateToHumanReview`. No outbound email, no deletion, no move.

---

## 5. Routing matrix

Owner addresses are BRD-explicit. They are held in `config/routing-rules.json` / Dataverse and
resolved at runtime — never hard-coded in flow logic (Rule 3, Rule 16).

| Scenario | Programme = FIT | Programme = FLO | Programme = MEC/CGR | Programme unknown |
|---|---|---|---|---|
| SC-01 | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh (FR-027) |
| SC-02 | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh |
| SC-03 (change) | Change-request process | Change-request process | n/a | Change-request process |
| SC-03 (technical) | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh |
| SC-04 | *no routing* | *no routing* | n/a | *no routing* |
| SC-05 (change) | Change-request process | Change-request process | n/a | Change-request process |
| SC-05 (technical) | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh |
| SC-06 | Change-request process | Change-request process | n/a | Change-request process |
| SC-07 | n/a | n/a | amy.fischer@pepsico.com | amy.fischer@pepsico.com |
| SC-08 | *no routing* | *no routing* | *no routing* | *no routing* |
| SC-09 (change) | Change-request process | Change-request process | n/a | Change-request process |
| SC-09 (technical) | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh |
| SC-10 | Jordan.Beahrs@pepsico.com | Josh.Baxter@pepsico.com | n/a | **both** Jordan + Josh |
| SC-11 | *no routing* | *no routing* | *no routing* | *no routing* |
| SC-12 | Change-request process | Change-request process | n/a | Change-request process |
| SC-99 | Human review queue | Human review queue | Human review queue | Human review queue |

**Rule R-1 (FR-027, BRD§8, explicit):** if FIT/FLO is not established for a scenario whose routing
depends on programme, the message goes to *both* Jordan Beahrs and Josh Baxter. This is a
deterministic rule evaluated after classification — it is never an AI decision.

**Rule R-2 (BRD§6 SC-07, explicit):** an MEC/CGR/Schoox email is not routed to FIT/FLO owners
unless a *separate* FIT/FLO issue is present in the same email. When both are present the message
is multi-intent and both routes apply (see §7).

> `REQUIREMENT GAP` GAP-003 — **The formal PEP Passport change-request process has no mechanics
> in the BRD.** Four scenarios (SC-06, SC-12) route to it unconditionally and three more
> conditionally (SC-03, SC-05, SC-09). Unknown: the form URL, whether automation submits on the
> requester's behalf or replies with a link, the notification mailbox, and the owning team.
> Modelled as routing target `CHANGE_REQUEST` with a configurable strategy
> (`reply_with_link` | `forward_to_mailbox` | `both`); no strategy is enabled by default.

---

## 6. Action matrix

Executed strictly in the listed order; a failed step halts the sequence and raises the failure
path (NFR-002/003). "Auto-send permitted" is the gate enforcing Rule 14; "delete permitted" the
gate enforcing Rule 15.

| Scenario | SendResponse | Forward / Route | MoveEmail | MarkAsRead | Delete | Auto-send permitted | Delete permitted |
|---|---|---|---|---|---|---|---|
| SC-01 | template (troubleshooting) | on escalation | inquiry folder | yes | no | **yes** | no |
| SC-02 | template (troubleshooting) | on escalation | inquiry folder | yes | no | **yes** | no |
| SC-03 | template (per branch) | owner or CR | folder per branch | yes | no | **yes** | no |
| SC-04 | **none** | none | Pep Passport Change Requests | yes | no | no | no |
| SC-05 | template (per branch) | owner or CR | folder per branch | yes | no | **yes** | no |
| SC-06 | template (change request) | CR | folder | yes | no | **yes** | no |
| SC-07 | none *(not stated)* | amy.fischer@pepsico.com | Schoox | yes | no | no | no |
| SC-08 | **none** | none | none | yes | **yes** | no | **yes** |
| SC-09 | template (per branch) | owner or CR | folder per branch | yes | no | **yes** | no |
| SC-10 | template *(not stated)* | owner | inquiry folder | yes | no | no | no |
| SC-11 | **none** | none | Resolved | yes | no | no | no |
| SC-12 | template (by sender type) | CR | folder | yes | no | **yes** | no |
| SC-99 | none | human review queue | none | no | no | no | no |

**Interpretation note (AD-002):** where the BRD does not state that a response is sent (SC-07,
SC-10), `sendResponseAllowed` defaults to **false**. Rule 14 requires explicit permission to send;
silence is not permission. Business can enable these per scenario in configuration.

---

## 7. Multi-intent decision rules

Required by `BRD§7`. The BRD mandates the capability but does not define the resolution policy;
the policy below is implementation decision **AD-003** and is fully configurable.

| Combination | Resolution |
|---|---|
| Two intents, same programme, same owner | Single route; `multiIntent = true`; primary intent = the one with an actionable blocked-user impact. |
| MEC/Schoox (SC-07) + a FIT/FLO issue | **Both** routes execute (BRD§6 SC-07 exclusion rule, R-2). Folder = Schoox. `multiIntent = true`. |
| Change-request intent + technical intent | Human review — the two produce contradictory destinations and the BRD gives no precedence. |
| Any intent + SC-08 (auto-reply) | SC-08 wins; auto-replies carry no actionable content. |
| Any intent + SC-11 (resolved) | Human review unless SC-11 is the only intent — "thanks, but also…" must not silently close an open issue. |
| Any intent + SC-04 (CR form notification) | SC-04 wins if the message is machine-generated; otherwise human review. |
| Three or more distinct actionable intents | Human review. |
| Intents resolving to different programme owners with no shared owner | Human review. |

**Precedence order** (configurable, `config/routing-rules.json` → `multiIntent.precedence`):
`SC-08` > `SC-04` > `SC-07` > `SC-01`/`SC-02` > `SC-03`/`SC-05`/`SC-09` > `SC-06`/`SC-12` > `SC-10` > `SC-11`.

The primary intent is never selected by first-keyword-match (BRD§7 explicitly prohibits this).

---

## 8. FIT / FLO determination

Per `BRD§8`, six evidence sources, evaluated as a weighted evidence set rather than a
keyword lookup. Weights are configuration (`config/thresholds.json` → `programEvidence`) and are
implementation decision **AD-004**.

| Evidence source | Example | Default weight |
|---|---|---|
| Explicit programme mention | "my FIT journey" | 1.00 (decisive) |
| Programme-specific vocabulary | FLO island names, FIT capstone terms | 0.60 |
| Thread/conversation history | earlier message in the thread named the programme | 0.50 |
| Business rules | scenario is MEC-only ⇒ programme = MEC/CGR | 0.80 |
| Sender information | sender's prior classified traffic | 0.30 |
| Generic keywords | ambiguous terms present in both programmes | 0.10 |

Resolution:
1. Explicit mention present and unambiguous ⇒ programme assigned, high confidence.
2. Aggregate evidence ≥ `programConfidenceThreshold` (default 0.75) ⇒ programme assigned.
3. Otherwise programme = `UNKNOWN`, and **Rule R-1** fires: route to both owners (FR-027).
4. Conflicting explicit mentions of both FIT and FLO ⇒ `multiIntent` review, never a coin-flip.

FR-028 is enforced structurally: the classifier prompt permits `UNKNOWN` as a first-class value and
the deterministic layer caps programme confidence when the only evidence is a generic keyword.

---

## 9. Confidence model

`BRD§9` states the thresholds and requires them to be configurable and centrally held.

| Band | Range | Behaviour |
|---|---|---|
| High | `confidence >= 0.90` | Automatic action, subject to the scenario's action permissions. |
| Medium | `0.75 – 0.89` | Restricted automation: non-destructive, non-outbound actions only (move/mark-read/route) plus deterministic corroboration; outbound send requires corroboration to pass. |
| Low | `< 0.75` | Human review; no automated action. |

Enforced properties:
- Values live once, in `config/thresholds.json`, surfaced through Dataverse `Configuration`; no
  threshold literal appears anywhere else in the codebase (FR-030, Rule 3).
- Thresholds are per-scenario overridable — SC-04 and SC-08 are machine-generated and can be
  tuned tighter or looser independently of judgement-heavy scenarios such as SC-09.
- Destructive actions (`DeleteEmail`) always require the High band regardless of override (AD-005).

**Medium-band confirmation** (AD-006): a medium-band item may be actioned only with independent
confirmation, from **either** of two sources:

1. **Deterministic corroboration** - the scenario's configured signals are present in the email and
   no other scenario's evidence contests them; or
2. **An explicit agreement** from the `routing_decision_validator` prompt (prompt 5).

They are alternatives, not cumulative requirements. An item usually reaches the medium band
*because* corroboration failed, so requiring corroboration again would make the band dead and leave
"restricted automation" meaning "always human review". Neither source available means human review.

**Multi-intent always requires the validator's agreement**, at any band (AD-024): two genuine
intents can involve two different teams, and confidence in the primary label says nothing about
whether acting on it alone is right.

A validator *disagreement* demotes at any band; a validator *agreement* never promotes an item past
a gate it has already failed (an inactive template, a delete below the high band, a disabled
capability).

---

## 10. Human-in-the-loop requirements

Triggers (all BRD§10, plus AD-007 for the last row):

| ID | Trigger |
|---|---|
| HIL-01 | Classification confidence below the low threshold. |
| HIL-02 | Multiple scenarios conflict (see §7). |
| HIL-03 | FIT/FLO cannot be reliably determined **and** the scenario cannot proceed without it. |
| HIL-04 | Routing owner unknown or unresolvable from configuration. |
| HIL-05 | AI returned structurally invalid output. |
| HIL-06 | Required information missing (e.g. GPID needed for escalation and absent). |
| HIL-07 | An unexpected scenario was detected (`SC-99`). |
| HIL-08 | A downstream action failed repeatedly (retries exhausted). |
| HIL-09 | *(AD-007)* Guardrail violation — prompt injection detected, or the AI proposed an action or destination not in the approved set. |

Reviewer capabilities: view original email, view classification, view entities, change scenario,
change programme, change routing, approve, reject, correct. All corrections are persisted to
`HumanReviewCorrection` for prompt/model improvement (FR-064).

> `REQUIREMENT GAP` GAP-008 — the BRD does not name the human reviewers, the review SLA, or the
> surface (Teams / model-driven app / Outlook). A model-driven Power App backed by Dataverse plus
> a Teams adaptive-card notification is proposed as AD-008.

---

## 11. Response-template matrix

`BRD§12` mandates a configurable template repository and prohibits templates embedded in flow
actions.

| Template ID | Scenario | Programme | Sender type | Purpose | Content available? |
|---|---|---|---|---|---|
| TPL-SC01-TSHOOT | SC-01 | FIT / FLO / ALL | any | Initial troubleshooting steps | **No — GAP-004** |
| TPL-SC02-TSHOOT | SC-02 | FIT / FLO / ALL | any | Login / access troubleshooting | **No — GAP-004** |
| TPL-SC03-CR | SC-03 | ALL | any | Direct to change-request process | **No — GAP-003/004** |
| TPL-SC05-CR | SC-05 | ALL | any | Trainer change → change request | **No — GAP-003/004** |
| TPL-SC06-CR | SC-06 | ALL | any | Learner removal → change request | **No — GAP-003/004** |
| TPL-SC09-CR | SC-09 | ALL | any | Dashboard access → change request | **No — GAP-003/004** |
| TPL-SC12-CR-LEARNER | SC-12 | ALL | learner | Email update → change request | **No — GAP-003/004/007** |
| TPL-SC12-CR-MANAGER | SC-12 | ALL | manager | Email update → change request | **No — GAP-003/004/007** |
| TPL-SC01-ESCALATED | SC-01 | FIT / FLO | any | Acknowledge escalation to owner | **No — GAP-004** |

Template record fields (BRD§12, verbatim): Template ID, Scenario ID, Programme, Sender type,
Template type, Subject template, Body template, Active flag, Version, Effective date, Last modified
date.

> `REQUIREMENT GAP` GAP-004 — **No approved template body text exists in the BRD.** The BRD refers
> to "the approved troubleshooting template" and "the appropriate response template" without
> supplying either. The repository ships the template *schema*, the *selection logic*, the
> *variable allow-list* and the *validation*, with every body seeded as an inactive placeholder
> carrying `active: false`. **No email can be sent until Business supplies and activates the
> approved text** — this is enforced in code, not by convention.

> `REQUIREMENT GAP` GAP-007 — **The sender-type taxonomy is undefined.** SC-12 selects a template
> "based on sender type" but the BRD never enumerates the types. Implemented as a configurable
> enumeration seeded with `learner | manager | peer_trainer | hr | internal | external | system |
> unknown` (AD-010) for review; classification of sender type is emitted with its own confidence
> and defaults to `unknown`, which selects no template and forces human review.

---

## 12. AI decision matrix

What the AI decides versus what deterministic code decides. This table is the contract for
`BRD§28` and Rule 12, and is the basis of the security model.

| Decision | AI | Deterministic | Rationale |
|---|---|---|---|
| What does this email mean (intent)? | ✅ | | Semantic understanding. |
| Which of the 12 scenarios applies? | ✅ (proposes) | ✅ (validates against allow-list) | AI proposes from a closed enum; code rejects anything outside it. |
| FIT or FLO? | ✅ (evidence) | ✅ (threshold + fallback R-1) | AI supplies evidence, code applies the BRD fallback rule. |
| Are multiple intents present? | ✅ | ✅ (precedence + conflict rules) | Detection is semantic; resolution is policy. |
| Which entities are present? | ✅ | ✅ (format validation: GPID, email) | Extraction is semantic; shape is verifiable. |
| Is required information missing? | ✅ | ✅ | |
| Confidence score | ✅ | ✅ (calibration, banding, capping) | AI self-report is untrusted alone. |
| Sender type | ✅ | ✅ (domain rules) | |
| **Which action to take** | | ✅ | Rule 12 — from the scenario's configured action set only. |
| **Which address to route to** | | ✅ | Rule 16 — from routing configuration only. Never from AI output. |
| **Which folder to move to** | | ✅ | From configuration. |
| **Whether sending is permitted** | | ✅ | Rule 14 — scenario permission gate. |
| **Whether deletion is permitted** | | ✅ | Rule 15 — SC-08 only. |
| **Which template to use** | ✅ (proposes ID) | ✅ (resolves, validates, checks active) | AI cannot introduce a template that does not exist or is inactive. |
| **Body of the outbound email** | | ✅ | BRD§16 — approved templates with an allow-listed variable set. |
| Idempotency / duplicate detection | | ✅ | |
| Loop prevention | | ✅ | |
| Audit write | | ✅ | |
| Report generation | | ✅ | |

---

## 13. Data requirements

Entities per `BRD§14`. Full physical model in `docs/data-model.md`.

| Entity | Purpose | Class |
|---|---|---|
| `EmailProcessing` | One row per processed message; the idempotency and audit spine. | Operational |
| `ClassificationResult` | Structured AI output, prompt version, model, latency, token usage. | Operational |
| `EmailAction` *(AD-011)* | One row per action attempt — required to satisfy "auditable record of every action" (FR-013); the BRD's entity list has no per-action grain. | Operational |
| `Attachment` *(AD-011)* | Attachment metadata per FR-080. | Operational |
| `BusinessScenario` | The twelve scenarios plus SC-99. | Configuration |
| `RoutingRule` | Routing configuration per BRD§13. | Configuration |
| `ResponseTemplate` | Templates per BRD§12. | Configuration |
| `ProcessingError` | Errors and retry state. | Operational |
| `Configuration` | Thresholds and application configuration. | Configuration |
| `HumanReviewQueue` *(AD-011)* | Review work items and outcomes. | Operational |
| `HumanReviewCorrection` *(AD-011)* | Corrections captured for improvement (FR-064). | Operational |
| `RegionMapping` *(AD-011)* | Region resolution for reporting (FR-097). Ships **empty**. | Configuration |
| `WeeklyReportRun` *(AD-011)* | Friday report execution audit. | Operational |

`EmailProcessing` carries exactly the BRD§14 field list; extensions are marked in the data model.

**Data-protection note (AD-012):** GPID and learner name are personal data. Default configuration
stores a **hash** of the body (`BodyHash`, BRD§14) and a truncated subject, not the full body;
full-body retention is an explicit opt-in flag because NFR-007 requires content not be persisted
unnecessarily.

> `REQUIREMENT GAP` GAP-009 — no data-retention period, no confirmation of the lawful basis for
> storing GPID/learner name in Dataverse, and no statement on whether email bodies may be sent to
> Azure OpenAI (cross-border processing, data-residency). **This is a blocking gap for PROD.**

---

## 14. Integration requirements

| ID | Integration | Direction | Purpose | Auth |
|---|---|---|---|---|
| INT-01 | Exchange Online / SPA shared mailbox | in | Trigger on new mail | Entra ID, delegated-to-shared or application permission |
| INT-02 | Microsoft Graph `/messages` | in/out | Read full message, `internetMessageId`, headers, attachments; move, mark read, reply, forward, delete | Managed Identity + Graph application permissions |
| INT-03 | Power Automate cloud flows | orchestration | Flow 1 intake, Flow 3 human review, Flow 4 weekly report | Connection references |
| INT-04 | Copilot Studio agent | in/out | Agentic classification surface | Entra ID |
| INT-05 | Azure OpenAI (Azure AI Foundry) | out | Model inference for classification prompts | Managed Identity |
| INT-06 | Dataverse | in/out | Configuration, audit, review queue | Managed Identity / service principal, least privilege |
| INT-07 | Application Insights | out | Telemetry | Managed Identity / connection string in Key Vault |
| INT-08 | Power BI | in | Friday report dataset | Dataverse connector |
| INT-09 | Microsoft Teams | out | Human review notification | Connection reference |
| INT-10 | Azure Key Vault | out | Secrets where unavoidable | Managed Identity |

Graph permissions and the full Entra app-registration matrix are in `docs/security-design.md`.

> `REQUIREMENT GAP` GAP-013 — the SPA shared mailbox address (UPN) is not stated in the BRD, nor
> is the tenant, nor the target Power Platform environments. All are configuration, none are
> defaulted.

---

## 15. Requirement gaps (consolidated)

| ID | Gap | Impacted requirements | Severity | Handling in this repo |
|---|---|---|---|---|
| GAP-001 | Original BRD file not supplied; analysis derived from the project brief's restatement. | all | **Blocking (sign-off)** | Every requirement cited to `BRD§`; re-verify on receipt. |
| GAP-002 | No volume, latency, availability, RPO/RTO or SLA targets. | NFR-* | High | Sized per AD-015; documented as an assumption. |
| GAP-003 | Formal PEP Passport change-request process mechanics unknown (URL, mailbox, submitter, owner). | SC-03, SC-05, SC-06, SC-09, SC-12; FR-045 | **Blocking (5 scenarios)** | `CHANGE_REQUEST` target with a configurable strategy; **disabled by default**. |
| GAP-004 | No approved response-template body text anywhere in the BRD. | FR-007, FR-040, SC-01/02/03/05/06/09/12 | **Blocking (all outbound mail)** | Templates ship inactive; send is code-blocked while inactive. |
| GAP-005 | Outlook folder names undefined except *Pep Passport Change Requests*, *Schoox*, *Resolved*. | FR-009, FR-042 | High | Folder map is configuration; unmapped scenario ⇒ no move + audit note. |
| GAP-006 | SC-08 "delete" not qualified: Deleted Items vs permanent; retention/compliance impact. | FR-044, SC-08 | High | Defaults to **soft delete** (Deleted Items) — reversible; hard delete requires explicit config. |
| GAP-007 | Sender-type taxonomy referenced (SC-12) but never enumerated. | FR-029, SC-12, templates | Medium | Configurable enumeration seeded for review; `unknown` ⇒ human review. |
| GAP-008 | Human reviewers, review SLA and review surface unspecified. | FR-060–064 | High | Model-driven app + Teams card proposed (AD-008). |
| GAP-009 | No data-retention period; no confirmation that email content may be sent to Azure OpenAI; residency unstated. | §13, NFR-007 | **Blocking (PROD)** | Body hashed by default; full-body storage and content-to-model are explicit opt-ins. |
| GAP-010 | SC-01/SC-02 escalation trigger ("user confirms issue persists") has no detection rule or waiting period. | SC-01, SC-02 | High | Modelled as a configurable follow-up rule; **disabled by default**. |
| GAP-011 | SC-09 boundary between "change request where applicable" and "technical issue" is judgement-based. | SC-09 | Medium | Configurable sub-intent rule; ambiguity ⇒ human review. |
| GAP-012 | Region mapping "To be Provided by Amy". | FR-090, FR-091, FR-096, FR-097 | **Blocking (reporting)** | `RegionMapping` table ships **empty**; unmapped rows aggregate to `UNMAPPED` and are reported as such rather than guessed. |
| GAP-013 | SPA mailbox UPN, tenant ID and Power Platform environment IDs not supplied. | INT-01, deployment | High | Configuration only; no defaults. |
| GAP-014 | Friday report recipients, send time, timezone and format not specified. | FR-014, FR-098 | High | Configurable; no default recipient list. |
| GAP-015 | FR-011 ("owner has responded ⇒ stop BOT processing") has no definition of *responded* or of scope/duration. | FR-011 | High | Implemented as thread-level suppression keyed on conversation ID when a configured owner address appears as a sender in the thread; scope and expiry configurable. |
| GAP-016 | Language coverage of the mailbox unstated (English-only?). | FR-003 | Medium | Prompts are English; non-English detection ⇒ human review. |
| GAP-017 | Whether auto-responses may be sent to **external** (non-pepsico.com) senders. | FR-007, FR-050 | High | Outbound recipients restricted to an allow-listed domain set; external ⇒ human review by default. |
| GAP-018 | Licensing/capacity not addressed: Copilot Studio message packs, Azure OpenAI TPM quota, Dataverse capacity. | all | High | Sizing inputs listed in `docs/deployment.md`. |
| GAP-019 | Attachment handling depth: is screenshot OCR required, or is presence-detection sufficient? | FR-080–083 | Medium | Presence + metadata implemented (BRD-required); OCR is a pluggable handler, **off by default**. |
| GAP-020 | No BRD statement on out-of-hours, holiday or weekend behaviour. | FR-001 | Low | Continuous processing assumed (AD-016). |

---

## 16. Assumptions

Each assumption is a decision taken because the BRD is silent. None contradicts the BRD.

| ID | Assumption |
|---|---|
| ASM-01 | The SPA mailbox is an Exchange Online shared mailbox in the same tenant as the Power Platform environments. |
| ASM-02 | Owners named in the BRD (Jordan Beahrs, Josh Baxter, Amy Fischer) are current and stable; they are configuration, changeable without deployment. |
| ASM-03 | Mail volume is within the capacity of a single Power Automate flow and a consumption/premium Function plan (AD-015). |
| ASM-04 | Business accepts a shadow-mode pilot before automated sending is enabled. |
| ASM-05 | Azure OpenAI is available in an approved region for the tenant, subject to GAP-009. |
| ASM-06 | Dataverse is the system of record for audit; Application Insights holds diagnostics, not business audit. |
| ASM-07 | Emails are predominantly English (GAP-016). |
| ASM-08 | The BOT's own address is well-known and can be excluded for loop prevention (FR-073). |
| ASM-09 | "Region" is a property of the sender or the learner, not of the message; the mapping table is keyed flexibly to accommodate either (GAP-012). |
| ASM-10 | Friday report is produced once weekly in the business's local timezone (GAP-014). |

---

## 17. Constraints

| ID | Constraint | Source |
|---|---|---|
| CON-01 | Microsoft-native stack: Copilot Studio, Power Automate, Outlook/Teams, Azure AI. | BRD§2 |
| CON-02 | The AI may not invent actions; it selects from an explicit tool set. | BRD§2, Rule 12 |
| CON-03 | No credentials in source code. | BRD§21, Rule 4 |
| CON-04 | No fabricated Microsoft APIs. | Rule 5 |
| CON-05 | No claim that an integration works unless implemented and tested. | Rule 6 |
| CON-06 | Production code, not pseudocode. | Rule 7 |
| CON-07 | Chain-of-thought must not be exposed. | Rule 11 |
| CON-08 | Email content is untrusted input. | Rule 13 |
| CON-09 | Routing destinations come only from approved configuration. | Rule 16 |
| CON-10 | No environment-specific values in source. | BRD§Phase 8 |
| CON-11 | .NET SDK is unavailable in this build environment; see AD-013 for the language decision. | Environment |

---

## 18. Architecture recommendations

1. **Move deterministic logic out of Power Automate expressions into a versioned, unit-tested
   Decision Service.** Power Automate remains the orchestrator and the executor of mailbox
   operations (as the BRD requires), but scenario resolution, threshold banding, multi-intent
   precedence, template selection and action validation live in code that can be tested (Rule 10)
   and reviewed. Business rules spread across flow conditions cannot satisfy NFR-018 or Rule 3.
2. **Make the action allow-list a hard runtime gate, not a prompt instruction.** Prompt-level
   restrictions are advisory; a validating executor is enforcement. Every action passes an
   `ActionValidator` that resolves destinations from configuration and rejects anything else.
3. **Use Microsoft Graph for message fidelity.** The Outlook connector does not reliably expose
   `internetMessageId`, `Auto-Submitted` headers or single-value extended properties — all of which
   are needed for idempotency (FR-071), auto-reply detection (FR-075) and loop prevention (FR-073).
4. **Two-key idempotency with a reservation write.** Claim the message in `EmailProcessing`
   (unique key on `InternetMessageId`) *before* any side effect, so Power Automate's at-least-once
   retry semantics cannot double-send.
5. **Stamp outbound mail with a custom internet header** (`X-SPA-Bot-ProcessingId`) so the system
   can recognise its own traffic structurally rather than by subject-string heuristics (FR-073).
6. **Ship the Friday report as Dataverse + Power BI *and* a Power Automate summary email.** The
   BRD asks for a report every Friday; the email guarantees delivery, Power BI gives analysis.
7. **Ship with all outbound actions disabled.** GAP-003, GAP-004 and GAP-017 make outbound mail
   unsafe today. Encode that in configuration rather than relying on operational discipline.
8. **Treat prompt injection as an expected input class, not an edge case.** Inbound content is
   delimited and neutralised, and the guardrail is the deterministic action gate — a successful
   injection can at worst produce a wrong classification, never a wrong destination.

---

## 19. Technology decisions

| ID | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| AD-013 | **Decision Service implemented in TypeScript (Node 22) on Azure Functions v4.** | Azure Functions Node.js v4 is a first-class, supported Microsoft runtime; it can be built and unit-tested in this environment, satisfying Rule 6 and Rule 10. **The .NET SDK is not installed here (CON-11), so a C# implementation could not be compiled or tested — shipping untested C# would violate Rule 6/7.** | C# / .NET 8 Isolated Functions — architecturally equivalent and equally valid; the design is language-neutral and the port is mechanical if PepsiCo standards require .NET. Recorded as a reversible decision. |
| AD-017 | Azure OpenAI via Azure AI Foundry for inference; Copilot Studio as the agent surface calling the Decision Service actions. | Keeps the agent's tool set identical to the validated action set; avoids two divergent decision paths. | Copilot Studio generative answers alone — rejected: insufficient control over structured output and action gating. |
| AD-018 | Dataverse for operational + configuration data. | BRD§14 preference; native to Power Platform ALM, Power BI and the model-driven review app. | Azure SQL / Cosmos — rejected: adds a second governance surface for business-facing data. |
| AD-019 | Bicep for Azure IaC; Power Platform managed solutions for Power Platform ALM. | BRD§Phase 8. | Terraform — rejected: BRD names Bicep. |
| AD-020 | JSON-schema-validated model output with a repair-then-fail path. | FR-021; structured output is the contract boundary between AI and deterministic control. | Free-text parsing — rejected outright. |

---

## 20. Requirements Traceability Matrix

The full RTM is maintained as a separate living document: **`docs/requirements-traceability.md`**.
It is updated at the end of every implementation phase and is a Definition-of-Done artefact
(BRD§26).

---

## 21. Phase 0 exit criteria

| Criterion | Status |
|---|---|
| All BRD requirements extracted and identified | ✅ (subject to GAP-001) |
| All 12 scenarios extracted | ✅ |
| All routing rules extracted | ✅ |
| All templates identified | ✅ (bodies absent — GAP-004) |
| Assumptions recorded | ✅ |
| Constraints recorded | ✅ |
| Missing information identified | ✅ 20 gaps, 5 blocking |
| Technical decisions identified | ✅ |
| RTM created | ✅ `docs/requirements-traceability.md` |
| Open questions raised to Business | ✅ `docs/open-questions.md` |

**Phase 0 is complete.** Proceeding to Phase 1 (Solution Architecture) with all gaps carried
forward as configuration rather than assumption.
