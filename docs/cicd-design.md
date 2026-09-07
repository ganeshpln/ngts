# CI/CD Design
## PEP Passport SPA Box Automation – Agentic (WIT 504)

Two pipelines, both in `.github/workflows/`. Azure authentication is OIDC federated — there is no
publish profile and no client secret stored in GitHub (Rule 4, NFR-009).

---

## 1. CI — `spa-mailbox-ci.yml`

Runs on every push and pull request touching the solution.

| Job | Gate | Enforces |
|---|---|---|
| Typecheck | `tsc --noEmit`, strict, `noUncheckedIndexedAccess` | Rule 7 |
| **Validate configuration** | `npm run validate:config` | Rule 3, FR-031, Rules 14/15 |
| Test | `npm test` — scenario, unit, integration and security suites | Rule 10, Phase 7 |
| Build | `tsc` | |
| Secret scan | grep for credential-shaped content in `src`, `config`, `prompts`, `infrastructure`, `tests` | Rule 4, NFR-009 |
| Local settings check | fails if `local.settings.json` was committed | Rule 4 |
| Bicep validate | `az bicep build` | NFR-020 |

The configuration gate is the distinctive one: it fails the build when a scenario permits an action
outside the approved set, a routing rule points at a scenario that does not exist, deletion is
enabled outside SC-08, sending is enabled with no active template, a threshold is out of range, or
a FIT/FLO scenario is missing its `UNKNOWN` rule (which would silently disable the BRD's
both-owners fallback). **A business-rule mistake is caught in CI, not in production.**

---

## 2. CD — `spa-mailbox-cd.yml`

Manual dispatch with an environment choice. PROD carries a required reviewer on the GitHub
environment.

1. Re-run every CI gate. A deployment never skips them.
2. Build and prune to production dependencies.
3. Azure login via OIDC.
4. `az deployment group create` with the environment's `.bicepparam`.
5. Publish the Function App.
6. **Health gate:** poll `/api/health` with backoff; anything other than `200` fails the
   deployment. The endpoint returns `503` when configuration is invalid, so a bad configuration
   fails the pipeline instead of quietly serving traffic.
7. Emit the manual Power Platform reminders.

---

## 3. What is deliberately not automated

| Step | Why |
|---|---|
| Power Platform solution import | Needs connection references bound to real connections created by a person. Automatable with `pac cli` once the environments and service principals exist. |
| Configuration data migration | Business-owned data. Moving it automatically would overwrite tuning done in the target environment. |
| Exchange Application Access Policy | Requires an Exchange admin and must be *verified*, not just applied — the `Test-ApplicationAccessPolicy` denial check is the point. |
| Enabling feature flags | Each is gated on a business answer (see the go-live sequence in `docs/deployment.md` §7). Automating it would defeat the ships-disabled posture. |

---

## 4. Branching and versioning

- Feature branches; pull request to the default branch; CI must pass.
- **Prompt changes bump the prompt's semver** and re-run the scenario suite. A prompt is a business
  rule in this system, so it goes through review like any other.
- **Configuration changes in `/config`** are the versioned seed for a clean environment. Runtime
  tuning happens in Dataverse and is not expected to round-trip back into the repository.
- Tag a release when a solution version is promoted to PROD.

---

## 5. Test strategy in the pipeline

| Suite | Runs | Purpose |
|---|---|---|
| `tests/unit` | every push | Pure functions: banding, programme resolution, multi-intent, routing, rendering, report. |
| `tests/scenario` | every push | All 12 BRD scenarios end to end through the real pipeline. |
| `tests/integration` | every push | Composition: duplicates, concurrency, AI failure, execution failure, retry. |
| `tests/security` | every push | The threat model in `docs/security-design.md` §3. |

The model is scripted in every suite, so CI is deterministic, offline and free — and the tests
assert on the *deterministic* behaviour, which is what the controls actually depend on.
