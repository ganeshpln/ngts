# Test Matrix
## PEP Passport SPA Box Automation – Agentic (WIT 504)

**206 automated tests, all passing.** Run with `npm test`.

| Suite | File | Tests | Purpose |
|---|---|---|---|
| Scenario | `tests/scenario/scenarios.test.ts` | 29 | All 12 BRD scenarios end to end through the real pipeline |
| Unit — decision logic | `tests/unit/decisionLogic.test.ts` | 63 | Configuration validation, schema, programme, multi-intent, confidence, routing, templates, registry, region, report |
| Unit — email processing | `tests/unit/emailProcessing.test.ts` | 42 | Sanitisation, normalisation, auto-reply, loops, owner suppression, idempotency, attachments |
| Security | `tests/security/security.test.ts` | 39 | The threat model in `docs/security-design.md` §3 |
| Integration — pipeline | `tests/integration/pipeline.test.ts` | 22 | Duplicates, concurrency, AI failure, execution failure, retry, prompt assembly |
| Integration — API | `tests/integration/api.test.ts` | 11 | HTTP contracts and fail-closed health |

The model is scripted in every suite, so the tests assert on the **deterministic** behaviour — which
is what the controls actually depend on — and CI is offline, free and reproducible.

---

## 1. BRD Phase 6 required coverage

| BRD Phase 6 requirement | Covered by | Expected result |
|---|---|---|
| Positive classification | SC-01…SC-12 happy paths | Correct scenario, owner, folder |
| Negative classification | Negative examples in `config/scenarios.json`; competing-signal corroboration test | Not corroborated ⇒ demoted |
| Ambiguous classification | SC-03 with `subIntent = null` | HIL-04, no action taken |
| FIT classification | SC-01/SC-02 FIT | Routed to Jordan only |
| FLO classification | SC-01/SC-05 FLO | Routed to Josh only |
| **Missing FIT/FLO** | SC-01/SC-02 with `program = UNKNOWN` | **Routed to BOTH Jordan and Josh (FR-027)** |
| Multi-intent email | SC-07 + SC-02; SC-11 + SC-01; three-intent; CR-vs-technical | Both routes, or human review per the rule |
| Duplicate email | Sequential replay, concurrent delivery, lease expiry, secondary key | Exactly one execution |
| Attachment | Metadata extraction, spoofed MIME, oversize, inline | Correct support decision |
| Screenshot | Screenshot detection; SC-01 escalation on GPID | Signal reaches the classifier |
| Automated response | SC-01 with an activated template | Reply to sender only, no forward |
| Out of office | SC-08 | Mark read + soft delete, no reply |
| Resolved response | SC-11 | Move to Resolved, no reply |
| Routing failure | Unresolvable rule; missing owner address | HIL-04, mailbox untouched |
| AI timeout | Scripted transient failure | HIL-05 → human review |
| Power Automate retry | Concurrent and sequential replay | Duplicate detected |
| Graph API failure | `RecordingMailbox.failOn` | Plan halts, original not moved or deleted |

---

## 2. Security coverage (BRD Phase 7)

| Threat | Test | Assertion |
|---|---|---|
| T-01 injection → routing | "ignores an address the model was tricked into proposing" | Injected address never reaches a recipient |
| T-01 injection → action | "escalates rather than acting when injection is detected" | No mailbox call at all |
| T-01 detection | 7 injection shapes; 4 benign controls | Detected; no false positives on business language |
| T-01 no echo | excerpt-hash test | Attacker text never enters telemetry |
| T-02 hidden HTML | display:none, font-size:0, white-on-white, comments | Removed before the model sees them |
| T-02 delimiter escape | `<<<EMAIL_CONTENT_END>>>` in the body | Neutralised |
| T-03 HTML injection | Template render | Output HTML-encoded |
| T-03 invented URL | Template render | Rejected |
| T-04 path traversal | `../../../etc/passwd` | Separators stripped |
| T-04 RTLO | bidi override in a filename | Removed; real extension resolved |
| T-04 double extension | `report.pdf.exe` | Resolves to `exe` |
| T-05 self-sent | Sender is the mailbox | Suppressed |
| T-05 bot header | `X-SPA-Bot-ProcessingId` present | Suppressed |
| T-05 conversation cap | Outbound count at the cap | Suppressed |
| T-11 config integrity | Shipped configuration audit | Every outbound flag off; no active template; delete only for SC-08 |
| T-13 telemetry | Logger, redaction, child logger | No body, GPID or address in output |
| T-14 attachment content | Feature-flag assertion | Content never downloaded |
| T-15 unapproved action | Schema and validator | Rejected at both boundaries |
| Rule 11 | Reasoning length; extra fields | Over-long rejected; extra fields dropped |
| Rule 14 | Send on a scenario that forbids it | Rejected (AV-002) |
| Rule 15 | Delete outside SC-08 | Rejected (AV-001/AV-003) |
| Rule 16 | Recipient not in configuration | Rejected (AV-007) |
| GAP-004 | Inactive template | Send blocked (AV-011) |
| GAP-006 | Hard delete not enabled | Rejected (AV-016) |
| GAP-017 | External recipient | Rejected (AV-008) |
| Rule 4 | Configuration secret scan | No credential-shaped keys |

---

## 3. Coverage gaps — stated plainly

These are **not** covered by the automated suite, and no test in this repository should be read as
evidence that they work.

| Not covered | Why | How it will be verified |
|---|---|---|
| The real Microsoft Graph calls | No tenant is available in this environment. The Graph contracts in `docs/integration-design.md` are written from the documented v1.0 API but have not been executed. | DEV smoke test against the real mailbox — a deployment gate. |
| The real Azure OpenAI calls | No endpoint available. The client is unit-tested through its port; the HTTP path has not run. | DEV smoke test. |
| Dataverse persistence | The `ProcessingStore` is exercised through an in-memory double with the same uniqueness semantics. **The alternate-key constraint that makes idempotency real is a platform feature and must be verified in DEV.** | DEV: attempt two concurrent claims of one `internetMessageId`. |
| Power Automate flow execution | Flows are designed, not built, in this repository. | Manual test per flow in DEV. |
| Copilot Studio agent behaviour | Configured, not deployed. | Manual test in DEV. |
| Real-world classification accuracy | The model is scripted, so these tests measure the deterministic layer, not the model's judgement. | The shadow-mode pilot (`docs/deployment.md` §7 stage 1) is what measures accuracy. |
| End-to-end latency and throughput | No volume targets exist (GAP-002). | Load test once Q-15 is answered. |

**The shadow-mode pilot is the real accuracy test.** This suite proves the controls hold; it does
not prove the model classifies well, and nothing in it should be presented as though it does.
