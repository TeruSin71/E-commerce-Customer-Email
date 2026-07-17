# 02 — Courier Booking: Project Plan & Status

> **What this is:** the living execution tracker. It layers *current status* on top of the design docs — what's done, what's blocked, what to do next. For the detailed technical DONE-criteria of each Phase 1+ task, see `11-Courier-Implementation.md`; for the questions that gate work, see `12-Courier-Open-Items.md`.
>
> **How to use (agents & humans):** find the next ⬜ task whose dependencies are ✅ and whose gate is not 🔴, do it, flip its status, open a PR (see §G). Never start a 🔴 task — surface the blocker instead.

**Legend:** ✅ done · 🟡 partial / in progress · ⬜ not started · 🔴 blocked (needs a human answer or external lead-time) · 👤 human task · 🤖 agent-doable now

_Last updated: 2026-07-17._

---

## Status at a glance

| Phase | What | Status |
|---|---|---|
| **F. Foundation** | Repo, CI/CD gate, HANA decision, deploy descriptor, capacity | ✅ **done** |
| **0. Spikes & unblock** | BrowserPrint spike, carrier onboarding, SAP lookups, BTP plumbing | 🟡 partial (plumbing scaffolded; spikes/lookups open) |
| **1. NZ domestic E2E** | NZ Post, courier-srv, schema, Fiori, go-live gate | 🟡 started (1.1 schema authored; deploy-verify pending HANA start) |
| **2. Carrier expansion** | FedEx + 4 more behind provider interface | ⬜ gated on Phase 1 |
| **3. Region rollout** | AU → US → CA (config, no new dev) | ⬜ gated on Phase 1 |
| **3b. Invoice reconciliation** | Manual-first variance | 🔴 gated on Open Item #8 (Finance) |
| **4. International** | Customs / HS codes | 🔴 gated on Open Items #1, #7 |
| **5. Automation & tuning** | Invoice ingestion, SLA thresholds, notifications | ⬜ later |

