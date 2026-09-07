# Integration Design
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Every integration below uses a real, documented Microsoft API. No API in this document is invented
(Rule 5). Endpoints are stated in the form used by Microsoft Graph v1.0.

---

## 1. Microsoft Graph (INT-02)

Base: `https://graph.microsoft.com/v1.0`. Auth: Entra application token via Managed Identity,
scoped by Application Access Policy (see `docs/security-design.md` §2).
`{mailbox}` is the SPA shared mailbox UPN (GAP-013).

| # | Operation | Request | Requirement |
|---|---|---|---|
| G-01 | Read message with headers and attachments | `GET /users/{mailbox}/messages/{id}?$select=id,internetMessageId,conversationId,conversationIndex,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead,internetMessageHeaders&$expand=attachments($select=id,name,contentType,size,isInline)` | FR-002, FR-071, FR-075, FR-080 |
| G-02 | List mail folders (resolve folder ids) | `GET /users/{mailbox}/mailFolders?$top=100` and `GET /users/{mailbox}/mailFolders/{id}/childFolders` | FR-009 |
| G-03 | Reply to sender | `POST /users/{mailbox}/messages/{id}/reply` — body `{ "message": { "body": {...}, "internetMessageHeaders": [{"name":"X-SPA-Bot-ProcessingId","value":"..."}] }, "comment": "" }` | FR-007, FR-073 |
| G-04 | Forward to owner | `POST /users/{mailbox}/messages/{id}/forward` — body `{ "toRecipients": [...], "message": { "internetMessageHeaders": [...] } }` | FR-008 |
| G-05 | Move to folder | `POST /users/{mailbox}/messages/{id}/move` — body `{ "destinationId": "<folderId>" }` | FR-009 |
| G-06 | Mark as read | `PATCH /users/{mailbox}/messages/{id}` — body `{ "isRead": true }` | FR-010 |
| G-07 | Soft delete | `POST /users/{mailbox}/messages/{id}/move` — `{ "destinationId": "deleteditems" }` | FR-044 (default) |
| G-08 | Hard delete | `DELETE /users/{mailbox}/messages/{id}` | FR-044 (only if configured — GAP-006) |
| G-09 | Thread context | `GET /users/{mailbox}/messages?$filter=conversationId eq '{cid}'&$select=from,receivedDateTime,subject&$orderby=receivedDateTime desc&$top=10` | FR-011, FR-026 |
| G-10 | Sender directory lookup | `GET /users/{upn}?$select=id,displayName,mail,department,officeLocation,usageLocation` | GAP-007, GAP-012 |

### Notes that matter in practice

- **`id` is not stable.** The Graph message `id` changes when a message moves folders. Idempotency
  therefore keys on `internetMessageId` (G-01), and `MoveEmail` is always ordered so that no
  subsequent step depends on the pre-move id (see `solution-design.md` §3).
- **Custom internet headers** set via `internetMessageHeaders` must begin with `X-` and are only
  settable at creation/send time. This is what makes structural loop detection possible (FR-073).
- **`internetMessageHeaders` on read** returns the headers Exchange retained; `Auto-Submitted` and
  `X-Auto-Response-Suppress` are the reliable auto-reply signals (FR-075, SC-08). Subject-prefix
  matching ("Automatic reply:") is a fallback, because it is locale-dependent.
- **Throttling.** Graph returns `429` with `Retry-After`. The client honours `Retry-After`
  exactly, and only then applies its own backoff (NFR-001).
- **`ConsistencyLevel: eventual`** is required for `$count`/advanced query on some resources; not
  needed by the calls above.

---

## 2. Azure OpenAI (INT-05)

`POST {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
Auth: Managed Identity bearer token for scope `https://cognitiveservices.azure.com/.default`.
Endpoint, deployment name and api-version are configuration (NFR-021).

Request shape:

```json
{
  "messages": [
    { "role": "system", "content": "<versioned prompt from /prompts>" },
    { "role": "user",   "content": "<delimited, sanitised email content>" }
  ],
  "temperature": 0,
  "max_tokens": 1200,
  "response_format": { "type": "json_object" }
}
```

Captured per call: `latencyMs`, `usage.prompt_tokens`, `usage.completion_tokens`, deployment name,
model version, prompt name and version, schema-valid flag, repair-attempted flag (NFR-005).
Timeout `aiTimeoutMs`, 2 retries with full-jitter backoff, `429`/`5xx` treated as transient,
`400`/`401`/`403` as permanent (NFR-001).

---

## 3. Dataverse (INT-06)

Web API: `{orgUrl}/api/data/v9.2/`. Auth: Managed Identity.

| Operation | Request | Requirement |
|---|---|---|
| Idempotency claim | `POST /spa_emailprocessings` with alternate key `spa_internetmessageid`; a `412`/duplicate-key response means already claimed | FR-070, FR-071 |
| Upsert by alternate key | `PATCH /spa_emailprocessings(spa_internetmessageid='{id}')` with `If-Match: *` | |
| Configuration read | `GET /spa_configurations?$filter=spa_isactive eq true` | NFR-015 |
| Scenario read | `GET /spa_businessscenarios?$filter=spa_isactive eq true` | |
| Routing read | `GET /spa_routingrules?$filter=spa_isactive eq true&$orderby=spa_priority` | |
| Template read | `GET /spa_responsetemplates?$filter=spa_isactive eq true` | BRD§12 |
| Audit writes | `POST /spa_emailactions`, `/spa_classificationresults`, `/spa_processingerrors` | FR-013 |
| Review queue | `POST /spa_humanreviewqueues`, `PATCH …` | BRD§10 |
| Weekly aggregation | `GET /spa_emailprocessings?$filter=spa_receiveddatetime ge {start} and spa_receiveddatetime lt {end}&$select=…` | BRD§19 |

