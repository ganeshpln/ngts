# Operations and Support Guide
## PEP Passport SPA Box Automation – Agentic (WIT 504)

---

## 1. What normal looks like

| Signal | Healthy | Investigate |
|---|---|---|
| `EmailProcessing` rows/day | matches inbound mail volume | a sharp drop means the trigger has stopped |
| Human-review rate | 10–25% during the pilot | above 40% means thresholds or prompts need attention |
| Confidence distribution | most mail HIGH | a shift towards LOW usually follows a model or prompt change |
| Failure rate | under 1% | anything sustained above that |
| `DUPLICATE` outcomes | a small trickle (Power Automate retries) | a spike means the trigger is firing repeatedly |
| `unmappedRegionCount` | equals total, until GAP-012 closes | after the mapping lands, any residue means gaps in it |

`GET /api/health` reports configuration validity, the current mode (shadow or live) and which
outbound capabilities are enabled.

---

## 2. Alerts and first response

| Alert | Likely cause | First action |
|---|---|---|
| Processing failures > 0 in 15 min | Graph or Dataverse throttling, or a bad deployment | Check `ProcessingError` rows: `errorCategory = Transient` self-heals via Flow 5; `Permanent` needs a fix. |
| `/api/health` returns 503 | Configuration validation failed | Read the `errors` array. Usually a routing rule referencing a scenario that was deactivated. |
| Human-review queue growing | Thresholds too strict, prompt regression, or unusual mail | Group `HumanReviewQueue` by `triggerReason`. HIL-01 means confidence; HIL-04 means routing. |
| Dead-lettered rows appear | Retries exhausted | Inspect the stage; the original email is untouched and can be handled manually. |
| Outbound spike on one conversation | Loop | The conversation cap should have stopped it. Verify `botIdentities` is populated (GAP-013). |

---

## 2a. Trying a decision before it happens

`npm run shadow -- <sample.json>` runs any email through the real pipeline with shadow mode on and
prints the decision, the resolved destinations and the plain-English effect. It never touches the
mailbox. Use it to answer "where would this have gone?" without waiting for the email to arrive
again - copy a real message into the sample format under `samples/`, and add its classification
under `scriptedClassification` (or point the tool at Azure OpenAI to have the model classify it).

`--as-shipped` runs the committed configuration untouched, which shows which feature flags are
currently blocking an action.

## 3. Runbooks

### 3.1 Stop the automation immediately
Set `shadowMode = true` in the Dataverse `Configuration` table. It takes effect within
`configuration.cacheTtlSeconds` (5 minutes) with no deployment. Classification and auditing
continue, so you keep the record of what *would* have happened. To stop entirely, turn off Flow 1.

### 3.2 An email was routed to the wrong owner
1. Find the `EmailProcessing` row by `internetMessageId`.
2. Read `ClassificationResult` — `reasoningSummary` says why, and `promptVersion` says which prompt.
3. If the **classification** was wrong: add the email as a negative example on the scenario it was
   wrongly assigned to, and as a positive example on the right one, in `spa_businessscenario`.
4. If the **routing** was wrong: fix the `spa_routingrule` row. No deployment.
5. Record the correction in `HumanReviewCorrection` so it feeds the improvement loop (FR-064).

### 3.3 An email was processed twice
This should be impossible; treat it as a defect. Check whether two `EmailProcessing` rows share an
`internetMessageId` — if so, the Dataverse alternate key is missing or was dropped during a solution
import. Restore it before re-enabling outbound actions.

### 3.4 A learner did not get an automated response
Check in order: is `sendResponsesEnabled` on? Is the template `isActive`? Does the outcome say
`SHADOW`? Is the recipient domain allow-listed (GAP-017)? The `warnings` array on the processing row
names the reason directly — a `SendResponse omitted:` warning gives the exact cause.

### 3.5 The Friday report did not arrive
`reporting.recipients` is empty by default (GAP-014). Flow 4 logs and skips rather than guessing an
address. Populate the recipients and re-run Flow 4 manually.

