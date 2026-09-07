# Solution Architecture
## PEP Passport SPA Box Automation – Agentic (WIT 504)

| Field | Value |
|---|---|
| Document | Architecture (Phase 1 deliverable) |
| Version | 1.0 |
| Depends on | `docs/requirements-analysis.md` |

---

## 1. Architectural principle (mandatory, BRD§28)

```
AI decides WHAT the email means.
Business rules determine WHAT actions are permitted.
Power Automate / Microsoft services EXECUTE the approved action.
Dataverse / Azure services provide STATE, AUDITABILITY and REPORTING.
```

This separation is structural, not advisory. The AI has no credential, no connector, no mailbox
handle and no address book. It receives sanitised text and returns a JSON document. Every
consequential decision — which action, which address, which folder, which template, whether to
send at all — is taken by deterministic code reading configuration.

The practical test: **if the model were fully compromised by a prompt-injection attack, what could
it cause?** Answer: a wrong scenario label, which either fails deterministic corroboration and goes
to human review, or produces an action drawn from the approved set for that scenario, addressed to
an address that came from configuration. It cannot cause mail to be sent to an attacker-chosen
address, cannot cause deletion outside SC-08, and cannot cause arbitrary text to be sent.

---

## 2. Context diagram

```mermaid
graph TB
    subgraph External
        SENDER["Learners / Managers / Peer Trainers<br/>(untrusted senders)"]
    end

    subgraph M365["Microsoft 365"]
        SPA["SPA Shared Mailbox<br/>(Exchange Online)"]
        OWNERS["Programme Owners<br/>Jordan · Josh · Amy"]
        TEAMS["Microsoft Teams<br/>(review notifications)"]
    end

    subgraph PP["Power Platform"]
        PA["Power Automate<br/>Flows 1–4"]
        CS["Copilot Studio Agent<br/>SPA Triage Agent"]
        DV[("Dataverse<br/>config · audit · review")]
        APP["Model-driven App<br/>Human Review Queue"]
        PBI["Power BI<br/>Friday Report"]
    end

    subgraph AZ["Azure"]
        DS["Decision Service<br/>Azure Functions"]
        AOAI["Azure OpenAI<br/>(Azure AI Foundry)"]
        KV["Key Vault"]
        AI["Application Insights"]
    end

    SENDER -->|email| SPA
    SPA -->|new message trigger| PA
    PA -->|Graph: read message| SPA
    PA -->|classify + decide| DS
    CS -->|tool calls| DS
    DS -->|prompted inference| AOAI
    DS -->|config read / audit write| DV
    DS -->|telemetry| AI
    DS -.->|secrets when unavoidable| KV
    PA -->|execute approved action| SPA
    SPA -->|reply / forward| SENDER
    SPA -->|forward| OWNERS
    PA -->|review card| TEAMS
    DV --> APP
    DV --> PBI
    PA -->|weekly report email| OWNERS
```

---

## 3. Logical flow

```mermaid
flowchart TD
    A["New mail in SPA mailbox"] --> B["Flow 1: Intake trigger"]
    B --> C["Graph: fetch full message<br/>headers · body · attachments"]
    C --> D["Normalise<br/>strip HTML · strip quoted history · sanitise"]
    D --> E{"Idempotency check<br/>InternetMessageId"}
    E -->|already claimed| Z1["Stop – duplicate"]
    E -->|claimed now| F{"Loop / self-sent?<br/>X-SPA-Bot-ProcessingId · sender = bot"}
    F -->|yes| Z2["Stop – own message"]
    F -->|no| G{"Owner already replied<br/>on this conversation?"}
    G -->|yes| Z3["Suppress – mark read only (FR-011)"]
    G -->|no| H["Attachment metadata extraction"]
    H --> I["Agentic AI classification<br/>Copilot Studio / Azure OpenAI"]
    I --> J{"Schema valid?"}
    J -->|no – repair once| I
    J -->|still invalid| HR["Human review (HIL-05)"]
    J -->|yes| K["Deterministic post-processing<br/>entity validation · programme resolution · multi-intent"]
    K --> L{"Confidence band"}
    L -->|"< 0.75 low"| HR
    L -->|"0.75–0.89 medium"| M{"Deterministic corroboration"}
    M -->|disagrees| HR
    M -->|agrees| N
    L -->|">= 0.90 high"| N["Decision Engine:<br/>resolve scenario policy"]
    N --> O["Routing resolution<br/>from RoutingRule config"]
    O --> P{"Programme known?"}
    P -->|no| P1["Rule R-1: route to BOTH<br/>Jordan + Josh (FR-027)"]
    P -->|yes| P2["Route to programme owner"]
    P1 --> Q
    P2 --> Q["Build ordered action plan"]
    Q --> R["ActionValidator<br/>allow-list · destination · permissions"]
    R -->|rejected| HR
    R -->|approved| S["Execute actions in order<br/>via Power Automate / Graph"]
    S -->|failure| T["Retry with backoff"]
    T -->|exhausted| HR
    S --> U["Audit: EmailProcessing · EmailAction"]
    HR --> U
    Z1 --> U
    Z2 --> U
    Z3 --> U
    U --> V["Reporting layer / Friday report"]
```

