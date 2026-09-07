# PEP Passport SPA Box Automation – Agentic (WIT 504)

Agentic AI email triage for the PEP Passport SPA shared mailbox, built on Microsoft Copilot Studio,
Power Automate, Microsoft Graph, Azure OpenAI and Dataverse.

> **This repository also contains an unrelated UiPath sample** (`SauceDemo_*`). Everything below
> concerns the SPA mailbox automation.

---

## The architectural principle

```
AI decides WHAT the email means.
Business rules determine WHAT actions are permitted.
Power Automate / Microsoft services EXECUTE the approved action.
Dataverse / Azure services provide STATE, AUDITABILITY and REPORTING.
```

The separation is structural, not advisory. The AI has no credential, no connector, no mailbox
handle and no address book — it receives sanitised text and returns a JSON document. Which action
runs, which address receives it, which folder it lands in and whether any email is sent at all are
decided by deterministic code reading configuration.

The practical test: **if the model were fully compromised by a prompt-injection attack, what could
it cause?** A wrong scenario label — which either fails deterministic corroboration and goes to a
human, or produces an approved action addressed from configuration. It cannot exfiltrate mail,
cannot delete outside SC-08, and cannot put a single word of its own into a customer-facing email.

---

## Status

| | |
|---|---|
| Tests | **206 passing** (`npm test`) |
| Typecheck | strict, `noUncheckedIndexedAccess` |
| Configuration validation | 0 errors, 43 warnings (every warning is a tracked BRD gap) |
| Live Microsoft integrations | **not executed** — no tenant in this environment (see `docs/known-limitations.md` §1) |
| Blocking business gaps | **5** — see `docs/open-questions.md` §A |

**The system ships with every outbound capability disabled and shadow mode on.** It classifies,
decides, validates and audits, and performs no mailbox action, until each capability is deliberately
enabled against the go-live sequence in `docs/deployment.md` §7.

---

## Documentation

Start with `docs/requirements-analysis.md`, then `docs/architecture.md`.

| Document | Contents |
|---|---|
| [`docs/requirements-analysis.md`](docs/requirements-analysis.md) | Phase 0: requirements, all 12 scenarios, routing/action/AI matrices, **20 gaps**, assumptions, decisions |
| [`docs/open-questions.md`](docs/open-questions.md) | 26 questions for Business and Architecture, prioritised |
| [`docs/architecture.md`](docs/architecture.md) | Context, flow, component, deployment and sequence diagrams; rejected alternatives; risks |
| [`docs/solution-design.md`](docs/solution-design.md) | The five Power Automate flows, the API surface, the feature-flag posture |
| [`docs/component-design.md`](docs/component-design.md) | Module responsibilities, the dependency rule, test seams |
| [`docs/data-model.md`](docs/data-model.md) | 13 Dataverse tables, ER diagram, processing state machine, data protection |
| [`docs/security-design.md`](docs/security-design.md) | Identity, Graph permissions, the **mandatory Application Access Policy**, 16-entry threat model |
| [`docs/integration-design.md`](docs/integration-design.md) | Exact Graph, Azure OpenAI, Dataverse and connector contracts; failure matrix |
| [`docs/ai-agent-design.md`](docs/ai-agent-design.md) | The five prompts, the output contract, injection defence, what the agent may never do |
| [`docs/deployment.md`](docs/deployment.md) | DEV/TEST/PROD deployment and the staged go-live sequence |
| [`docs/cicd-design.md`](docs/cicd-design.md) | CI gates and the deployment pipeline |
| [`docs/operations-guide.md`](docs/operations-guide.md) | Runbooks, alerts, tuning, changing rules without a deployment |
| [`docs/test-matrix.md`](docs/test-matrix.md) | Coverage, and an honest statement of what is **not** covered |
| [`docs/known-limitations.md`](docs/known-limitations.md) | What this does not do, and why |
| [`docs/production-checklist.md`](docs/production-checklist.md) | The pre-production gate |
| [`docs/requirements-traceability.md`](docs/requirements-traceability.md) | Every requirement → component → test → status |

---

## Repository layout

```
config/          Business rules: scenarios, routing, thresholds, templates, region mapping
prompts/         The five versioned AI prompts (semver front-matter)
src/
  common/        Types, Result, errors, redacting logger, hashing, retry
  configuration/ Configuration store and startup validation
  email/         Normalisation, sanitisation, injection detection, idempotency, loop prevention
  attachments/   Metadata extraction and the pluggable handler interface
  classification/Prompt assembly, model client, schema validation, confidence, programme, multi-intent
  routing/       Routing resolution and the decision engine
  templates/     Template selection and safe rendering
  actions/       The nine-action registry, the validator, the executor
  reporting/     Region resolution and the weekly report
  agent/         The orchestrator (composition root)
  api/           HTTP handlers and the Azure Functions binding
tests/           scenario · unit · integration · security
infrastructure/
  bicep/         Azure IaC with per-environment parameters
  power-platform/Connector, flow designs, Dataverse schema, Copilot Studio configuration
```

---

## Getting started

```bash
npm ci
npm run typecheck
npm run validate:config    # business-rule sanity check; fails the build on a bad rule
npm test
```

`validate:config` is the interesting one: it fails when a scenario permits an action outside the
approved set, a routing rule points at a scenario that does not exist, deletion is enabled outside
SC-08, sending is enabled with no active template, or a FIT/FLO scenario is missing its `UNKNOWN`
rule — which would silently disable the BRD's "send to both Josh and Jordan" fallback. A
business-rule mistake fails in CI, not in production.

---

## Changing behaviour without a deployment

| Change | Where |
|---|---|
| Owner email address | Dataverse `spa_routingrule` |
| Destination folder | Dataverse `spa_routingrule` |
| Approved response wording | Dataverse `spa_responsetemplate` (set `isActive`) |
| Confidence thresholds | Dataverse `spa_configuration` |
| Scenario keywords and examples | Dataverse `spa_businessscenario` |
| Enable or disable a capability | Dataverse `spa_configuration` feature flags |

Effective within five minutes. Prompts, the decision engine and the action set are code, and change
under review.

---

## The five blocking gaps

The BRD does not contain the information needed to complete these, so the capability is built and
switched off rather than guessed:

1. **GAP-004** — no approved response wording exists. Every template ships inactive; sending is
   code-blocked.
2. **GAP-003** — the change-request process has no mechanics. Five scenarios route to it; the
   target is disabled with no destination.
3. **GAP-012** — region mapping is "To be Provided by Amy". Everything aggregates to `UNMAPPED`,
   and the Friday report says so every week.
4. **GAP-009** — no approval yet to send email content to Azure OpenAI, and no retention period.
5. **GAP-001** — the BRD file itself was not supplied; this analysis is traced to the project
   brief's restatement and must be re-verified.

Each is a question in `docs/open-questions.md`, and each is reported at startup so it stays visible.
