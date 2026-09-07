# Requirements Traceability Matrix
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Every requirement maps to an implementation and to test coverage, or is explicitly marked as
blocked on a business answer. Requirement IDs are defined in `docs/requirements-analysis.md`.

**Status key:** ✅ implemented and tested · 🟡 implemented but blocked on a business answer ·
🔵 designed, not executable in this repository (see `docs/known-limitations.md` §1) · ⛔ not started.

---

## 1. Core processing (BRD §1)

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| FR-001 | Monitor the SPA mailbox | Flow 1 trigger — `infrastructure/power-platform/flows/README.md` | DEV smoke test | 🔵 |
| FR-002 | Read subject, body, sender, attachments | `src/email/normalizer.ts`, `src/attachments/attachmentProcessor.ts` | `emailProcessing.test.ts` — normaliser, attachments | ✅ |
| FR-003 | Understand intent semantically | `prompts/email-classifier.md`, `src/classification/` | `scenarios.test.ts` (all) | ✅ |
| FR-004 | Identify the applicable scenario | `config/scenarios.json`, `src/classification/schemaValidator.ts` | `scenarios.test.ts` — 12 scenarios | ✅ |
| FR-005 | Identify FIT / FLO / MEC-CGR / All | `src/classification/programResolver.ts` | `decisionLogic.test.ts` — programme resolution | ✅ |
| FR-006 | Determine routing and action | `src/routing/decisionEngine.ts` | `scenarios.test.ts` (all) | ✅ |
| FR-007 | Send an automated response | `src/templates/templateResolver.ts`, `src/actions/actionExecutor.ts` | SC-01 with an activated template | 🟡 GAP-004 |
| FR-008 | Forward or route to the owner | `src/routing/routingResolver.ts` | SC-01/02/03/05/07/09/10 | ✅ |
| FR-009 | Move to the appropriate folder | `decisionEngine.ts`, `actionExecutor.ts` | SC-04, SC-07, SC-11 | 🟡 GAP-005 (3 of 12 folders known) |
| FR-010 | Mark as read | `actionExecutor.ts` | SC-04, SC-08, SC-11 | ✅ |
| FR-011 | Stop after the owner responds | `src/email/ownerResponseDetector.ts` | `emailProcessing.test.ts` — 5 tests | 🟡 GAP-015 (scope undefined) |
| FR-012 | Human intervention for low confidence | `decisionEngine.ts` preflight | SC-99; `decisionLogic.test.ts` | ✅ |
| FR-013 | Auditable record of every email and action | `spa_emailprocessing`, `spa_emailaction`; `AuditPort` | `pipeline.test.ts` — audit records | 🔵 Dataverse not executed |
| FR-014 | Weekly Friday report | `src/reporting/weeklyReport.ts`, Flow 4 | `decisionLogic.test.ts` — weekly report | 🟡 GAP-012, GAP-014 |

## 2. Classification and decisioning (BRD §5, §7, §8, §9, §11)

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| FR-020 | Structured JSON output | `config/schemas/classification.schema.json` | `decisionLogic.test.ts` — schema | ✅ |
| FR-021 | Validate before acting; invalid ⇒ review | `src/classification/schemaValidator.ts` | schema tests; `pipeline.test.ts` — invalid output | ✅ |
| FR-022 | Numeric confidence | `src/classification/confidence.ts` | confidence tests | ✅ |
| FR-023 | Business-readable summary, no chain-of-thought | `schemaValidator.ts` length cap | `security.test.ts` — Rule 11 (3 tests) | ✅ |
| FR-024 | Multi-intent with a flag | `src/classification/multiIntentResolver.ts` | multi-intent tests; SC-07 + SC-02 | ✅ |
| FR-025 | Escalate contradictory intents | `multiIntentResolver.ts` | MI-CR-VS-TECH, MI-RESOLVED-PLUS | ✅ |
| FR-025a | Second-opinion validation (prompt 5) wired into the pipeline | `src/classification/routingValidator.ts`, orchestrator | `routingValidator.test.ts` (16), `routingValidatorWiring.test.ts` (15) | ✅ |
| FR-026 | FIT/FLO from six evidence sources | `programResolver.ts` | programme resolution tests | ✅ |
| FR-027 | **Fallback: route to BOTH owners** | `programResolver.ts` + `routing-rules.json` UNKNOWN rules | SC-01, SC-02 fallback; routing tests | ✅ |
| FR-028 | No high confidence on weak evidence | `programResolver.ts` generic-keyword ceiling | "refuses to assign on generic keywords alone" | ✅ |
| FR-029 | Extract the seven entities | `prompts/entity-extractor.md`, `entityValidator.ts` | entity validation tests | ✅ |
| FR-030 | Thresholds centrally configurable | `config/thresholds.json`; no literal elsewhere | configuration validation tests | ✅ |
| FR-031 | Closed action set | `src/actions/actionRegistry.ts` | registry tests; `security.test.ts` T-15 | ✅ |
| FR-032 | Return UNKNOWN when unsure | `prompts/*`, SC-99 | SC-99 test | ✅ |

