# Deployment Guide
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Three environments — **DEV**, **TEST**, **PROD** — with identical topology and different
configuration. No environment-specific value is compiled into any artefact (NFR-021).

> **Read `docs/production-checklist.md` before any PROD deployment.** Several blocking gaps
> (GAP-003, GAP-004, GAP-009, GAP-012) must be closed first, and the Exchange Application Access
> Policy must be verified.

---

## 1. Prerequisites

| # | Prerequisite | Owner | Gap |
|---|---|---|---|
| 1 | Azure subscription and resource group per environment | IT | Q-14 |
| 2 | Power Platform environment per environment, with Dataverse | IT | Q-14 |
| 3 | SPA shared mailbox UPN | IT | GAP-013 / Q-14 |
| 4 | Entra app registration for Graph, with Application Access Policy applied | IT / Exchange admin | §3 |
| 5 | Entra app registration protecting the Function App (Easy Auth) | IT | — |
| 6 | Azure OpenAI quota in an approved region | IT / Procurement | GAP-009, GAP-018 |
| 7 | Copilot Studio and premium Power Automate licensing | Procurement | GAP-018 / Q-16 |
| 8 | Data-privacy approval to send email content to Azure OpenAI | Data Privacy | **GAP-009 / Q-05 — blocking** |

---

## 2. Azure resources (Bicep)

```bash
# One-time per environment
az group create --name rg-spa-mailbox-dev --location <region>

# Fill in the placeholders in the parameter file first - they are deliberately not defaulted.
az deployment group create \
  --resource-group rg-spa-mailbox-dev \
  --template-file infrastructure/bicep/main.bicep \
  --parameters infrastructure/bicep/parameters/dev.bicepparam
```

Deployed: Log Analytics, Application Insights, Key Vault, Azure OpenAI (with `disableLocalAuth`,
so only Managed Identity works), a storage account, an App Service plan, the Function App with a
system-assigned identity and Entra Easy Auth, three least-privilege role assignments, an action
group and a failure alert. `enablePrivateEndpoints` adds private endpoints for Azure OpenAI and
Key Vault — **recommended for PROD**.

Outputs: `functionAppName`, `functionAppHostName`, `functionAppPrincipalId`, `openAiEndpoint`,
`keyVaultName`.

---

## 3. Microsoft Graph permissions — and the mandatory scoping step

Grant the app registration these **application** permissions with admin consent:
`Mail.ReadWrite`, `Mail.Send`, `User.Read.All`.

These are tenant-wide by default. **That is not acceptable**, so scope them to the SPA mailbox with
an Exchange Application Access Policy:

```powershell
Connect-ExchangeOnline

New-DistributionGroup -Name "SPA-Automation-Scope-dev" -Type Security `
    -Members "<spa-shared-mailbox-upn>"

New-ApplicationAccessPolicy `
    -AppId "<entra-app-id>" `
    -PolicyScopeGroupId "SPA-Automation-Scope-dev" `
    -AccessRight RestrictAccess `
    -Description "Restrict SPA Mailbox Automation to the SPA shared mailbox only"