### 3.6 Azure OpenAI is throttling
Transient by nature; the client honours `Retry-After` then backs off. Sustained throttling means
capacity is undersized — raise `openAiCapacity` in the Bicep parameters. Affected emails go to human
review, never dropped.

### 3.6a The second model call

Medium-band and multi-intent emails make a **second** model call to the
`routing_decision_validator` (prompt 5). That roughly doubles the token cost for those emails, and
adds their latency. It is skipped for LOW-band items, which are already bound for a human, and for
straightforward high-confidence single-intent mail.

If cost or latency becomes a problem, `corroboration.consultValidatorOnMediumBand` and
`consultValidatorOnMultiIntent` in the Dataverse `Configuration` table turn each trigger off
independently. Be clear about what that buys: with the multi-intent trigger off, multi-intent
emails have no second opinion to rely on and escalate to a human instead, so you trade model spend
for reviewer time rather than for risk.

### 3.7 Tuning confidence thresholds
Edit `confidence.highThreshold` / `confidence.mediumThreshold` in the Dataverse `Configuration`
table. Move in steps of 0.05 and watch the human-review rate for a week. Raising a threshold sends
more to humans (safer, slower); lowering it does the opposite. Per-scenario overrides let you tune
SC-04 and SC-08 — machine-generated and near-deterministic — separately from judgement-heavy ones.

---

## 4. Routine tasks

| Cadence | Task |
|---|---|
| Daily | Clear the human review queue. Check failure alerts. |
| Weekly | Review the Friday report. Check `unmappedRegionCount`. Skim `HumanReviewCorrection` for patterns. |
| Monthly | Review the confidence distribution and human-review rate; consider threshold changes. Review the scenario mix against expectation. |
| Quarterly | Re-verify the Exchange Application Access Policy. Review Graph permissions. Re-read the open questions in `docs/open-questions.md` and close what has been answered. |
| On model upgrade | Re-run the scenario test suite. Compare classification distribution before and after. `ClassificationResult.modelVersion` attributes any change. |

---

## 5. Changing business rules without a deployment

| Change | Where | Effect |
|---|---|---|
| Owner email address | `spa_routingrule.spa_owneremail` | Within 5 minutes |
| Destination folder | `spa_routingrule.spa_destinationfolder` | Within 5 minutes |
| Approved response wording | `spa_responsetemplate` — update body, set `isActive`, bump `version` | Within 5 minutes |
| Confidence thresholds | `spa_configuration` | Within 5 minutes |
| Scenario keywords / examples | `spa_businessscenario` | Within 5 minutes |
| Region mapping | `spa_regionmapping` | Next report |
| Enable or disable a capability | `spa_configuration` feature flags | Within 5 minutes |

Changes that **do** need a deployment: prompt wording, the decision engine, the action set, and the
schema. Those are code, reviewed and tested.

---

## 6. Diagnosing with telemetry

Every record carries `correlationId` and `processingId`, and both flow from the Power Automate run
through the Decision Service to the model call and back.

```kusto
traces
| where customDimensions.correlationId == "<correlationId>"
| project timestamp, message, customDimensions.stage, customDimensions.outcome,
          customDimensions.scenarioId, customDimensions.confidence, customDimensions.aiLatencyMs
| order by timestamp asc
```

**Telemetry never contains email bodies, GPIDs, learner names or sender addresses** — redaction is
applied at the logger (NFR-007). To read the content of a specific email, open it in Outlook using
the `messageId`; do not expect to reconstruct it from logs. That is deliberate.

---

## 7. Escalation

| Symptom | Owner |
|---|---|
| Wrong classification or routing | SPA business owner — configuration change |
| Missing or wrong template wording | Business owner (Q-02, Q-03) |
| Change-request routing questions | PEP Passport product owner (Q-04) |
| Region mapping | Amy Fischer (Q-06) |
| Azure or Graph failures | IT / Platform |
| Suspected prompt injection or abuse | Security — HIL-09 rows in `HumanReviewQueue` |
| Privacy or retention questions | Data Privacy (Q-05) |