---

## 4. Component architecture

```mermaid
graph LR
    subgraph ORCH["Orchestration (Power Automate)"]
        F1["Flow 1<br/>Email Intake"]
        F2["Flow 2<br/>Action Execution"]
        F3["Flow 3<br/>Human Review"]
        F4["Flow 4<br/>Weekly Friday Report"]
    end

    subgraph DSVC["Decision Service (Azure Functions, TypeScript)"]
        ORCHESTRATOR["Orchestrator"]
        subgraph DET["Deterministic core"]
            NORM["Email Normaliser"]
            IDEM["Idempotency Guard"]
            LOOP["Loop Prevention"]
            ATT["Attachment Processor"]
            PROG["Programme Resolver"]
            MI["Multi-Intent Resolver"]
            CONF["Confidence Bander"]
            DEC["Decision Engine"]
            ROUTE["Routing Resolver"]
            TPL["Template Resolver + Renderer"]
            VAL["Action Validator"]
        end
        subgraph AICORE["AI boundary"]
            PROMPT["Prompt Builder<br/>(versioned)"]
            CLIENT["Model Client"]
            SCHEMA["Output Schema Validator"]
        end
    end

    subgraph DATA["Dataverse"]
        CFG[("Configuration<br/>Scenario · Routing · Template · Region")]
        AUD[("Audit<br/>EmailProcessing · EmailAction · ClassificationResult")]
        HRQ[("HumanReviewQueue")]
    end

    F1 --> ORCHESTRATOR
    ORCHESTRATOR --> NORM --> IDEM --> LOOP --> ATT --> PROMPT --> CLIENT --> SCHEMA
    SCHEMA --> PROG --> MI --> CONF --> DEC --> ROUTE --> TPL --> VAL
    VAL --> F2
    VAL --> HRQ
    F3 --> HRQ
    DEC --> CFG
    ROUTE --> CFG
    TPL --> CFG
    ORCHESTRATOR --> AUD
    AUD --> F4
```

### Component responsibilities

| Component | Responsibility | Trust |
|---|---|---|
| Email Normaliser | HTML→text, strip quoted history and signatures, normalise whitespace, cap length. | Deterministic |
| Idempotency Guard | Claim `InternetMessageId` before side effects; detect replays. | Deterministic |
| Loop Prevention | Detect own outbound (`X-SPA-Bot-ProcessingId`, bot sender), auto-submitted headers, reply depth. | Deterministic |
| Attachment Processor | Metadata extraction, extension/MIME allow-list, pluggable content handlers. | Deterministic |
| Prompt Builder | Assemble versioned prompt with delimited, sanitised email content and closed enums. | Deterministic assembly of an AI input |
| Model Client | Azure OpenAI call with timeout, retry, backoff, latency capture. | AI boundary |
| Output Schema Validator | Reject anything not conforming to the classification JSON schema. | Deterministic |
| Programme Resolver | Weighted-evidence FIT/FLO/MEC resolution; applies fallback Rule R-1. | Deterministic |
| Multi-Intent Resolver | Precedence and conflict policy; sets `multiIntent`. | Deterministic |
| Confidence Bander | Band into high/medium/low; per-scenario overrides; destructive-action floor. | Deterministic |
| Decision Engine | Map (scenario, programme, band, entities) → ordered action plan. | Deterministic |
| Routing Resolver | Resolve destination addresses from `RoutingRule` only. | Deterministic |
| Template Resolver | Select template by scenario/programme/sender type; reject inactive; render with allow-listed variables. | Deterministic |
| Action Validator | Final gate: action in scenario's allow-list, destination configured, send/delete permitted. | Deterministic |
| Power Automate Flows | Execute mailbox operations via Graph/Outlook connector. | Deterministic |

---

## 5. Deployment view

