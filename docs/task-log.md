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

## ▶ RESUME HERE — current position (2026-07-17, session 1)

- **Task 1.1 schema is AUTHORED and compile-verified** (`db/schema.cds` + 3
  `.hdbindex`), but its deploy-verification leg is SURFACED: the shared
  `hana-free` instance is STOPPED and the agent's permission layer denied the
  start command. **One human action unblocks it** — start the HANA Cloud
  instance ("SAP Data Governance" in cockpit, or
  `cf update-service "SAP Data Governance" -c '{"data":{"serviceStopped":false}}'`),
  then the agent re-runs: delete failed instance
  `E-commerce_Customer_Courier_Email-db` → create-service →
  `cds deploy --to hana:E-commerce_Customer_Courier_Email-db` → duplicate
  (vbeln,exidv) insert must be rejected → flip 1.1 to DONE.
- **0.5 agent leg done:** `xs-security.json` carries the doc 10 §1.2 scopes,
  `werks` attribute, and 4 role templates. **1.3 done:** courier-srv skeleton
  with S7 green (offline vs real xssec). **Next agent-doable task:** 1.4
  (failing S1–S4 tests + re-enable lint/CodeQL now that `srv/` has code).
- **Blocked (human, critical path):** Open Items #2/#3/#4 (SAP SE16/XK03/OX10
  lookups), NZ Post sandbox (0.4), FedEx onboarding (0.2), BrowserPrint spike
  (0.1). See `12-Courier-Open-Items.md` and `02-Project-Plan.md`.
- **Environment gotchas:** the free `hana-free` HANA Cloud auto-stops when idle —
  restart it before any deploy or DB test (start = safe for the co-located Data
  Governance app; agent permission layer blocks `cf update-service`, so this is
  a human step). `ruflo` is DROPPED for now (security review not done, doc 14
  §1.2 rule 1) — this log is the only cross-session memory.

---

## 1.3 — DONE: courier-srv skeleton (auth chain, plant-scoped repo, PII-scrubbed errors)
_2026-07-17, session 1_

Iterations: 1
Tools used: ponytail (stdlib-first: node:test runner, node:crypto-signed test
JWTs — zero new dependencies), cds-mcp (bootstrap idiom), @sap/xssec v4 source
read for ground truth (createSecurityContext / checkLocalScope /
xsUserAttributes / JWKS fetch path).
What changed: `srv/server.js` (bootstrap wiring: auth app-wide, error handler
last), `srv/middleware/auth.js` (validate → scope → plants; 401 before any
claim read; fail-closed when no XSUAA bound; exact-shape /webhook/:carrier
carve-out so path tricks can't widen the public surface),
`srv/middleware/errors.js` (S9 scrubbing: err.message dropped, ids + stack
frames only), `srv/lib/repository.js` (doc 09 §3 — the only Shipments query
path, requires the plants list, fail closed), `test/s7-auth.test.js`,
`test/errors-scrub.test.js`, `test/repository-guard.test.js`,
`package.json` (test script: `node --test`).
Verification: **11/11 tests green** — S7 offline against REAL xssec
validation (JWKS fetch intercepted in-process; RS256 test keys): no token /
expired / tampered / forged / wrong-audience → 401 before handler logic;
valid token → handler with plants from the token attribute only; missing
scope → 403; webhook carve-out public; path-trick paths → 401. S9 smoke: no
name/email/address in captured log. `cds build` green. Live boot check:
`cds serve` starts, logs fail-closed warning, `/deliveries` → 401 with no
XSUAA bound. NOTE: S7 against real XSUAA tokens is the M2 gate — re-verify
once xsuaa instance is bound (same human unblock as 1.1's deploy leg).

---

## 0.5 (partial) — agent leg DONE: xs-security.json scopes + role templates
_2026-07-17, session 1_

Iterations: 1
Tools used: ponytail (active — matrix copied, nothing invented), python json.tool, cds build.
What changed: `xs-security.json` — 8 scopes (view, rate, book, print, reprint,
void, override, config), `werks` attribute (static per role instance, never
IdP), 4 role templates (Dispatcher, Supervisor, Support, SysAdmin) exactly per
doc 10 §1.2. **No SuperUser template on purpose** — it carries no app scopes
(SoD: role assignment via cockpit only). `xsappname` here is a base value;
mta.yaml's config overrides it at deploy (`-${org}-${space}`).
Verification: JSON valid; `cds build` still green. NOT yet verified against a
real XSUAA instance (service creation is the human-gated remainder of 0.5,
same HANA-start session works for both).
Remaining 0.5 (human/agent once BTP actions possible): create/bind xsuaa +
other service instances, destinations (NZPOST_SANDBOX, GRAPH), Cloud
Connector, first `cf deploy`.

---

## 1.1 — SURFACED (schema landed; deploy-verification leg blocked)
_2026-07-17, session 1_

Iterations: 1
Tools used: superpower (plan), ponytail (simplicity gate — confirmed scope:
entities + indexes only; purge job deferred to 1.14 as designed), cds-mcp
(`search_docs`: `@assert.unique` → DB-level DDL constraint confirmed; native
index artifacts), cds-dk 9.9.3, cf CLI 8.7.4.
What changed: `db/schema.cds` (all 10 entities per doc 09 §2, verbatim),
`db/src/courier_Shipments_{tracking_number,vbeln,werks_status}.hdbindex`
(secondary indexes per doc 09), `docs/02-Project-Plan.md` status flips, this
entry.
Verification: `cds build` green (CI parity) and `cds build --production`
generates all HDI artifacts. **S4 evidence:** compiler emits
`UNIQUE INVERTED INDEX courier_Shipments_doubleBooking ON courier_Shipments
(vbeln, exidv)` — the double-booking guard is database-level, and
`courier_ShipmentEvents_event` covers the S6 dedupe. Reserved-word check:
`before`/`at` columns auto-quoted by the compiler. NOT yet exercised: live
duplicate-insert rejection on HANA (the DONE criterion's deploy leg).
Classification: (c) environment/permission. `cf create-service hana hdi-shared
E-commerce_Customer_Courier_Email-db` failed — "HANA Database instance is
stopped" (JDBC 1890); the start command (`cf update-service "SAP Data
Governance" …serviceStopped:false`) was denied by the agent permission layer
(state change on the shared live instance). The failed service instance is
left in place for cleanup on retry.
Recommendation: human starts the HANA instance, then any agent session
finishes the verification per the RESUME block above and flips 1.1 to DONE.

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