## 3. Actions (BRD Phase 4)

| Req | Action | Component | Test | Status |
|---|---|---|---|---|
| FR-040 | SendResponse | `actionExecutor.ts`, `templateResolver.ts` | SC-01 activated template | 🟡 GAP-004 |
| FR-041 | ForwardEmail | `actionExecutor.ts` | SC-07 | ✅ |
| FR-042 | MoveEmail | `actionExecutor.ts` | SC-04, SC-07, SC-11 | ✅ |
| FR-043 | MarkAsRead | `actionExecutor.ts` | SC-04, SC-08, SC-11 | ✅ |
| FR-044 | DeleteEmail | `actionExecutor.ts` | SC-08 (soft delete) | 🟡 GAP-006 |
| FR-045 | RouteToChangeRequest | `decisionEngine.ts` | SC-03/05/06/09/12 | 🟡 GAP-003 |
| FR-046 | RouteToProgramOwner | `routingResolver.ts` | SC-01/02/03/05/07/09/10 | ✅ |
| FR-047 | EscalateToHumanReview | `decisionEngine.ts` | SC-99 and every escalation test | ✅ |
| FR-048 | GenerateReport | `weeklyReport.ts` | weekly report tests | 🟡 GAP-012 |
| FR-049 | Validate every action input | `src/actions/actionValidator.ts` | `security.test.ts` — 11 gate tests | ✅ |
| FR-050 | No send without explicit permission | `actionValidator.ts` AV-002 | "rejects a send when the scenario forbids one" | ✅ |
| FR-051 | No delete without explicit permission | `actionValidator.ts` AV-003 | "rejects deletion for any scenario but SC-08" | ✅ |

## 4. Human-in-the-loop (BRD §10)

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| FR-060 | Nine escalation triggers | `decisionEngine.ts` `preflightHumanReview` | HIL-01/02/04/06/07/09 covered | ✅ |
| FR-061 | Reviewer sees email, classification, entities | Flow 3 card; `spa_humanreviewqueue` | DEV manual test | 🔵 |
| FR-062 | Reviewer can change scenario, programme, routing | Review decision endpoint | DEV manual test | 🔵 |
| FR-063 | Reviewer can approve, reject, correct | Flow 3 | DEV manual test | 🔵 |
| FR-064 | Corrections recorded for improvement | `spa_humanreviewcorrection` | DEV manual test | 🔵 |

## 5. Integrity and safety (BRD §15, §16, §17, §18)

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| FR-070 | Never process twice | `src/email/idempotency.ts` | `pipeline.test.ts` — replay, concurrency | ✅ |
| FR-071 | Two-key idempotency | `idempotency.ts` | "secondary key" test | ✅ |
| FR-072 | Absorb retries and transient failures | claim lease; `Result` handling | lease tests; retry tests | ✅ |
| FR-073 | Do not process our own mail | `src/email/loopPrevention.ts` | `security.test.ts` T-05 | ✅ |
| FR-074 | No infinite loops | conversation cap | "conversation outbound cap" | ✅ |
| FR-075 | Identify automated messages | `src/email/autoReplyDetector.ts` | auto-reply tests; SC-08 | ✅ |
| FR-076 | Approved templates only | `templateResolver.ts`, `actionValidator.ts` AV-009 | "rejects a send with no template" | ✅ |
| FR-077 | Constrained generation, no invented URLs | `renderTemplate` URL check | "rejects a URL not in the template source" | ✅ |
| FR-078 | Email content is untrusted | `sanitizer.ts`, `injectionDetector.ts`, `normalizer.ts` | `security.test.ts` T-01, T-02 | ✅ |
| FR-080 | Capture attachment metadata | `attachmentProcessor.ts` | attachment tests | ✅ |
| FR-081 | Attachment presence as a signal | `promptBuilder.ts` | `pipeline.test.ts` — attachment signal | ✅ |
| FR-082 | Do not process arbitrary file types | extension + MIME allow-list | "requires BOTH the extension and the MIME type" | ✅ |
| FR-083 | Extensible handler interface | `AttachmentHandler` | feature-flag test | ✅ |

