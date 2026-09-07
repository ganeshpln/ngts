# Open Questions for Business / Architecture
## PEP Passport SPA Box Automation – Agentic (WIT 504)

These must be answered before production deployment. Each maps to a gap in
`docs/requirements-analysis.md` §15. **Blocking** questions prevent that capability from being
enabled at all — the code ships with the capability present but switched off.

---

## A. Blocking — production cannot proceed without these

| # | Gap | Question | Owner | Why it blocks |
|---|---|---|---|---|
| Q-01 | GAP-001 | Can the original BRD document be attached to the repository (`docs/source/`)? This analysis was produced from the project brief's restatement of it. | Business Analyst | Every requirement needs verification against the authoritative text before sign-off. |
| Q-02 | GAP-004 | What is the **exact approved wording** of the troubleshooting response template (SC-01, SC-02)? Please supply subject and body, and confirm the approver. | Business (Jordan / Josh) | No automated response can be sent. Templates ship inactive and sending is code-blocked. |
| Q-03 | GAP-004 | What is the approved wording for each change-request response template (SC-03, SC-05, SC-06, SC-09, SC-12)? | Business | Same as Q-02. |
| Q-04 | GAP-003 | How does the **formal PEP Passport change-request process** work? Specifically: (a) the form URL; (b) does the automation submit on the requester's behalf, or reply with the link and ask them to submit? (c) is there a change-request mailbox to forward to? (d) who owns the queue? | Business / PEP Passport product owner | Five scenarios route here. `RouteToChangeRequest` is disabled by default. |
| Q-05 | GAP-009 | Is it approved for **email body content to be sent to Azure OpenAI** for classification? Which region/data-residency applies, and what is the retention period for `EmailProcessing` rows containing GPID and learner names? | Data Privacy / Security | Cannot process real mail through the model without this. |
| Q-06 | GAP-012 | What is the **region mapping**? (BRD: "To be Provided by Amy".) Please supply: the list of regions, and the key that determines a message's region — sender domain, sender's location, learner's location, a distribution list, or something else. | Amy Fischer | All region-based reporting (FR-090, FR-091, FR-096) returns `UNMAPPED` until supplied. |

---

## B. High priority — required for correct behaviour

| # | Gap | Question | Owner |
|---|---|---|---|
| Q-07 | GAP-005 | What are the **exact Outlook folder names** for every scenario? The BRD names only *Pep Passport Change Requests* (SC-04), *Schoox* (SC-07) and *Resolved* (SC-11). SC-10 says "appropriate inquiry folder" — what is it called? What about SC-01, SC-02, SC-03, SC-05, SC-06, SC-09, SC-12? | Business |
| Q-08 | GAP-006 | For SC-08 (out-of-office), does "delete" mean **move to Deleted Items** (recoverable) or **permanent delete**? Are there retention or eDiscovery policies on this mailbox that permanent deletion would violate? | Business + Compliance |
| Q-09 | GAP-010 | For SC-01/SC-02: how does the system know the user has "confirmed the issue persists"? Is it any reply on the thread, a reply containing a screenshot or GPID, or a reply after N days? **How long should the system wait before escalating if there is no reply?** | Business |
| Q-10 | GAP-015 | BRD §1.11 says stop BOT processing once "the designated human owner has responded". Please confirm: (a) does *responded* mean any message sent by an owner on that conversation? (b) does suppression apply to the whole conversation thread permanently, or expire after a period? (c) which addresses count as "owners" — only the three named, or a wider group? | Business |
| Q-11 | GAP-017 | May automated responses be sent to **external senders** (non-`@pepsico.com`)? If yes, is the template wording different? Currently external senders are routed to human review. | Business + Security |
| Q-12 | GAP-014 | For the Friday report: **who receives it, at what time, in which timezone, and in what format** (email summary, Power BI link, Excel attachment)? Should it also be posted to a Teams channel? | Amy Fischer / Business |
| Q-13 | GAP-008 | Who performs **human review**? What is the review SLA? Preferred surface — a model-driven Power App, a Teams adaptive card, or an Outlook folder that reviewers work manually? | Business |
| Q-14 | GAP-013 | Please confirm: SPA shared mailbox UPN; Entra tenant ID; DEV/TEST/PROD Power Platform environment IDs and URLs; target Azure subscription and resource-group naming. | IT / Platform |
| Q-15 | GAP-002 | What is the **expected mail volume** (per day and peak)? What end-to-end latency is acceptable between arrival and action? Is there an SLA on the automated response? | Business |
| Q-16 | GAP-018 | Has licensing been secured — Copilot Studio message capacity, Azure OpenAI TPM quota, Dataverse storage, premium Power Automate connectors for the flow owner? | IT / Procurement |
| Q-17 | GAP-007 | Please enumerate the **sender types** used for template selection in SC-12. Proposed for review: `learner`, `manager`, `peer_trainer`, `hr`, `internal`, `external`, `system`. Is this the right set, and how should each be identified? | Business |

---

## C. Medium / low priority — refinements

| # | Gap | Question | Owner |
|---|---|---|---|
| Q-18 | GAP-011 | For SC-09 (dashboard/reporting): what distinguishes a **request for access** (→ change request) from a **technical fault** (→ FIT/FLO owner)? Please give two or three real examples of each. | Business |
| Q-19 | GAP-016 | Are all emails to this mailbox in **English**? If not, which languages must be supported? | Business |
| Q-20 | GAP-019 | For attachments: is it sufficient to **detect** that a screenshot is attached, or must the system **read** the screenshot (OCR) to extract the error message? The BRD only requires detection. | Business |
| Q-21 | GAP-020 | Should processing run **continuously**, including weekends and holidays, or only during business hours? | Business |
| Q-22 | — | For SC-07 (Schoox/MEC) and SC-10 (content), the BRD does not say an automated response is sent. **Should an acknowledgement be sent?** Currently no response is sent for these two scenarios, because Rule 14 requires explicit permission. | Business |
| Q-23 | — | Should the sender receive **any acknowledgement** when their email is escalated to human review, or does silence risk them chasing? | Business |
| Q-24 | — | Are there any **VIP or exception senders** whose mail must always go to a human regardless of classification? | Business |
| Q-25 | — | Confidence thresholds are seeded at 0.90 / 0.75 per the BRD. Who owns tuning them after the pilot, and through which surface (Dataverse `Configuration` table)? | Business + Product |
| Q-26 | AD-013 | The Decision Service is implemented in **TypeScript on Azure Functions** because the .NET SDK was unavailable in the build environment. If PepsiCo engineering standards mandate **C#/.NET**, please confirm and the port will be scheduled — the architecture is unchanged. | Architecture |

---

## D. Answer log

Record answers here as they arrive; each answer must also update the relevant configuration file
and close its gap in `docs/requirements-analysis.md` §15.

| # | Answer | Answered by | Date | Config updated | Gap closed |
|---|---|---|---|---|---|
| | | | | | |
