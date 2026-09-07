# Production Deployment Checklist
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Every item must be **verified**, not merely done. Items marked **BLOCKING** prevent production
deployment.

---

## A. Business sign-off

- [ ] **BLOCKING** Original BRD attached to `docs/source/` and this analysis re-verified against it (GAP-001, Q-01).
- [ ] **BLOCKING** Approved troubleshooting template wording supplied and approved (GAP-004, Q-02).
- [ ] **BLOCKING** Approved change-request template wording supplied (GAP-004, Q-03).
- [ ] **BLOCKING** Change-request process mechanics defined: form URL, submit-vs-link, destination mailbox, owning team (GAP-003, Q-04).
- [ ] **BLOCKING** Region mapping supplied, including the key that determines a message's region (GAP-012, Q-06).
- [ ] Outlook folder names supplied for every scenario (GAP-005, Q-07).
- [ ] SC-08 delete semantics confirmed: Deleted Items or permanent, and retention checked (GAP-006, Q-08).
- [ ] SC-01/SC-02 escalation rule defined: what counts as "persists" and how long to wait (GAP-010, Q-09).
- [ ] FR-011 suppression scope confirmed: what counts as an owner response, whether it expires, which addresses count (GAP-015, Q-10).
- [ ] External-recipient policy decided (GAP-017, Q-11).
- [ ] Friday report recipients, time, timezone and format confirmed (GAP-014, Q-12).
- [ ] Human reviewers named and the review SLA agreed (GAP-008, Q-13).
- [ ] Sender-type taxonomy confirmed (GAP-007, Q-17).
- [ ] Volume and latency expectations stated (GAP-002, Q-15).

## B. Privacy and compliance

- [ ] **BLOCKING** Approval to send email content to Azure OpenAI, with region and residency confirmed (GAP-009, Q-05).
- [ ] **BLOCKING** Data-retention period agreed for rows containing GPID and learner names (GAP-009).
- [ ] Lawful basis for processing confirmed; DPIA or privacy review completed.
- [ ] `safety.storeBodyPreview` reviewed — default `false` stores only a hash.
- [ ] Mailbox retention and eDiscovery policy checked against SC-08 deletion.
- [ ] Application Insights retention set to the agreed period.

## C. Security

- [ ] **BLOCKING** Exchange Application Access Policy applied **and verified**: `Test-ApplicationAccessPolicy` returns *Granted* for the SPA mailbox and *Denied* for another mailbox.
- [ ] Graph permissions limited to `Mail.ReadWrite`, `Mail.Send`, `User.Read.All`, with admin consent recorded.
- [ ] Function App Entra Easy Auth enabled; an unauthenticated request returns 401.
- [ ] Managed identity in use for Azure OpenAI and Dataverse; `disableLocalAuth` is true on the Azure OpenAI account.
- [ ] Dataverse application user holds **SPA Automation Service**, which is read-only on configuration tables.
- [ ] Copilot Studio agent has the Decision Service connector **and no other connector**.
- [ ] Private endpoints enabled for Azure OpenAI and Key Vault (`enablePrivateEndpoints = true`).
- [ ] CI secret scan passing; no `local.settings.json` committed.
- [ ] Security test suite passing (`tests/security`).
- [ ] Penetration test or security review completed for the exposed endpoints.

## D. Configuration

- [ ] `npm run validate:config` reports **0 errors**.
- [ ] Owner addresses verified current: Jordan Beahrs (FIT), Josh Baxter (FLO), Amy Fischer (Schoox).
- [ ] Every FIT/FLO scenario has an `UNKNOWN` routing rule — this is the BRD's both-owners fallback (FR-027) and its absence would silently disable it.
- [ ] `safety.botIdentities` populated with the mailbox UPN and every sending alias (GAP-013). Loop prevention is weaker while it is empty.
- [ ] `safety.allowedRecipientDomains` reviewed.
- [ ] Confidence thresholds reviewed against the shadow-mode pilot, not left at the untuned defaults.
- [ ] `hardDeleteEnabled` is `false`.
- [ ] Templates activated **only** for scenarios whose wording has been approved.

## E. Infrastructure

- [ ] Bicep deployed to PROD with the PROD parameter file; no placeholder values remain.
- [ ] Azure OpenAI capacity sized to the expected volume (Q-15, GAP-018).
- [ ] Model deployment pinned with `versionUpgradeOption: NoAutoUpgrade`.
- [ ] Application Insights receiving telemetry; the failure alert fires on a test failure.
- [ ] Action group has real recipients — it ships with none.
- [ ] Log Analytics retention set (365 days for PROD).

## F. Dataverse and Power Platform

- [ ] All 13 tables created with the columns in `docs/data-model.md`.
- [ ] **Alternate key on `spa_internetmessageid` present and enforced.** Verified by attempting two concurrent claims of one message and observing exactly one success. *This is the single control that prevents duplicate sends.*
- [ ] All four security roles created and assigned.
- [ ] Configuration data migrated; `spa_regionmapping` populated (or the `UNMAPPED` behaviour accepted knowingly).
- [ ] Managed solution imported; all connection references bound.
- [ ] Environment variables set with no placeholders.
- [ ] All five flows turned on in the documented order.
- [ ] Model-driven review app deployed and reviewers granted access.

## G. Verified in DEV first (Rule 6)

None of these has been executed in this repository. Each must pass in DEV before PROD.

- [ ] Flow 1 triggers on a real email in the SPA mailbox.
- [ ] Graph read returns `internetMessageId` and `internetMessageHeaders`.
- [ ] Azure OpenAI returns a schema-valid classification via managed identity.
- [ ] `EmailProcessing`, `ClassificationResult` and `EmailAction` rows are written.
- [ ] Duplicate delivery produces exactly one execution.
- [ ] `MoveEmail` returns a new message id and subsequent actions use it.
- [ ] A reply carries the `X-SPA-Bot-ProcessingId` header, and re-delivering it is suppressed.
- [ ] An out-of-office reply is detected from headers and soft-deleted.
- [ ] A low-confidence email reaches the review queue and the Teams card renders.
- [ ] A reviewer correction re-runs the engine and is recorded.
- [ ] The Friday report generates and delivers.
- [ ] `/api/health` returns 200 with `configurationValid: true`.

## H. Operational readiness

- [ ] `docs/operations-guide.md` handed over and walked through with support.
- [ ] Alert recipients configured and tested.
- [ ] Escalation contacts confirmed.
- [ ] Rollback rehearsed: setting `shadowMode = true` in Dataverse stops outbound action within 5 minutes.
- [ ] The go-live sequence in `docs/deployment.md` §7 agreed, with a named owner for each stage gate.

## I. Go-live

- [ ] Shadow mode has run for **at least two weeks** on real traffic.
- [ ] Classification distribution reviewed against expectation.
- [ ] Human-review rate is acceptable and the queue is being worked.
- [ ] Thresholds tuned from pilot data.
- [ ] Sample of shadowed decisions reviewed by the business and agreed.
- [ ] Capabilities enabled one stage at a time, each verified before the next.
- [ ] `shadowMode` set to `false` only after all of the above.

---

**Sign-off**

| Role | Name | Date |
|---|---|---|
| Business owner | | |
| Solution architect | | |
| Security | | |
| Data privacy | | |
| IT / Platform | | |
| Operations | | |