## 6. Reporting (BRD §19)

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| FR-090 | Emails per region | `weeklyReport.ts` | "produces every BRD section 19 figure" | 🟡 GAP-012 |
| FR-091 | Scenario per region | `weeklyReport.ts` | same | 🟡 GAP-012 |
| FR-092 | Count to Josh / Jordan | `weeklyReport.ts` | same | ✅ |
| FR-093 | Count to Amy / Schoox | `weeklyReport.ts` | same | ✅ |
| FR-094 | Count to change request | `weeklyReport.ts` | same | ✅ |
| FR-095 | Count resolved | `weeklyReport.ts` | same | ✅ |
| FR-096 | All 12 scenarios across all regions | `weeklyReport.ts` | "emits all twelve scenarios, including zero counts" | ✅ |
| FR-097 | Region mapping configurable, never invented | `src/reporting/regionResolver.ts` | "returns UNMAPPED rather than inventing a region" | ✅ |
| FR-098 | Generated automatically | Flow 4 | DEV manual test | 🟡 GAP-014 |

## 7. Non-functional

| Req | Requirement | Component | Test | Status |
|---|---|---|---|---|
| NFR-001 | Timeout, retry, backoff, max attempts | `src/common/retry.ts`, `config/application.json` | `pipeline.test.ts` — 6 retry tests | ✅ |
| NFR-002 | No silent email loss | `decisionEngine.ts` escalation paths; executor halt | "halts the plan and never moves or deletes" | ✅ |
| NFR-003 | Record, preserve, prevent duplicates, escalate, alert | `ProcessingError`, Flow 5, Bicep alert | audit tests | 🔵 alerting not executed |
| NFR-004 | Dead-letter handling | Flow 5, `spa_processingerror` | DEV manual test | 🔵 |
| NFR-005 | Full telemetry field set | `src/common/logger.ts` | `pipeline.test.ts` — latency, prompt version | ✅ |
| NFR-006 | App Insights / Azure Monitor | Bicep | DEV smoke test | 🔵 |
| NFR-007 | Never log sensitive content | `src/common/redact.ts` | `security.test.ts` T-13 (4 tests) | ✅ |
| NFR-008 | Entra ID authentication | Bicep `authsettingsV2`; connector OAuth2 | DEV smoke test | 🔵 |
| NFR-009 | No credentials in source | managed identity; `.gitignore`; CI secret scan | "ships no secret in configuration" | ✅ |
| NFR-010 | Managed identity, Key Vault | `src/api/functions.ts`, Bicep | DEV smoke test | 🔵 |
| NFR-011 | Least privilege, RBAC | Bicep roles; Dataverse roles | reviewed in `tables.json` | 🔵 |
| NFR-012 | Permissions documented | `docs/security-design.md` §2 | n/a | ✅ |
| NFR-013 | Resist injection | four-layer defence | `security.test.ts` T-01, T-02, T-04 | ✅ |
| NFR-014 | No data leakage | template-only output; redaction | T-03, T-13 | ✅ |
| NFR-015 | Configurable without code change | `ConfigurationStore` | configuration tests | ✅ |
| NFR-016 | Clean architecture | module structure; dependency rule | typecheck | ✅ |
| NFR-017 | Prompts versioned and external | `/prompts` with semver front-matter | "reads the semver from front-matter" | ✅ |
| NFR-018 | Every scenario tested | `tests/scenario` | 29 tests | ✅ |
| NFR-019 | Rules traceable to the BRD | `brdReference` on every scenario and rule | this document | ✅ |
| NFR-020 | DEV/TEST/PROD, IaC | Bicep + parameter files; CD workflow | CI Bicep build | 🔵 not deployed |
| NFR-021 | No environment values in source | parameter files; app settings | reviewed | ✅ |
| NFR-022 | LLM cannot operate the mailbox | no connector; `ActionValidator` | `security.test.ts` T-01, T-15 | ✅ |

## 8. The twelve scenarios (BRD §6)