```mermaid
graph TB
    subgraph SUB["Azure Subscription (per environment)"]
        subgraph RG["Resource Group rg-spa-mailbox-{env}"]
            FUNC["Function App<br/>func-spa-decision-{env}<br/>System-assigned Managed Identity"]
            PLAN["App Service Plan / Flex Consumption"]
            AOAI["Azure OpenAI<br/>oai-spa-{env}"]
            KV["Key Vault<br/>kv-spa-{env}"]
            AI["Application Insights<br/>appi-spa-{env}"]
            LAW["Log Analytics Workspace"]
            ST["Storage Account<br/>(Functions runtime)"]
        end
    end
    subgraph PPENV["Power Platform Environment {env}"]
        SOL["Managed Solution<br/>SPAMailboxAutomation"]
        DV[("Dataverse")]
        FLOWS["Cloud Flows 1–4"]
        AGENT["Copilot Studio Agent"]
        MDA["Model-driven App"]
        CONN["Custom Connector<br/>SPA Decision Service"]
    end

    FUNC --> AOAI
    FUNC --> AI --> LAW
    FUNC --> KV
    FUNC --> PLAN
    FUNC --> ST
    FUNC --> DV
    CONN --> FUNC
    FLOWS --> CONN
    AGENT --> CONN
    SOL -.contains.- FLOWS
    SOL -.contains.- AGENT
    SOL -.contains.- MDA
    SOL -.contains.- CONN
```

Environments: **DEV**, **TEST**, **PROD** — identical topology, different configuration.
No environment-specific value is compiled into any artefact (NFR-021); all are supplied by
Bicep parameter files and Power Platform environment variables.

---

## 6. Sequence — happy path (SC-07, Schoox)

```mermaid
sequenceDiagram
    participant S as Sender
    participant MBX as SPA Mailbox
    participant F1 as Flow 1 (Intake)
    participant G as Microsoft Graph
    participant DS as Decision Service
    participant AI as Azure OpenAI
    participant DV as Dataverse

    S->>MBX: Email "MEC capstone deck question"
    MBX-->>F1: New message trigger
    F1->>G: GET /messages/{id} (headers, body, attachments)
    G-->>F1: message
    F1->>DS: POST /api/process (normalised message)
    DS->>DV: claim InternetMessageId (idempotency)
    DV-->>DS: claimed
    DS->>DV: load scenarios, routing, templates, thresholds
    DS->>AI: email_intent_classifier (v1.0.0)
    AI-->>DS: {scenarioId: SC-07, confidence: 0.94, ...}
    DS->>DS: schema validate → programme resolve → band = HIGH
    DS->>DS: decision engine → plan [ForwardEmail, MoveEmail, MarkAsRead]
    DS->>DS: ActionValidator → destination amy.fischer@pepsico.com (from config)
    DS->>DV: write ClassificationResult + plan
    DS-->>F1: approved action plan
    F1->>G: POST /messages/{id}/forward → amy.fischer@pepsico.com
    F1->>G: POST /messages/{id}/move → "Schoox"
    F1->>G: PATCH /messages/{id} isRead = true
    F1->>DS: POST /api/actions/result
    DS->>DV: EmailAction rows + EmailProcessing = Completed
```

## 7. Sequence — low confidence → human review

```mermaid
sequenceDiagram
    participant F1 as Flow 1
    participant DS as Decision Service
    participant AI as Azure OpenAI
    participant DV as Dataverse
    participant F3 as Flow 3 (Review)
    participant T as Teams
    participant R as Reviewer

    F1->>DS: POST /api/process
    DS->>AI: classify
    AI-->>DS: {scenarioId: SC-09, confidence: 0.61}
    DS->>DS: band = LOW → HIL-01
    DS->>DV: HumanReviewQueue row (status=Pending)
    DS-->>F1: plan = [EscalateToHumanReview] (no mailbox side effects)
    DV-->>F3: new review item
    F3->>T: adaptive card (subject, classification, entities)
    R->>F3: corrected scenario = SC-03, programme = FLO, approve
    F3->>DS: POST /api/review/{id}/decision
    DS->>DV: HumanReviewCorrection (original vs corrected)
    DS->>DS: re-run Decision Engine with corrected inputs
    DS-->>F3: approved action plan
    F3->>F1: execute actions
```

---

## 8. Cross-cutting design

### 8.1 Idempotency (FR-070 – FR-072)
Two-key model. `InternetMessageId` is the primary key (globally unique per RFC 5322, survives
folder moves — unlike the Graph `id`, which changes on move). `BodyHash + SenderEmail + Subject`
is the secondary key catching resends that carry a new message id.

