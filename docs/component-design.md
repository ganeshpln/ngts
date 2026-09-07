# Component Design
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Module-level design for the Decision Service. Clean architecture (Rule 8): the domain core holds
the business rules and depends on nothing; adapters at the edge depend inward.

```
src/
  common/          cross-cutting: types, errors, result, logging, redaction, hashing, retry
  configuration/   configuration loading, validation, caching  (no business logic)
  email/           normalisation, sanitisation, idempotency, loop prevention, suppression
  attachments/     metadata extraction + pluggable content handlers
  classification/  prompt assembly, model client, schema validation, confidence, programme, multi-intent
  routing/         decision engine, routing resolution
  templates/       template selection and rendering
  actions/         action registry, validator, executor, ports
  reporting/       weekly aggregation, region resolution
  agent/           orchestrator (composition root)
  api/             HTTP handlers (Azure Functions adapter)
```

Dependency rule: `agent` → `routing`/`classification`/`actions`/`templates` → `configuration`/`common`.
Nothing in `classification` or `routing` imports an HTTP client or a Graph SDK; side effects reach
them only through injected ports.

---

## 1. `common`

| Module | Responsibility |
|---|---|
| `types.ts` | Domain types: `NormalisedEmail`, `Classification`, `Decision`, `ActionPlanItem`, `ConfidenceBand`, `Program`, `ProcessingOutcome`. Single source of truth for the shapes crossing module boundaries. |
| `result.ts` | `Result<T,E>` — explicit success/failure. The decision path does not use exceptions for control flow, so no failure can be swallowed by an over-broad `catch`. |
| `errors.ts` | `ProcessingError` with `category: Transient \| Permanent \| Guardrail`. Category drives retry (NFR-001). |
| `logger.ts` | Structured logger emitting the NFR-005 field set; **applies redaction itself**, so a call site cannot leak by forgetting. |
| `redact.ts` | Removes/hashes email addresses, GPIDs, learner names and body text from anything bound for telemetry (NFR-007, T-13). |
| `hash.ts` | SHA-256 body hashing for the secondary idempotency key (FR-071). |
| `retry.ts` | Timeout + bounded retry + full-jitter exponential backoff, honouring `Retry-After` (NFR-001). |

## 2. `configuration`

`ConfigurationStore` is an interface with two implementations: `JsonConfigurationStore` (the
`/config` seed — used by tests and offline runs) and `DataverseConfigurationStore` (runtime, cached).
The engine sees only the interface, so tests exercise production code paths with deterministic
configuration.

```ts
interface ConfigurationStore {
  getScenarios(): Promise<ScenarioConfig[]>;
  getScenario(id: string): Promise<ScenarioConfig | undefined>;
  getRoutingRules(): Promise<RoutingRuleConfig[]>;
  getTemplates(): Promise<ResponseTemplateConfig[]>;
  getThresholds(): Promise<ThresholdConfig>;
  getRegionMappings(): Promise<RegionMappingConfig[]>;
  getFeatureFlags(): Promise<FeatureFlags>;
  getSafetyConfig(): Promise<SafetyConfig>;
}
```

`validateConfiguration()` runs at startup and fails closed on: a scenario with an action not in the
approved set, a routing rule pointing at a non-existent scenario, `sendResponseAllowed` with no
active template, `deleteAllowed` outside SC-08, or a threshold outside `[0,1]`. A misconfiguration
that would let the system misbehave stops the service instead.

## 3. `email`

| Module | Responsibility | Requirement |
|---|---|---|
| `normalizer.ts` | HTML→text, remove script/style/comments and hidden content, strip quoted history and signatures, collapse whitespace, cap length. | FR-002, T-02 |
| `sanitizer.ts` | Remove control/bidi/zero-width characters; neutralise delimiter-escape attempts; sanitise filenames. | T-02, T-04 |
| `injectionDetector.ts` | Pattern scan for instruction-override, role-play and tag-injection attempts → `injectionSuspected`. | HIL-09, T-01 |
| `idempotency.ts` | Claim/replay decision against the processing store. | FR-070–072 |
| `loopPrevention.ts` | Bot sender, `X-SPA-Bot-ProcessingId`, auto-submitted headers, conversation outbound cap. | FR-073, FR-074, T-05 |
| `autoReplyDetector.ts` | Header-first, subject-fallback auto-reply detection. | FR-075, SC-08 |
| `ownerResponseDetector.ts` | Owner appears as a sender in the thread ⇒ suppress. | FR-011, GAP-015 |
| `senderClassifier.ts` | Deterministic sender-type signals (domain, directory attributes) feeding GAP-007. | FR-029 |

Quoted-history stripping matters more than it looks: without it, an old troubleshooting reply
quoted at the bottom of a "thanks, all good" message keeps re-triggering SC-01 instead of SC-11.

## 4. `attachments`

```ts
interface AttachmentHandler {
  readonly name: string;
  supports(meta: AttachmentMetadata): boolean;
  process(meta: AttachmentMetadata, content: Buffer): Promise<AttachmentInsight>;
}
```