# Both checks are deployment gates.
Test-ApplicationAccessPolicy -Identity "<spa-shared-mailbox-upn>" -AppId "<entra-app-id>"   # Granted
Test-ApplicationAccessPolicy -Identity "<any-other-mailbox>"      -AppId "<entra-app-id>"   # Denied
```

Without this, a compromise of the Function App reaches every mailbox in the tenant instead of one.

---

## 4. Dataverse

1. Create the tables, columns, alternate keys and security roles from
   `infrastructure/power-platform/dataverse/tables.json` (see `docs/data-model.md` for the full
   spec). The alternate key on `spa_internetmessageid` is **required** — it is what makes duplicate
   processing impossible rather than unlikely.
2. Grant the Function App's managed identity an application user with the **SPA Automation Service**
   role. That role is deliberately **read-only on configuration tables**, so the automation cannot
   rewrite its own routing rules (threat T-11).
3. Seed configuration from `/config` using the Configuration Migration Tool:
   `scenarios.json`, `routing-rules.json`, `response-templates.json`, `thresholds.json`,
   `application.json`. **`region-mapping.json` is empty by design** (GAP-012).

---

## 5. Power Platform solution

1. Import `SPAMailboxAutomation` (managed for TEST and PROD).
2. Set the environment variables listed in `infrastructure/power-platform/flows/README.md`.
3. Create the connection references: Office 365 Outlook (on the shared mailbox), HTTP with Entra ID,
   the SPA Decision Service custom connector, Dataverse, Teams.
4. Import the custom connector from
   `infrastructure/power-platform/connectors/spa-decision-service.swagger.json`, substituting
   `{FUNCTION_APP_HOSTNAME}`, `{TENANT_ID}` and `{API_CLIENT_ID}`.
5. Configure the Copilot Studio agent per
   `infrastructure/power-platform/copilot-studio/agent-instructions.md`. **Grant it the Decision
   Service connector and nothing else.**
6. Turn on the flows **in this order**: Flow 5 (sweeper), Flow 3 (review), Flow 2 (execution),
   Flow 4 (report), then Flow 1 (intake). Intake last, so nothing arrives before its downstream
   flows exist.

---

## 6. Decision Service

```bash
npm ci
npm run typecheck
npm run validate:config     # deployment gate
npm test
npm run build
npm ci --omit=dev
func azure functionapp publish func-spa-<env>-decision
```

Or use the CD workflow (`.github/workflows/spa-mailbox-cd.yml`), which runs the same gates and then
a post-deployment health check.

### Application settings

| Setting | Source | Secret? |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | Bicep output | No |
| `AZURE_OPENAI_DEPLOYMENT` | Bicep parameter | No |
| `AZURE_OPENAI_API_VERSION` | Bicep parameter | No |
| `DATAVERSE_URL` | Bicep parameter | No |
| `SPA_MAILBOX_UPN` | Bicep parameter | No |
| `PROCESSING_STORE_MODULE` | Bicep parameter | No |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Bicep output | Key Vault reference |

**There is no credential setting.** Azure OpenAI and Dataverse both authenticate with the Function
App's managed identity (NFR-009, NFR-010, Rule 4).

---

## 7. Go-live sequence

The system ships with every outbound capability **disabled** and shadow mode **on**. These are two
independent controls, and understanding the difference matters:

- **Capability flags** (`forwardingEnabled`, `moveEnabled`, …) say *what the system is configured to
  do*. With a flag off, the ActionValidator rejects that action and the email escalates.
- **`shadowMode`** says *whether anything is actually executed*. With it on, the full decision is
  made, validated and audited, and every mailbox side effect is suppressed.

So a shadow pilot enables the capabilities you intend to run and keeps `shadowMode` on. Running a
pilot with every capability disabled teaches you nothing — every email reports as blocked on its
feature flag rather than showing the routing decision you wanted to observe.

| Stage | Configuration | Gate |
|---|---|---|
| 1. Shadow pilot | `shadowMode: true`, plus the capabilities you intend to run (typically mark-read, move, forwarding) | Run for at least two weeks. Review the classification distribution, confidence bands, human-review rate and the audited action plans. Tune thresholds in the Dataverse `Configuration` table. **This is the only stage that measures classification accuracy.** |
| 2. Filing live | `shadowMode: false` with only `markAsReadEnabled`, `moveEnabled` | Folder names confirmed (Q-07). Verify SC-04, SC-11 filing on real mail. Filing is the lowest-risk action: it is visible and reversible. |
| 3. Routing | add `forwardingEnabled` | Owner addresses confirmed. Watch for misrouted mail for one week. |
| 4. Responding | add `sendResponsesEnabled` + activate templates | **Approved wording supplied and templates activated (Q-02, Q-03).** Verify the outbound domain allow-list. |
| 5. Change requests | add `changeRequestRoutingEnabled` | Change-request mechanics confirmed (Q-04). |
| 6. Deletion | add `deleteEnabled` | Delete semantics and retention confirmed (Q-08). Keep `hardDeleteEnabled` off. |

To rehearse any stage before committing to it, set `shadowMode: true` with that stage's flags on:
the decisions are real and fully audited, and nothing is executed.

Rolling back a stage is a configuration change in Dataverse, not a deployment.

---

## 8. Rollback

| Scenario | Action |
|---|---|
| Bad classification behaviour | Set `shadowMode = true` in Dataverse. Effective within `cacheTtlSeconds` (5 minutes). No deployment. |
| Wrong routing address | Correct the `spa_routingrule` row. No deployment. |
| Bad Decision Service release | Swap back the previous Function App deployment. |
| Bad solution import | Restore the previous managed solution version. |
| Bad prompt change | Revert the prompt file and redeploy; the prompt version on each `ClassificationResult` identifies which rows were affected. |

---

## 9. Verification after deployment

```bash
curl -H "Authorization: Bearer <token>" https://<functionApp>/api/health
```

Expect `200` with `configurationValid: true`, and `mode: "shadow"` on a first deployment. A `503`
means configuration validation failed — the service is failing closed and must not be given traffic.

Then confirm: Flow 1 triggers on a test email; an `EmailProcessing` row is created; a
`ClassificationResult` row carries a prompt version; `EmailAction` rows show `Shadowed`; and no
mailbox change occurred.