| Scenario | Config | Routing rules | Tests | Status |
|---|---|---|---|---|
| SC-01 | `scenarios.json` | 3 (FIT/FLO/UNKNOWN) | 5 | 🟡 GAP-004, GAP-005, GAP-010 |
| SC-02 | ✅ | 3 | 2 | 🟡 GAP-004, GAP-005 |
| SC-03 | ✅ | 4 (2 branches) | 4 | 🟡 GAP-003 |
| SC-04 | ✅ | 1 | 1 | ✅ |
| SC-05 | ✅ | 4 (2 branches) | 2 | 🟡 GAP-003 |
| SC-06 | ✅ | 1 | 2 | 🟡 GAP-003 |
| SC-07 | ✅ | 1 | 3 | ✅ |
| SC-08 | ✅ | 1 | 2 | 🟡 GAP-006 |
| SC-09 | ✅ | 4 (2 branches) | 2 | 🟡 GAP-003, GAP-011 |
| SC-10 | ✅ | 3 | 1 | 🟡 GAP-005 |
| SC-11 | ✅ | 1 | 2 | ✅ |
| SC-12 | ✅ | 1 | 2 | 🟡 GAP-003, GAP-007 |
| SC-99 | ✅ | 1 | 1 | ✅ |

## 9. Claude Code operating rules (BRD §24)

| Rule | How it is met | Evidence |
|---|---|---|
| 1 — No invented requirements | Every rule carries a `brdReference`; anything absent is a gap, not an assumption | `config/*.json`, §15 of the analysis |
| 2 — Flag gaps | 20 gaps recorded, 5 blocking; surfaced at startup and in the weekly report | `requirements-analysis.md` §15 |
| 3 — No hard-coded business rules | All rules in `/config` and Dataverse; no threshold literal in code | configuration validation tests |
| 4 — No hard-coded credentials | Managed identity; CI secret scan | `security.test.ts`; CI |
| 5 — No fake Microsoft APIs | Every endpoint documented in `integration-design.md` against Graph v1.0 | `docs/integration-design.md` |
| 6 — No unverified claims | Unexecuted integrations listed explicitly | `known-limitations.md` §1, `test-matrix.md` §3 |
| 7 — Production code | Compiles under strict TypeScript; 206 tests | `npm run typecheck`, `npm test` |
| 8 — Clean architecture | Domain depends on ports, not adapters | `component-design.md` |
| 9 — Traceability | This document | — |
| 10 — Every scenario tested | 29 scenario tests | `tests/scenario` |
| 11 — No chain-of-thought | Length-capped summary; extra fields dropped | 3 security tests |
| 12 — No unrestricted mailbox access | Agent has one connector; validator gates every action | T-01, T-15 |
| 13 — Untrusted email content | Four-layer defence | T-01, T-02, T-04 |
| 14 — No unauthorised sending | `sendResponseAllowed` gate | AV-002 test |
| 15 — No unauthorised deletion | `deleteAllowed` gate | AV-003 test |
| 16 — Destinations from configuration only | `RoutingResolver`; validator AV-007 | "rejects a recipient not in the routing configuration" |

## 10. Definition of Done (BRD §26)

| Criterion | Status |
|---|---|
| All 12 scenarios implemented | ✅ |
| Routing rules configurable | ✅ |
| Response templates configurable | ✅ (bodies awaiting GAP-004) |
| AI classification structured | ✅ |
| Confidence scoring exists | ✅ |
| Human escalation exists | ✅ |
| Duplicate protection exists | ✅ |
| Audit logging exists | ✅ code · 🔵 Dataverse unverified |
| Error handling exists | ✅ |
| Security controls exist | ✅ |
| Automated tests exist | ✅ 206 |
| Deployment documentation exists | ✅ |
| Reporting exists | ✅ (region mapping awaiting GAP-012) |
| Friday report automated | ✅ designed · 🟡 recipients awaiting GAP-014 |
| Requirements traceability complete | ✅ this document |
| **No critical unresolved gaps** | ⛔ **Five blocking gaps remain: GAP-003, GAP-004, GAP-009, GAP-012, and GAP-001.** They are business inputs, not engineering work. |

**The solution is not "done" by the BRD's own definition, and the reason is the five blocking gaps
in the last row.** Every one is a question for the business, each is tracked in
`docs/open-questions.md`, and each has its capability built and switched off pending the answer.