Configuration is cached in-process for `configuration.cacheTtlSeconds` (default 300) so that a
business change propagates within five minutes without a deployment, and a Dataverse outage does
not stop classification of in-flight mail.

---

## 4. Custom connector — SPA Decision Service (INT-03)

OpenAPI 2.0 definition in `infrastructure/power-platform/connectors/spa-decision-service.swagger.json`.
Entra-authenticated. Used by both Power Automate and Copilot Studio, so the two surfaces share one
decision path (see `ai-agent-design.md` §2).

### `POST /api/process`

Request:

```json
{
  "correlationId": "string",
  "message": {
    "id": "string",
    "internetMessageId": "string",
    "conversationId": "string",
    "conversationIndex": "string",
    "subject": "string",
    "body": { "contentType": "html|text", "content": "string" },
    "from": { "address": "string", "name": "string" },
    "toRecipients": [{ "address": "string", "name": "string" }],
    "ccRecipients": [{ "address": "string", "name": "string" }],
    "receivedDateTime": "2026-09-07T10:00:00Z",
    "hasAttachments": true,
    "isRead": false,
    "internetMessageHeaders": [{ "name": "string", "value": "string" }],
    "attachments": [{ "id": "string", "name": "string", "contentType": "string", "size": 0, "isInline": false }]
  },
  "threadContext": [{ "from": "string", "receivedDateTime": "string", "subject": "string" }]
}
```

Response:

```json
{
  "processingId": "string",
  "outcome": "EXECUTE|HUMAN_REVIEW|SUPPRESS|DUPLICATE|SHADOW",
  "classification": { "...": "classification schema" },
  "confidenceBand": "HIGH|MEDIUM|LOW",
  "actionPlan": [
    { "sequence": 1, "actionType": "ForwardEmail",
      "parameters": { "toRecipients": ["amy.fischer@pepsico.com"] },
      "resolvedDestination": "amy.fischer@pepsico.com" }
  ],
  "humanReviewReason": "HIL-01",
  "auditRef": "string",
  "warnings": ["string"]
}
```

`actionPlan` is the **only** instruction Flow 2 acts on, and every parameter in it has already
passed `ActionValidator`. Flow 2 makes no decisions of its own.

### `POST /api/actions/result`

```json
{ "processingId": "string",
  "results": [{ "sequence": 1, "status": "Succeeded|Failed|Skipped",
                "graphRequestId": "string", "errorCode": "string", "errorMessage": "string" }] }
```

---

## 5. Outlook connector (INT-01)

Used only for the **trigger** — *When a new email arrives in a shared mailbox (V2)* — because
Graph change notifications require a public webhook endpoint and subscription renewal, which adds
operational burden without benefit at this volume (AD-023).

All subsequent reads and mailbox operations use Graph (§1), because the connector does not reliably
surface `internetMessageId` or `internetMessageHeaders` — both of which are load-bearing for
idempotency and loop prevention.

*Alternative retained for scale:* Graph `POST /subscriptions` on
`/users/{mailbox}/mailFolders('Inbox')/messages` with a Function HTTP webhook, if trigger latency or
volume ever demands it.

---

## 6. Teams (INT-09)

*Post adaptive card and wait for a response* to the reviewer group, carrying subject, scenario,
programme, confidence, entities and the proposed plan. Buttons: Approve · Reject · Correct.
The model-driven app is the fuller surface; the card is the fast path (GAP-008).

---

## 7. Application Insights (INT-07)

OpenTelemetry-style custom events via the Azure Monitor exporter:
`EmailProcessed`, `ClassificationCompleted`, `ActionExecuted`, `HumanReviewRaised`,
`ProcessingFailed`, `WeeklyReportGenerated`. Every event carries `correlationId` and `processingId`
and passes through the redaction layer (NFR-007).

---

## 8. Power BI (INT-08)

Dataverse connector in DirectQuery over `EmailProcessing`, `EmailAction`, `BusinessScenario`,
`RegionMapping`. Report pages: volume by region, scenario by region, routing distribution,
confidence distribution, human-review rate, failure rate. Refreshed for the Friday cadence.

---

## 9. Integration failure matrix (NFR-001 – NFR-004)

| Dependency | Timeout | Retries | Backoff | On exhaustion |
|---|---|---|---|---|
| Microsoft Graph — read | 30 s | 3 | full-jitter exp., honours `Retry-After` | `ProcessingError`, HIL-08 |
| Microsoft Graph — write | 30 s | 3 | as above | `ProcessingError`, HIL-08, **email untouched** |
| Azure OpenAI | 30 s | 2 | full-jitter exp. | HIL-05 → human review |
| Dataverse — read | 15 s | 3 | full-jitter exp. | Fall back to cached config; if cold, fail closed |
| Dataverse — write | 15 s | 3 | full-jitter exp. | Dead-letter + alert |
| Teams | 15 s | 2 | linear | Review item remains in the queue; app surface unaffected |

**Fail closed, never fail open:** if configuration cannot be loaded, the service does not fall back
to defaults and act — it refuses to act and escalates. Acting on guessed routing rules is worse
than not acting.
