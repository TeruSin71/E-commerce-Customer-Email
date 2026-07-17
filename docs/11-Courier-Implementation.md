# 11 — Courier Booking: Implementation Plan

> **Prereq:** 07, 08, 09, 10. Open items in 12 — check BLOCKING flags before starting a phase.
> **Agent rules:**
> 1. Work strictly in task order within a phase. Do not start a task whose dependencies are unmet.
> 2. Every task lists its DONE criteria. A task is not complete until they pass.
> 3. Security tests S1–S4 are written BEFORE their implementation tasks (test-first).
> 4. If an Open Item blocks a task, STOP and surface it — do not guess the answer.

---

## Phase 0 — Spikes & unblocking (parallel, week 1)

| # | Task | DONE when | Blocks |
|---|---|---|---|
| 0.1 | **BrowserPrint-in-Work-Zone spike.** Minimal Fiori app in Work Zone iframe on a locked-down corporate PC posts ZPL to localhost BrowserPrint → label prints. | Physical label in hand, from inside the shell. | ALL UI printing work |
| 0.2 | **FedEx onboarding paperwork started** (OAuth app + label certification). | Application submitted. (Weeks of waiting — start now.) | Phase 2 |
| 0.3 | **Resolve Open Items #2, #3, #4** (contract source, ADR6 filter, plant address) — SE16/XK03 lookups. | Answers recorded in 12-Open-Items. | 1.4, 1.6 |
| 0.4 | **NZ Post API sandbox access** + one real rate call with the real contract account. | Sandbox rate response matching contract pricing, saved as fixture. | 1.8 |
| 0.5 | BTP plumbing: CF space, HANA HDI container, XSUAA service + xs-security.json skeleton, destination service entries (NZPOST_SANDBOX, GRAPH), Cloud Connector to ECC dev. | `cf push` of hello-world succeeds; destination reachable. | everything |

## Phase 1 — NZ domestic, NZ Post, end-to-end

**Scope guard: NZ only. Domestic only. No customs. Single carrier.**

| # | Task | Depends | DONE when |
|---|---|---|---|
| 1.1 | HANA schema (CDS) per 09 (all entities incl. AuditLog, SlaThresholds, purge job scaffold). | 0.5 | Migrations run; constraints verified (unique (vbeln,exidv) rejects duplicate insert). |
| 1.2 | ECC: build 3 CDS views per 08 §4 + Gateway OData. Technical user authorized ONLY for these (S12). | 0.3 | OData returns a real packed test delivery with HU weight/dims, ship-to, email, SO no. |
| 1.3 | courier-srv skeleton: xssec middleware (validate → scope → plants), plant-scoped repository (09 §3), error middleware with PII scrubbing (S9). | 0.5 | S7 tests pass. Forged/expired token → 401 on every route. |
| 1.4 | **Write failing tests S1–S4.** | 1.1, 1.3 | Four red tests in CI. |
| 1.5 | `/deliveries`: proxy ZC_CourierDelivery, plant-filtered from token. | 1.2, 1.3 | Worklist returns test DO; wrong-plant token → empty/403. |
| 1.6 | Provider interface + `providers/nzpost.ts` + router table lookup. Destination-only URLs (S1). Contract cache with FAIL-CLOSED on miss. | 0.3, 0.4 | S1 green. Rate for real fixture matches contract price. Missing contract → error, never list rate. |
| 1.7 | `/rates`. | 1.5, 1.6 | Options returned for test DO using real VEKP weight. |
| 1.8 | `/book`: idempotent (S4), label bytes downloaded + stored (S2), order-of-operations per 08 §6, multi-HU rows. | 1.4, 1.7 | S2, S4 green. Concurrent double-book test: one carrier call. |
| 1.9 | `/label/:id` + `/reprint`, authenticated + plant-checked. | 1.8 | S2, S3 (label leg) green. |
| 1.10 | `/shipments` lookup + `/dashboard` counts — through the plant-scoped repository only. | 1.8 | S3 green across all read paths. |
| 1.11 | `/void` + audit_log writes for void/override/config (S8). Append-only DB grants. | 1.8 | S8 green. |
| 1.12 | `/webhook/nzpost`: HMAC (constant-time), timestamp ±5min, 256KB cap, rate limit, dedupe insert, 200-fast, bounded async worker, fail-closed status map (S5, S6). | 1.8 | S5, S6 green. Real sandbox webhook processed end-to-end. |
| 1.13 | Email on first pickup: Graph client-credentials, DO-level atomic claim (UPDATE..WHERE sent=false), SO number + tracking link, never DO no., carrier strings escaped (S11). Bounce logging. | 1.12 | One email exactly, on sandbox pickup event; race test (3 concurrent events) sends one. |
| 1.14 | Nightly fallback poller (silent-webhook catch) + purge job with configurable retention (S10). | 1.12 | S10 green with backdated fixtures. |
| 1.15 | Fiori Courier Dispatch: worklist → rate cards → book → print via BrowserPrint (per 0.1 findings), reprint, plant switcher (narrow-only). Single-HU streamlined; multi-HU shows HU list + per-label status. | 0.1, 1.9 | A test parcel booked and physically printed from Work Zone in <30s of clicks. |
| 1.16 | Fiori Shipment Lookup tile (search vbeln/tracking/SO → status, events, reprint) + Dashboard tile (counts per state). | 1.10 | Support flow works; cross-plant search returns nothing. |
| 1.17 | Work Zone content: 4 tiles wired to role collections; SoD verified (SuperUser has no book/config). | 1.15, 1.16 | Tile visibility matches role matrix in 10 §1.2. |
| 1.18 | **Go-live gate:** S1–S10 green, S11–S14 evidenced, HANA Cloud backup/restore tested, rotation runbook (S14) written. | all | Checklist signed off. NZ domestic LIVE. |