`AttachmentProcessor` always extracts metadata (FR-080) and marks each attachment supported or not
against the configured allow-list (FR-082). Content handlers are registered but **disabled by
default** (GAP-019); with none enabled, no attachment content is ever downloaded (T-14). The
interface is the extension point required by FR-083.

## 5. `classification`

| Module | Responsibility |
|---|---|
| `promptBuilder.ts` | Load the versioned prompt, inject the scenario catalogue and closed enums, place sanitised content inside delimiters. Never concatenates content into the instruction section (T-01 L1). |
| `modelClient.ts` | Azure OpenAI call with timeout/retry; captures latency and token usage. The only module aware of the model. |
| `schemaValidator.ts` | Validate against the classification JSON schema; repair-once then fail (AD-020). |
| `entityValidator.ts` | Format-validate GPID and email entities; reject implausible values. |
| `programResolver.ts` | Weighted-evidence FIT/FLO/MEC resolution; emits `UNKNOWN` rather than guessing (FR-028); **applies Rule R-1**. |
| `multiIntentResolver.ts` | Precedence and conflict policy; sets `multiIntent`; escalates unresolvable combinations (FR-024, FR-025). |
| `confidence.ts` | Penalties, per-scenario ceilings, banding, destructive-action floor (§9, AD-005, AD-006). |
| `corroborator.ts` | Independent deterministic evidence check for the medium band (AD-006). |

`programResolver` and `multiIntentResolver` are pure functions of (classification, config) — no I/O
— which is why the twelve-scenario matrix can be tested exhaustively.

## 6. `routing`

`RoutingResolver` maps `(scenarioId, program, subIntent)` to a `RoutingRule`, resolving addresses
**only** from configuration (Rule 16). Unresolvable ⇒ HIL-04, never a fallback address.

`DecisionEngine` composes the final `Decision`: outcome, ordered action plan, resolved destinations,
template, folder and human-review reason. It is the single place where a decision is made — there
is no second decision path in the flows, the agent, or the connector.

## 7. `templates`

`TemplateResolver` selects by `(scenarioId, program, senderType)` with documented fallbacks
(`program: ALL`, `senderType: any`), and **rejects inactive templates** — the code-level enforcement
of GAP-004. `TemplateRenderer` substitutes only variables in the template's `allowedVariables` list,
HTML-encodes every value, rejects unknown placeholders, and scans rendered output for URLs not
present in the template source (FR-077: no invented URLs).

## 8. `actions`

```ts
interface MailboxPort {           // implemented by Power Automate/Graph, mocked in tests
  sendReply(...): Promise<ActionResult>;
  forward(...): Promise<ActionResult>;
  move(...): Promise<ActionResult>;
  markAsRead(...): Promise<ActionResult>;
  softDelete(...): Promise<ActionResult>;
  hardDelete(...): Promise<ActionResult>;
}
```

`ActionRegistry` holds the nine approved actions (FR-040–FR-048) — a closed set; an unknown name is
rejected before validation even runs (FR-031).

`ActionValidator` is the final gate. Per action it checks: the action is in the scenario's
`allowedActions`; the scenario permits sending (Rule 14) / deleting (Rule 15); every destination
address appears in the resolved routing configuration (Rule 16); recipient domains are allow-listed
(GAP-017); the folder is in the configured folder map; the template exists, is active and matches;
and the relevant feature flag is on. Any failure ⇒ reject with a reason ⇒ HIL-09.

`ActionExecutor` executes the approved plan in order through `MailboxPort`, honouring shadow mode,
recording an `EmailAction` row per attempt, and halting the sequence on failure without touching
the original message.

## 9. `reporting`

`RegionResolver` maps a message to a region from `RegionMapping`; unmatched ⇒ `UNMAPPED` (FR-097 —
never invented). `WeeklyReportBuilder` produces the seven BRD§19 sections plus the unmapped count,
as a pure function of the processing rows, so the report is unit-testable without a database.

## 10. `agent`

`Orchestrator` is the composition root and the pipeline:

```
claim → guard (loop / owner / auto-reply) → normalise → attachments
      → classify → validate schema → resolve entities/programme/multi-intent
      → band confidence → corroborate (medium) → decide → validate actions
      → execute (or shadow) → audit
```

Each stage returns `Result`; the first failure short-circuits to the appropriate outcome. Every
stage is individually unit-tested and the whole pipeline is integration-tested with in-memory
adapters.

---

## 11. Testability

| Seam | Substituted in tests |
|---|---|
| `ConfigurationStore` | JSON seed |
| `ModelClient` | Scripted classifications — deterministic scenario tests without a model call |
| `MailboxPort` | Recording fake — asserts exactly which calls would have been made |
| `ProcessingStore` | In-memory store with the same uniqueness semantics |
| `Clock` | Fixed time for report windows and backoff |
| `Logger` | Capturing logger — lets the redaction tests assert on real output |

Every one of these is an interface in the domain and an adapter at the edge, which is what makes
Rule 10 ("every scenario must have automated tests") achievable rather than aspirational.
