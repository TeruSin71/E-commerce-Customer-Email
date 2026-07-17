# Courier Booking — Task Log (session-to-session handover)

> **Read this FIRST when resuming work.** It is the running journal of what each
> agent session did and where things stand — the authoritative handover between
> sessions (`14-Courier-Agent-Protocol.md` §1.3, §2.2, §4).
>
> **How to use:** at session start, read this to resume at the first non-DONE
> item. At the end of every completed or surfaced task, append an entry (format
> in doc 14 §2.2). Newest session on top. Full plan/status → `02-Project-Plan.md`;
> task order + DONE criteria → `11-Courier-Implementation.md`.

---

## ▶ RESUME HERE — current position (2026-07-17)

- **Milestone M0 (Foundation) reached.** Repo, CI/CD gate, HANA decision, deploy
  descriptor, and governance docs are all merged to `main`.
- **No doc-11 task has been executed yet** — everything so far is foundation /
  governance, not a numbered task.
- **Next agent-doable task → `1.1`:** author `db/schema.cds` from `09-...` (the
  CDS entities). No open items block it; it unblocks milestone M2. Then, in the
  agent track: 0.5 (fill `xs-security.json` scopes/roles), 1.3 (courier-srv
  skeleton), 1.4 (failing S1–S4 tests + re-enable lint/CodeQL once `srv/` exists).
- **Blocked (human, critical path):** Open Items #2/#3/#4 (SAP SE16/XK03/OX10
  lookups), NZ Post sandbox (0.4), FedEx onboarding (0.2), BrowserPrint spike
  (0.1). See `12-Courier-Open-Items.md` and `02-Project-Plan.md`.
- **Environment gotcha:** the free `hana-free` HANA Cloud auto-stops when idle —
  restart it before any deploy or DB test.

---

## Session 0 — Foundation & Governance — DONE
_2026-07-17_

Not doc-11 tasks; the groundwork that makes the project buildable, deployable,
and safe for autonomous agents. All landed on `main` via the gated PR flow
(PRs #7–#13).

**What was set up:**

- **Repo + auth.** Private `TeruSin71/E-commerce-Customer-Email`; pushes over
  **SSH** (owner key — no PAT). A bot account `terusin-courier-bot` (+ its SSH key
  and a repo-scoped token at `~/.github_bot_token`) exists and is used for PR
  API calls, but is otherwise unprivileged.
- **CI/CD gate.** `.github/workflows/ci.yml` = **`build`** (`cds build` via global
  `@sap/cds-dk`) + **`test`** (`npm run test --if-present`). Branch **ruleset on
  `main`**: require PR + required checks (`build`,`test`) + **empty bypass** +
  block force-push. Agents land changes via **branch → PR → auto-merge** on green.
  **Option B** chosen: fully autonomous, owner-scoped token for PR API; `.github/**`
  is NOT owner-gated (relies on history/revert). Proven end-to-end. **lint +
  CodeQL deferred** until `srv/` has code (empty scaffold has nothing to lint/scan).
- **DB decision — SAP HANA Cloud.** PostgreSQL is **not entitled** in `btpsandbox`;
  HANA Cloud (`hana-free`) + `hana/hdi-shared` are **free/available** and CAP-native
  (`@cap-js/hana`). Docs reconciled Postgres→HANA; `09-Courier-Data-Model.md`
  rewritten as **CDS entities**.
- **Deploy descriptor.** `mta.yaml` scaffolded via `cds add` — modules: `srv`,
  `db-deployer`, `app-deployer`; services: `xsuaa`, `hana` (hdi-shared),
  `connectivity`, `destination`, `html5-apps-repo`. BTP capacity confirmed: org
  `btpsandbox` / space `AI_Document`, **~2.37 GB free of 4 GB** (shared with a
  live SAP Data Governance app). Deploy target: region **ap10**.
- **Governance / onboarding docs.** `01-Courier-Process-and-Architecture.md`
  (10-step flow + architecture, Mermaid); `02-Project-Plan.md` (living status);
  **`CLAUDE.md`** (auto-loaded every session — forces reading `00-INDEX` + `14`
  and binds the non-negotiables); `14-Courier-Agent-Protocol.md` updated to the
  real tooling (`cds-mcp`, `fiori-mcp`, `ui5-mcp`, `snyk` + skills) and the gated
  PR loop; `CONTRIBUTING.md`; this `task-log.md`.

**Verification:** every change passed `build`+`test` and auto-merged; a direct
push to `main` was confirmed **rejected** by the ruleset (GH013).

**Notes / follow-ups surfaced:**
- Stale Dependabot major-bump PRs (@sap/cds 10, @cap-js/* 3, actions v7) were
  **closed** — not adopting now.
- `ruflo` kept **memory-only** (doc 14 §1.2); Claude Code file-memory is the
  practical cross-session store, with this log authoritative for task state.
- A production go-live needs a **paid HANA Cloud plan** (free tier has no DR SLA).

---

<!-- Append future task entries above this line, newest first, per doc 14 §2.2:
## [task id] — [DONE | SURFACED]
Iterations: N
Tools used: [...]
What changed: [files]
Verification: [tests run, results]
(if SURFACED) Classification + diagnosis + recommendation
-->