## Phase 2 — Carrier expansion

- 2.1 `providers/fedex.ts` (OAuth2 token refresh; label certification from 0.2). Covers AU/US/CA international lanes later.
- 2.2 Remaining carriers one at a time (PostHaste, AusPost, CanPost, UPS), each: provider + destination + status_map + webhook verify + fixture tests. Interface is proven; each is config + one file.
- Per-carrier DONE: rate/book/void/webhook against sandbox; status_map covers observed vocab; unknown-status fail-closed re-verified.

## Phase 3 — Region rollout (AU → US → CA, order per business readiness)

Per region: carrier_accounts + routes rows, destinations, plant address verified (Open Item #4 per plant), sender email config, printers table, role collections assigned, regional UAT. **No new development expected** — if code changes are needed, that's a design gap to surface.

## Phase 3b — Invoice reconciliation (manual-first) 🔶 gated on Open Item #8 (Finance)

- 3b.1 Manual upload screen (Finance role) + NZ Post CSV parser: defensive parsing (S13), match on tracking → fill rate_billed → variance view on Dashboard, per company code.
- DONE: real invoice file uploaded, variance visible. ~2 weeks. Automation (mailbox/SFTP/API + other parsers) only in Phase 5, only if 3b sees real use.

## Phase 4 — International 🔶 gated on Open Items #1 (STAWN) and #7 (is it needed)

- customs_info block in providers (HS code, origin, declared value, incoterms) when plant.country ≠ dest.country; carrier-generated proforma printed with label; declared-value source per Open Item #5.

## Phase 5 — Automation & tuning

- Invoice ingestion automation (if 3b earned it); sla_thresholds from observed p95 (≥1 month of timestamps); bell notifications with cooldown; escalation ladder.

---

## Standing agent instructions

1. **Never weaken a security control to make a test pass.** If S-tests conflict with a feature, the feature design is wrong — surface it.
2. **Never write to SAP ECC.** If a task appears to need it, the task is misread or the design has a gap — stop and surface.
3. **Plant/scope checks are copied-in per route via middleware + repository — never "TODO later."** A route without both does not merge.
4. **Secrets:** never in code, env-committed files, the database, or logs. Destination service only.
5. **When an Open Item answer contradicts these docs, the answer wins — update the doc, then proceed.**