**Critical-path reality:** the near-term blockers are all **human/external** — the SAP data lookups (Open Items #2/#3/#4), NZ Post sandbox access, FedEx onboarding lead-time, and the BrowserPrint hardware spike. The **agent track** (schema, courier-srv skeleton, security tests, Fiori shells) can proceed in parallel now and be verified once the plumbing is bound.

---

## F. Foundation — ✅ DONE (this workstream)

Not in doc 11; completed to make the project buildable, deployable, and safe for autonomous work.

| # | Item | Status | Notes |
|---|---|---|---|
| F1 | GitHub repo (private) + SSH auth | ✅ | `TeruSin71/E-commerce-Customer-Email`, pushes over SSH, no PAT |
| F2 | CI gate (`build` + `test`) on every PR | ✅ | `.github/workflows/ci.yml`; `cds build` + tests |
| F3 | Branch ruleset on `main` (un-bypassable) | ✅ | require PR + required checks + empty bypass + block force-push |
| F4 | Agent auto-push / auto-merge pipeline | ✅ | bot opens PR → auto-merge on green; proven E2E (PRs #7–#10) |
| F5 | Dependabot + PR template + CODEOWNERS | ✅ | stale major-bump PRs cleaned up |
| F6 | **DB decision: SAP HANA Cloud** (Postgres not entitled) | ✅ | `hana / hdi-shared` (free); docs reconciled to HANA |
| F7 | `mta.yaml` deployment descriptor | ✅ | modules: srv, db-deployer, app-deployer; services: xsuaa, hana, connectivity, destination, html5 |
| F8 | BTP capacity verified | ✅ | org `btpsandbox` / space `AI_Document`, 2.37 GB free of 4 GB |
| F9 | End-to-end process + architecture doc | ✅ | `docs/01-Courier-Process-and-Architecture.md` |
| — | lint + CodeQL checks | 🟡 deferred | re-enable once `srv/` has code (need eslint / JS to scan) |

---

## Phase 0 — Spikes & unblocking

| # | Task | Owner | Status | Gate / note |
|---|---|---|---|---|
| 0.1 | **BrowserPrint-in-Work-Zone spike** — ZPL from Work Zone iframe → localhost → Zebra prints | 👤 | ⬜ | Blocks ALL UI printing (1.15). Needs a locked-down corporate PC + printer |
| 0.2 | **FedEx onboarding** (OAuth app + label certification) | 👤 | ⬜ | Long lead-time — **start now**. Blocks Phase 2 |
| 0.3 | **Resolve Open Items #2, #3, #4** (contract source, ADR6 email filter, plant address) | 👤 | 🔴 | SE16/XK03/OX10 lookups. Blocks 1.2, 1.6 |
| 0.4 | **NZ Post API sandbox** + one real contract-priced rate call | 👤 | ⬜ | Blocks 1.6, 1.8. Save response as fixture |
| 0.5 | **BTP plumbing** — CF space, HANA HDI container, XSUAA + xs-security, destinations (NZPOST_SANDBOX, GRAPH), Cloud Connector to ECC | 👤/🤖 | 🟡 | CF space ✅, HANA available ✅, `mta.yaml` ✅, `xs-security.json` scopes+roles per doc 10 §1.2 ✅. **TODO:** HDI container ✅ created + schema deployed (2026-07-17); still open: xsuaa instance, destinations (NZPOST_SANDBOX, GRAPH), Cloud Connector, first `cf deploy` |

## Phase 1 — NZ domestic, NZ Post, end-to-end

**Scope guard: NZ only. Domestic only. No customs. Single carrier.** Full DONE-criteria in `11-Courier-Implementation.md`.

| # | Task | Depends | Owner | Status | Gate |
|---|---|---|---|---|---|
| 1.1 | **HANA schema (CDS)** per doc 09 — all entities, `@assert.unique` guards, purge scaffold | 0.5 | 🤖 | ✅ *(deployed to HDI; duplicate (vbeln,exidv) rejected on live HANA; all indexes verified)* | — |
| 1.2 | ECC: 3 CDS views + Gateway OData; technical user scoped (S12) | 0.3 | 👤 | 🔴 | Open Items #3, #4 |
| 1.3 | **courier-srv skeleton** — xssec middleware (validate→scope→plants), plant-scoped repository, PII-scrubbing error middleware | 0.5 | 🤖 | ✅ *(S7 tests green offline vs real xssec; fail-closed boot verified)* | re-verify S7 on real tokens once xsuaa bound (M2) |
| 1.4 | **Write failing tests S1–S4** (test-first) | 1.1, 1.3 | 🤖 | ✅ *(4 red todo-tests in CI; lint+CodeQL re-enabled)* | ruleset add of lint/CodeQL as REQUIRED checks needs repo admin |
| 1.5 | `/deliveries` worklist proxy, plant-filtered | 1.2, 1.3 | 🤖 | 🟡 *(DONE on synthetic ECC fixture; re-verify + fixture removal when 1.2 lands)* | real-ECC re-verify gates M3 |
| 1.6 | Provider interface + `providers/nzpost.ts` + router table; destination-only URLs (S1); fail-closed contract cache | 0.3, 0.4 | 🤖 | 🟡 *(1.6a done: interface + S1 guard GREEN + router + mock carrier; 1.6b nzpost gated)* | 1.6b: Open Item #2 + NZ Post sandbox (0.4) |
| 1.7 | `/rates` | 1.5, 1.6 | 🤖 | 🟡 *(DONE on mock carrier + synthetic ECC; re-verify at 1.2/1.6b)* | |
| 1.8 | `/book` — idempotent (S4), store label bytes (S2), multi-HU | 1.4, 1.7 | 🤖 | 🟡 *(DONE on mock carrier; S4 GREEN + gating; re-verify at 1.6b)* | |
| 1.9 | `/label/:id` + `/reprint`, auth + plant-checked | 1.8 | 🤖 | ✅ *(S2 GREEN + gating; label bytes streamed, never a URL)* | |
| 1.10 | `/shipments` + `/dashboard` via plant-scoped repo only | 1.8 | 🤖 | ✅ *(S3 GREEN + gating; all S1–S4 green)* | |
| 1.11 | `/void` + audit_log; append-only grants (S8) | 1.8 | 🤖 | ✅ *(S8 GREEN; append-only audit; DB grant = .hdbrole at go-live)* | |
| 1.12 | `/webhook/nzpost` — HMAC, timestamp window, cap, rate-limit, dedupe, fast-200, fail-closed status map (S5, S6) | 1.8 | 🤖 | 🟡 *(DONE on mock carrier; S5+S6 GREEN + gating; secret = env placeholder → destination at 1.6b)* | real NZ Post HMAC scheme at 1.6b |
| 1.13 | Email on first pickup — Graph, atomic DO-level claim, SO no. + tracking, escaped strings (S11) | 1.12 | 🤖 | 🔴 | Open Item #6 (avoid duplicate customer comms) |
| 1.14 | Nightly fallback poller + purge job (configurable retention, S10) | 1.12 | 🤖 | ✅ *(S10 GREEN with backdated fixtures; CF Job Scheduler calls srv/jobs-run.js)* | window = Open Item #11 (default 730d; job built regardless) |
| 1.15 | Fiori Courier Dispatch — worklist→rate→book→print (BrowserPrint), plant switcher | 0.1, 1.9 | 🤖 | 🔴 | Open Item 0.1 (spike) |
| 1.16 | Fiori Shipment Lookup + Dashboard tiles | 1.10 | 🤖 | ✅ *(FE List Report/Object Page over new read-only OData `LookupService`; S3 re-proven on OData path; dashboard page over /dashboard; Work Zone wiring = 1.17)* | |
| 1.17 | Work Zone content — 4 tiles wired to role collections; SoD verified | 1.15, 1.16 | 🤖 | ⬜ | |
| 1.18 | **Go-live gate** — S1–S10 green, S11–S14 evidenced, HANA backup/restore tested, rotation runbook | all | 👤/🤖 | ⬜ | ⚠ free `hana-free` has no DR SLA → paid HANA plan before prod |

## Phase 2 — Carrier expansion
`providers/fedex.ts` (from 0.2), then PostHaste / AusPost / CanPost / UPS one at a time (provider + destination + status_map + webhook + fixtures). Interface proven in 1.6 → each is config + one file. Gate: Open Item #12 (webhook vs polling per carrier).

## Phase 3 — Region rollout (AU → US → CA)
Config-only per region: `carrier_accounts` + `routes` rows, destinations, plant address (Open Item #4 per plant), sender email, printers, role collections, regional UAT. **No new dev expected** — if code is needed, that's a design gap to surface. Sequencing gate: Open Item #13 (volumes).

## Phase 3b — Invoice reconciliation (manual-first) 🔴
Gated on **Open Item #8 (Finance)**. Manual upload + NZ Post CSV parser (S13) → match on tracking → variance view. ~2 weeks. Automation only in Phase 5 if this earns it.

## Phase 4 — International 🔴
Gated on **Open Items #1 (STAWN/HS codes) and #7 (needed at all?)**. `customs_info` in providers when plant.country ≠ dest.country; declared value per Open Item #5.

## Phase 5 — Automation & tuning
Invoice ingestion automation (if 3b earned it); `sla_thresholds` from observed p95 (≥1 month of data); bell notifications + escalation.

---

## Immediate next steps

**🤖 Agent track — can start now (no open items blocking):**
1. **1.1 — author `db/schema.cds`** from doc 09 (the CDS entities). Compiles in CI; deploy waits on the HDI container.
2. **0.5 (partial) — flesh out `xs-security.json`** with the scopes + role templates from doc 10 (§1.2 role matrix).
3. **1.3 — scaffold `courier-srv`**: the xssec middleware chain (validate → scope → plants) + the single plant-scoped repository module (doc 09 §3) + PII-scrubbing error middleware.
4. **1.4 — write the failing S1–S4 tests** (test-first), and re-enable **lint + CodeQL** as required checks now that `srv/` has code.

**👤 Human track — unblock the critical path (each is a short lookup or a lead-time start):**
1. **Open Items #2, #3, #4** — SE16/XK03/OX10 in SAP (contract account, ADR6 email filter, plant dock address). *These block the ECC integration — highest leverage.*
2. **NZ Post sandbox** access + one contract-priced rate call (Open Item / 0.4).
3. **FedEx onboarding** (0.2) — start the paperwork; it's weeks of waiting.
4. **BrowserPrint spike** (0.1) — one afternoon on a locked-down PC with a Zebra printer.
5. **Open Item #8 (Finance)** and **#6 (does e-commerce already email customers?)** — interviews.

---

## Open items / blockers (owner view — full detail in doc 12)

| # | Blocker | Owner | Blocks | Status |
|---|---|---|---|---|
| 2 | Carrier contract/account source in SAP | 👤 SAP | 1.6 | ❌ open |
| 3 | ADR6 email selection for CPD addresses | 👤 SAP | 1.2 (wrong ⇒ zero emails) | ❌ open |
| 4 | Plant dispatch address (dock vs office) | 👤 SAP/warehouse | 1.2, Phase 3 | ❌ open |
| 6 | Does e-commerce already send tracking emails? | 👤 e-comm | 1.13 | ❌ open |
| 8 | Finance invoice/reconciliation process | 👤 Finance (Teru checking) | Phase 3b | ❌ open |
| 11 | PII retention window (≈24 mo?) | 👤 Legal/Finance | 1.14 config (job built regardless) | ❌ open |
| 1, 5, 7 | International: HS codes, declared value, needed at all | 👤 business/SAP | Phase 4 | ❌ open |
| 12, 13 | Carrier webhook-vs-poll; regional volumes | 👤 business/carriers | Phase 2, sequencing | ❌ open |
| 9, 10 | Per-plant permissions / Entra werks attribute | — | Security | ✅ closed |

---

## Milestones

| M | Milestone | Depends on | Gate |
|---|---|---|---|
| **M0** | Foundation ready (repo, gate, deploy descriptor) | — | ✅ **reached** |
| **M1** | BTP plumbing bound + hello-world deployed | 0.5 | first `cf deploy` green |
| **M2** | Security spine live (schema + courier-srv + S1–S4 red→green) | 1.1, 1.3, 1.4 | S1–S4 pass on real tokens |
| **M3** | NZ book+print works end-to-end | 1.5–1.9 + 0.1 | test parcel printed from Work Zone < 30 s |
| **M4** | NZ webhook + email + monitoring | 1.12–1.14 | one email on real sandbox pickup |
| **M5** | **NZ domestic LIVE** (go-live gate) | 1.18 | S1–S10 green, S11–S14 evidenced, paid HANA plan, DR tested |
| **M6+** | Carrier #2 (FedEx) → region #2 (AU) → invoice recon | Phase 2/3/3b | per-phase gates |

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| ECC lookups (#2/#3/#4) stay open | Phase 1 ECC integration blocked | Chase early — they're the critical path; agent works other tasks meanwhile |
| Free `hana-free` auto-stops / no DR | Dev friction; **not prod-safe** | Restart before tests; **paid HANA plan required before M5** |
| BrowserPrint blocked by corp PC lockdown | No label printing | 0.1 spike de-risks *before* UI build; fallback = server-side PDF |
| FedEx certification lead-time | Delays Phase 2 | Start 0.2 paperwork immediately |
| Shared `AI_Document` space (no isolation) | Courier sits beside live Data Governance app | Acceptable for sandbox; separate subaccount/space for prod |
| Agent weakens its own CI (Option B) | Gate could be loosened | Git history + revert + merge notifications; re-add CODEOWNERS gate if needed |

---

## G. Ways of working

1. **All changes reach `main` via a PR** — direct push is blocked. Branch → commit → PR → auto-merge on green (`build` + `test`). See `CONTRIBUTING.md`.
2. **Security controls are non-negotiable.** Never weaken an S-control to pass a test (doc 11 standing rules). Plant + scope checks on every parcel-data route — via middleware + the one plant-scoped repository, never "TODO later".
3. **ECC is read-only. Ever.** Secrets live in the BTP Destination service only — never code, config, the database, or logs.
4. **Open Items gate tasks.** If a gating item is unanswered, STOP and surface it — never guess. When an answer contradicts a doc, the answer wins — update the doc in the same commit.
5. **Verify before "done."** Run the build/tests or exercise the flow; report results faithfully.