The claim is a **conditional insert** on a Dataverse alternate key, executed *before* any side
effect. Concurrency and Power Automate's at-least-once retry are handled by the uniqueness
violation, not by a read-then-write check (which would race).

State machine: `Claimed → Classifying → Decided → Executing → Completed`, with terminal
`Failed`, `HumanReview`, `Suppressed`, `Duplicate`. Only `Claimed` and `Failed` (below max
retries) are resumable; anything else short-circuits a replay.

### 8.2 Loop prevention (FR-073, FR-074)
Four independent checks, any of which halts processing:
1. Sender is the SPA mailbox itself or any configured bot identity.
2. Message carries the `X-SPA-Bot-ProcessingId` internet header stamped on all outbound mail.
3. `Auto-Submitted: auto-*` or `X-Auto-Response-Suppress` header present (also feeds SC-08).
4. Per-conversation outbound counter exceeds `loopPrevention.maxOutboundPerConversation`.

### 8.3 Owner-response suppression (FR-011, GAP-015)
When any configured owner address appears as a **sender** on the conversation, the conversation is
marked suppressed. Subsequent inbound mail on that `conversationId` is marked read and audited but
receives no automated response, forward or move. Scope and expiry are configuration.

### 8.4 Error handling (NFR-001 – NFR-004)
Every outbound dependency call is wrapped with timeout, bounded retries and full-jitter exponential
backoff. Errors are classified `Transient | Permanent | Guardrail`. Transient errors retry;
permanent and guardrail errors go straight to the failure path. Retries exhausted ⇒
`ProcessingError` row + `EscalateToHumanReview` (HIL-08) + alert. **The original email is never
deleted or moved on a failure path**, so nothing is lost (NFR-002).

### 8.5 Observability (NFR-005 – NFR-007)
One `correlationId` spans Flow → Decision Service → model call → action execution. Structured logs
carry the full NFR-005 field list. A redaction layer strips body text, GPID, learner names and
email addresses from telemetry by default; only hashes and lengths are emitted.

### 8.6 Configuration (NFR-015)
Dataverse is the runtime source of configuration; the JSON files in `/config` are the versioned
seed and the offline/test source. A single `ConfigurationStore` interface serves both, so the
engine is identical in test and production. Every threshold, address, folder name, template and
keyword resolves through it — there are no literals in the decision path.

---

## 9. Why not the obvious simpler design

| Simpler option | Why rejected |
|---|---|
| Put all rules in Power Automate conditions | Untestable (violates Rule 10/NFR-018), rules duplicated across flows (violates Rule 3), and business rules become invisible to code review. |
| Let the Copilot Studio agent call Graph directly | Violates Rule 12 and Rule 16 — an injected instruction would reach the mailbox. |
| Let the model write the reply text | Violates BRD§16 and Rule 14. |
| Use the Outlook connector only, no Graph | Cannot reliably read `internetMessageId` or auto-submitted headers, breaking FR-071 and FR-075. |
| Keyword rules engine, no AI | Violates BRD§28 explicitly; cannot handle multi-intent (BRD§7) or non-standard wording. |
| Trust the model's self-reported confidence | Self-reported confidence is not calibrated; the medium band therefore requires deterministic corroboration (AD-006). |

---

## 10. Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| RSK-01 | Model mis-classifies and mail is auto-sent to the wrong owner. | Medium | Confidence banding, corroboration, shadow-mode pilot, per-scenario send permission. |
| RSK-02 | Prompt injection attempts to redirect routing. | High if unmitigated | Destinations never come from model output (Rule 16); injection detection raises HIL-09. |
| RSK-03 | Duplicate sends from Power Automate retry. | High | Pre-side-effect reservation claim on a unique key. |
| RSK-04 | Blocking gaps (templates, change-request process, region map) never close. | High | Capability ships disabled; the gap is visible in configuration and in the Friday report's `UNMAPPED` bucket. |
| RSK-05 | Azure OpenAI throttling at peak. | Medium | Bounded retry with backoff; on exhaustion the item goes to human review, never silently dropped. |
| RSK-06 | Owner addresses change (staff move). | Medium | Addresses are configuration, changeable without deployment. |
| RSK-07 | Auto-response sent to an external sender inappropriately. | Medium | Outbound domain allow-list; external ⇒ human review by default (GAP-017). |
| RSK-08 | Deleting an OOO message that compliance required retaining. | Medium | Soft delete by default; hard delete requires explicit configuration (GAP-006). |
