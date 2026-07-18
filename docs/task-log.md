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

## Subaccount ops (no doc-11 id) — Work Zone cross-site tile bleed root-caused + FIXED; 1.17a dashboard bug formally CLOSED
_2026-07-18, session 5 (agent investigation + btp CLI; cockpit/Work Zone clicks by Teru)_

Iterations: 3 dead ends before the fix, all worth recording:
(1) removing DG spaces from the Everyone role alone → DG site died with
"Cannot find a space assigned to you" (no user held the new role yet) — recovered
by re-adding; (2) per-site exclusion impossible — **Everyone's toggle is LOCKED ON
for every site** in a site's Role Assignments; (3) role-collection **file import:
the cockpit has NO Import button** (export only, checked on this Free Tier
subaccount) — btp CLI is the maintenance path.
Tools used: cf CLI read-only (`cf mtas`, `cf html5-list` — proved the 3 tiles are
DG apps `govauthfields|govauthmatrix|govauthrouting` on the DG app-host), btp CLI
under Teru's SSO (assign + read-back), SAP docs (local Work Zone roles auto-create
a matching role collection).
What changed (repo): docs/13 §3a (role-collection export/CLI runbook — the
"how to update a collection manually" note), docs/02 1.17 row (dashboard bug →
RESOLVED), resolved-pointer on the SURFACED entry below, this entry.
What changed (subaccount, executed by Teru + agent CLI):
- Work Zone role "Customer Data Governance" created (Content Manager) carrying
  the 4 DG spaces + apps; toggled ON for the DG site.
- Role collections `Customer_Data_Governance` (underscores — auto-created,
  matches the WZ role id, almost certainly the linked one) AND the manually
  created duplicate `Customer Data Governance` both assigned to
  terulin.sinulingga@gallagher.com via `btp assign security/role-collection …
  --of-idp sap.custom` (both assigned to be safe; Benson deliberately excluded
  at Teru's request). Read-back verified via `btp get security/user`.
- The 4 DG spaces (CDS Explorer, Authorization Process Flow, Customers Data
  Governence, Inbox) REMOVED from `sap_subaccount_everyone`.
Verification (Teru, fresh incognito): DG site renders all 4 spaces via the new
role; **Pricing Systemization AND the courier E-commerce Order Tracking site no
longer show DG tiles**; courier tiles intact.
Root cause for the record: the DG content sat on the built-in **Everyone** role
("visible to all users") — content on Everyone renders on EVERY site in the
subaccount, unavoidably. NOT related: the cockpit "2 Configuration issues"
(DG's `srv-api`/`customerdatagovernance_uaa` sharing
`sap.cloud.service=customerdatagovernance`) — that is a separate DG-internal
destination duplicate, investigated, still present, not ours to fix.
**1.17a dashboard closure (was SURFACED below as an open bug):** RESOLVED
2026-07-18 — the stale layer was the Work Zone CONTENT PROVIDER pinning the app
version at sync time; an applicationVersion bump + `cf deploy` does NOT
propagate until the provider is re-synced. Teru re-synced the "Ecommerce"
provider (Channel Manager → 🔄) and the v0.0.3 fixes (OData-model dashboard
load + HashChanger routing — which were correct all along) took effect
immediately. Deploy checklist for every UI change: bump `applicationVersion` →
`cf deploy` → **re-sync the content provider** → verify in fresh incognito
with F12 open.

---

## 1.17a — SURFACED (open bug): Courier Dashboard tile loads no data — unresolved after 3 fixes
> **RESOLVED 2026-07-18 — see the session-5 entry above.** Root cause was the
> Work Zone content provider serving a stale pinned app version (re-sync fixed
> it); the v0.0.3 code below was correct. Kept unedited as the honest record.

_2026-07-18, session 4 wrap. **READ THIS BEFORE TOUCHING THE DASHBOARD.**_

State at session end (per Teru's live testing, PRs #44–#46 all merged+deployed):
- **Shipment Lookup tile: fully working** on a real user (renders, filters, plant-
  scoped, empty-DB pass). M2 stays CLOSED — this bug does not touch the spine.
- **Dashboard tile: routing FIXED, data load STILL FAILING.** Journey:
  (1) v1 `window.location.hash` append — REVERTED silently by the Work Zone shell
      (the sap-no-location-usage lint rule that warned about exactly this was
      right; suppressed it, learned the lesson).
  (2) v2 `HashChanger.replaceHash` + version bump 0.0.2 — routing WORKS (verified
      in incognito: own page, title, counts table). Discovered live: raw
      `fetch("/dashboard")` dies at the launchpad root — the managed approuter
      routes ONLY manifest-declared dataSource requests (1.16 review predicted
      this; xs-app.json routes do NOT rescue host-absolute fetches).
  (3) v0.0.3 — dashboard rewritten onto the app's own OData V4 model
      (`bindList('/Shipments', {$select: werks,status})` + client-side groupby,
      Reprint REST paths made shell-aware via `sap.ui.require.toUrl`). Deployed,
      bundle-verified. **Teru reports STILL not solved.**
- **Unknown:** the actual failing request/error. All three fixes were built
  without browser evidence. Classification (c)-ish: environment behavior only
  observable client-side.
- **NEXT SESSION, FIRST MOVE — get evidence before more fixes:** Teru opens the
  dashboard tile in a FRESH incognito window (v0.0.3 must show in cockpit HTML5
  Applications: Active Version 0.0.3), then F12 → Network tab → reload → capture
  (a) which request fails (URL + status) and (b) Console errors. Suspects, in
  order: stale 0.0.2 bundle still served to their session; FPM PageController /
  getAppComponent().getModel() undefined on the custom page (would hit the catch
  → error strip); OData $batch from the dashboard page failing differently than
  the FE list. Do NOT ship fix #4 blind.
- Also unresolved from testing: normal-Chrome profile clings to cached old
  bundles well past hard refresh — advise Empty Cache & Hard Reload or new
  profile when verifying deploys; incognito is the reliable check.

---

## 1.17a — COMPLETE (both tiles LIVE, lookup verified; dashboard caveat above) + M2 CLOSED: S7/S3 evidenced on a real user token in Work Zone
_2026-07-18, session 3/4 — the click-through_

**End state, verified by Teru in the browser:** the E-commerce Order Tracking
site shows the Courier Shipments group with BOTH tiles; Shipment Lookup renders
the full FE List Report (all annotation-driven filters + columns) and returns
"No results found" on live HANA — real CIS token validated (S7), view scope
passed, werks=1000 plant filter applied (S3), OData V4 against the deployed
DB. Empty-because-no-bookings is the correct pass state. Courier Dashboard
tile present. **M2 (security spine on real tokens) is CLOSED; 1.16's
re-verify tag cleared for the UI leg.**
How the last mile landed (for future regions): cockpit Edit was unavailable /
import nonexistent — resolved via **btp CLI under Teru's SSO** (installed at
`~/.local/bin/btp`, login `btp login --sso manual`):
- `btp create security/role Courier_Dispatcher_NZ --of-app <xsappname!t89472>
  --of-role-template CourierDispatcher --attributes werks.json` (static
  ["1000"] — the CLI is the ONLY self-service path that carries attributes)
- `btp add security/role ... --to-role-collection Courier_Dispatcher_NZ`
- `btp assign security/role-collection <rc> --to-user <mail> --of-idp
  sap.custom` ×4 (both collections × Teru + Benson; sap.custom = the CIS
  origin — NEVER sap.default, confirmed via collection export)
- read-back: `btp get security/user <mail> --of-idp sap.custom`
An xsuaa `apiaccess` instance (courier-xsuaa-api) was also created: its
client token can manage role COLLECTIONS but NOT roles/users (403s) — btp CLI
under a user is the working automation for those. **Phase 3 note: the ~16
remaining regional collections are now a scripted loop, not cockpit work.**
Still open in 1.17: dispatch + config tiles (gated on 0.1 BrowserPrint / 1.15).
Lookup stays empty until real bookings exist — /book on the DEPLOYED app needs
the real NZ Post provider (1.6b; MOCK is dev/test-only by design, S1 guard).

---

## 1.17a — DONE (agent half): Work Zone content as code — CDM served live from the HTML5 repo
_2026-07-18, session 3 (PRs #39–#41 + this one; split blessed by Teru: lookup+dashboard
tiles now, dispatch tile stays gated on 0.1)_

Iterations: 2 (PR #40's edit adding the workzone-dest-content module FAILED silently —
the commit message claimed it, deploy-log verification caught zero trace; classification
(a), re-added in PR #41. Lesson: verify the built mtad, not the intent.)
Tools used: superpower, ponytail (rejected an html5-module restructure the research
proposed — the working upload path stays; adopted only additive pieces), research
Workflow (3 parallel researchers + synthesis; key finding: NO Work Zone CF service
needed — content ships via the HTML5 repo as a content provider, so cf marketplace
lacking SAPLaunchpad/build-workzone-standard is NOT a blocker), cf CLI, mtar inspection.
What changed: `app/workzone/CommonDataModel.json` (catalog + group + space/page + 3
roles dispatcher/supervisor/support — SysAdmin has no UI app), manifest.json
(+sap.cloud courier.service), `mta.yaml` (CDM → gen/app/cdm.json rides the
app-deployer upload; courier-html5-rt app-runtime + courier-html5-rt-key;
workzone-dest-content module → courier-cdm-dt design-time destination; srv-api
destination with HTML5.ForwardAuthToken from PR #39; courier-cdm-rt runtime
destination — subdomain `btpsandbox` confirmed by Teru from the live site URL).
Verification (live): deploy green; key + courier-cdm-dt created by the deployer;
**GET /applications/cdm/courier.service with the runtime service key → HTTP 200,
all entities** — the exact read Work Zone's Channel Manager performs. srv fail-closed
spot-check (401 no-token) still green.
**Remaining (👤 Teru, cockpit — the human half of 1.17a):**
1. Work Zone → Channel Manager → New content provider: design-time dest
   courier-cdm-dt, runtime dest courier-cdm-rt → sync.
2. Content Manager: add roles courier_dispatcher/supervisor/support to the
   E-commerce Order Tracking site; map each to its Courier_<Role>_NZ collection.
3. Role collections from the deployed templates (werks=1000) + assign to Teru's
   CIS user row (NOT sap.default — doc 13 gotcha).
Then: click the Shipment Lookup tile → the true role-gated E2E (auth → scope →
plant → OData → FE in Work Zone).

---

## 0.5 — DONE: first `cf deploy` GREEN — M1 reached, M2 auth chain evidenced on real tokens
_2026-07-17, session 3 (Teru provided SSO passcode; deploy + HANA start passed the permission gate this session)_

Iterations: 2 (first deploy attempt: db-binding failed ×3 retries — classification (c):
shared `hana-free` auto-stopped; probe service key surfaced `JDBC [1890]: HANA Database
instance is stopped`; started it via `cf update-service "SAP Data Governance"
serviceStopped:false` — ALLOWED this session, was denied in session 1 — ~3.5 min to
ready, then `cf deploy -a retry` → green.)
What ran: `cf login --sso-passcode` (org btpsandbox / space AI_Document),
`cf install-plugin multiapps`, fresh `mbt build`, `cf deploy` (+retry).
Created/bound: xsuaa `-auth`, connectivity, destination, html5-repo-host; srv +
db-deployer apps; Fiori app content in HTML5 repo. **srv live at
btpsandbox-ai-document-e-commerce-customer-courier-email-srv.cfapps.ap10.hana.ondemand.com
(web:1/1); db-deployer ran schema+CSV seeds onto live HANA then stopped (normal).**
Verification (M1 + M2 evidence, all against the LIVE deployment):
- Fail-closed: /deliveries /shipments /dashboard /odata/v4/lookup/Shipments all
  **401** with no token; forged token **401** (real JWKS validation).
- **/webhook/mock → 404 in production** — the synthetic-seam guard proven live:
  MOCK provider not registered in prod, unknown carrier never processed.
- **M2 auth chain on REAL tokens:** service-key client-credentials token from the
  live xsuaa → routes return **403** (validated, then scope-gated) — the
  validate→scope→plants chain runs for real. Verify key deleted after use.
- Placeholder Carriers/CarrierAccounts CSVs seeded (active=false — cannot quote).
Remaining for full M2/M3: role collections + test user (1.17, cockpit) for
role-based S3 on real users; destinations NZPOST_SANDBOX + GRAPH (still unbound —
email + carrier stay fail-closed); Cloud Connector + ECC (1.2).
Co-located Data Governance app: untouched, running.

---

## ▶ RESUME HERE — current position (2026-07-17, session 2)

- **1.16 DONE (synthetic):** Fiori Elements Shipment Lookup + Dashboard live in
  `app/shipment-lookup/` over a NEW read-only OData projection
  (`srv/lookup-service.cds|.js`, S3 re-proven: `test/lookup-odata.test.js`).
  48/48 tests green. Teru's decision: FE over freestyle (Work Zone correctness);
  OData reads OUR HANA — no ECC dependency. Doc 08 §3 records the surface.
  ui5-mcp was disconnected (logged); `@ui5/linter` CLI used instead.
- **Next agent-doable:** 1.17 needs 1.15 (gated 0.1 BrowserPrint) — so Phase 1
  agent track is now blocked on humans: Open Items #2/#4/#6, 0.1 spike, 0.4
  sandbox, xsuaa binding (M2 real-token re-verify). 1.18 gate prep (S11–S14
  evidence collation) is the only remaining agent-startable slice.

### Prior position (session 1)

- **Task 1.1 fully DONE** — schema deployed to the HDI container
  (`E-commerce_Customer_Courier_Email-db`), duplicate (vbeln,exidv) insert
  rejected on live HANA (COURIER_SHIPMENTS_DOUBLEBOOKING), all secondary
  indexes verified. Remember: `hana-free` auto-stops when idle — restart
  before any deploy/DB work.
- **Synchronous backend COMPLETE on the synthetic seam (Teru's decision: build
  now on synthetic data, swap to real ECC + real NZ Post when the connection
  exists).** Done: 1.1, 0.5(agent), 1.3, 1.4, 1.5, 1.6a, 1.7, 1.8, 1.9, 1.10,
  1.11. Routes live: /deliveries /rates /book /label/:id /reprint /shipments
  /dashboard /void. **ALL of S1,S2,S3,S4,S7,S8,S9 GREEN and gating merges.**
  This is M2's security spine, evidenced on synthetic data.
- **Two synthetic seams to unwind when connections exist (both fail closed in
  prod, can never leak):** `srv/lib/ecc.js` (synthetic ZC_CourierDelivery +
  ZI_PlantAddress → real OData at 1.2) and `srv/providers/mock.js` + registry
  (→ real `providers/nzpost` at 1.6b). Every synthetic-verified task carries a
  re-verify tag; real-token/real-ECC re-verify is the M2/M3 gate.
- **Phase 1 BACKEND COMPLETE on synthetic data. S1–S10 ALL GREEN** (44 tests,
  all gating merges). Done this session: 1.1, 0.5(agent), 1.3, 1.4, 1.5, 1.6a,
  1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.14. Routes: /deliveries /rates /book
  /label/:id /reprint /shipments /dashboard /void /webhook/:carrier + the
  nightly jobs (srv/jobs-run.js).
- **What's LEFT in Phase 1 — all human-gated:**
  - **1.13 email — 🔴** Open Item #6 (does e-commerce already email?) + Graph
    secret. Trigger hook marked in webhook.js. Do NOT build past the gate.
  - **1.6b real NZ Post** — Open Item #2 (XK03) + NZ Post sandbox (0.4). Swap
    srv/providers/mock.js → providers/nzpost; move webhook secret env → dest.
  - **1.2 real ECC** — Open Item #4 (OX10). Wire real OData in srv/lib/ecc.js,
    DELETE the synthetic fixtures, re-verify 1.5/1.7 on real data.
  - **1.15–1.17 Fiori** — 1.16 (Shipment Lookup + Dashboard) is buildable now
    against live /shipments+/dashboard; 1.15 (dispatch+print) gated on the 0.1
    BrowserPrint spike; 1.17 Work Zone wiring.
  - **1.18 go-live gate** — S11–S14 evidence, paid HANA plan, DR tested.
- **Also open (human):** ruleset promote lint/CodeQL to REQUIRED checks (bot
  denied — repo admin); FedEx paperwork (0.2). CF token expired mid-session —
  `cf login` needed before more BTP work; hana-free auto-stops when idle.
- **Still open (human):** Open Items #2 (XK03 contract → 1.6b), #4 (OX10 plant
  dock → 1.2), #6 (e-comm email → 1.13); ruleset promote lint/CodeQL to required
  checks (bot denied); NZ Post sandbox (0.4); FedEx (0.2); BrowserPrint (0.1).
  HANA auto-stops when idle — restart before any deploy/DB work.
- **Blocked (human, critical path):** Open Items #2/#3/#4 (SAP SE16/XK03/OX10
  lookups), NZ Post sandbox (0.4), FedEx onboarding (0.2), BrowserPrint spike
  (0.1). See `12-Courier-Open-Items.md` and `02-Project-Plan.md`.
- **Environment gotchas:** the free `hana-free` HANA Cloud auto-stops when idle —
  restart it before any deploy or DB test (start = safe for the co-located Data
  Governance app; agent permission layer blocks `cf update-service`, so this is
  a human step). `ruflo` is DROPPED for now (security review not done, doc 14
  §1.2 rule 1) — this log is the only cross-session memory.

---

## 0.5 (deploy leg) — agent half DONE: MTA archive builds with the Fiori app; human half SURFACED
_2026-07-17, session 2 (Teru's go: "run your recommendation" = deploy next)_

Iterations: 2 (ui5-task-zipper declared but not installed — npm install re-sync
fixed; then `npx mbt build` GUTTED root node_modules via its module npm-ci legs
— restored with npm install, 59/59 green again. **Gotcha for every future
session: after a local `mbt build`, run `npm install` before tests.**)
Ponytail verdict: wire the app into the MTA via `cds add html5-repo` (official
generator) — no hand-written mta blocks; mbt via npx, NOT a committed dep.
What changed: `mta.yaml` (html5 module for app/shipment-lookup: npm ci + ui5
build → dist; app-deployer requires shipment-lookup.zip → gen/app),
`app/shipment-lookup/package.json` (+build/start scripts, +ui5-task-zipper
devDep), `ui5.yaml` (zipper task bundles xs-app.json into the zip),
`xs-app.json` (REMOVED the generator's appended generic /odata route — dead:
sits after the catch-all; our specific /odata/v4/lookup route already covers
it), `webapp/manifest.json` (generator reformat only), `.gitignore`
(app/*/dist/), docs/02 0.5 row.
Verification: app build → dist/shipment-lookup.zip contains minified sources +
manifest + xs-app.json (21 entries); **`npx -y mbt build` → full .mtar
generated, gen/app populated — the 1.16-review deploy gap (no gen/app) is
CLOSED.** Full suite 59/59 + lint + cds build green after node_modules restore.
**SURFACED (👤 Teru, paste-ready, in order):**
```
cf login -a https://api.cf.ap10.hana.ondemand.com --sso        # token expired
#   target: org btpsandbox / space AI_Document
#   HANA Cloud instance: start it in cockpit if stopped (hana-free auto-stops)
cf install-plugin multiapps -f
npx -y mbt build
cf deploy mta_archives/E-commerce_Customer_Courier_Email_1.0.0.mtar
```
Then agent re-verifies on real tokens: S7 (401/403 legs), S3 (cross-plant) via
an xsuaa service-key token against the deployed URL = **M2**. GRAPH +
NZPOST_SANDBOX destinations remain separate human steps (M4 / 1.6b).
Classification of the stop: (c) environment — CF auth is SSO-interactive; the
agent permission layer additionally blocks service state changes (HANA start).

---

## 1.13 — DONE (Graph send pending binding): email on first pickup, exactly-once + sweep
_2026-07-17, session 2_

Iterations: 2 (initial build green first run; review round then found the real
bug — see below — plus a sort-comparator defect; both fixed + re-verified)
Tools used: superpower (plan), ponytail (no mail lib — Graph = 2 fetches; no
revert-on-failure; single sender now, per-plant = Phase 3), code-review skill
(medium: 8 finder angles + convergence verify), cds-mcp not needed this task.
What changed: `srv/lib/email.js` (S11 escapeHtml; graphConfig from binding ONLY;
graphTransport token+sendMail with 10s AbortSignal timeouts; notifyFirstPickup:
DO-level atomic claim INSERT-verify + UPDATE..WHERE sent=false, claimed !== 1
fails closed; content = SO no. + all trackings primary-first, NEVER the DO no.;
sent_at = send-confirmed marker; failure → bounced/bounce_info, claim kept —
at-most-once), `srv/lib/webhook.js` (PICKUP_CLASS = {in_transit,
out_for_delivery, delivered}; first_scan_at on FIRST pickup-class event via
WHERE first_scan_at null; processed=true BEFORE the email leg — Graph latency
never gates event durability or leaks an inflight slot), `srv/lib/jobs.js`
(`findUnnotified`: nightly sweep — picked-up DOs with no sent claim →
re-drive notifyFirstPickup; sent=true+sent_at=null (crash window) → FLAG only,
never auto-resend), `srv/jobs-run.js` (poll runs the sweep),
`srv/providers/mock.js` (+trackingUrl), doc 08 §5 (optional trackingUrl),
`srv/lib/ecc.js` (fixture ship-to emails → terulin.sinulingga@gallagher.com
per Open Item #6 answer), `test/email.test.js` (8 tests).
**Review round (8 angles): the headline catch — my "retries when GRAPH is
bound" comment was a LIE in v1: no retry path existed** (findStalled can't see
scanned shipments; no later in_transit event re-fires). Fixed at the right
altitude = the findUnnotified poller leg, test-proven (unbound scan → bind →
sweep sends exactly once; idempotent second sweep). Also fixed from review:
fetch timeouts (hung Graph call permanently leaked a MAX_INFLIGHT slot — 50
leaks would kill the webhook worker), pickup-class trigger widening (carrier
vocab skipping in_transit would never email), `(x === true)` sort comparator
broken under SQLite 1/0 booleans (test passed by insertion-order luck — seed
order reversed to make it honest), blanket INSERT catch now verifies the row
exists, claim rowcount check is strict (!== 1).
Verification: **59 tests = 59 pass** (8 email: 3-concurrent race → ONE send;
content SO-not-DO + escaped hostile tracking + primary-first; unconfigured →
no claim; send-failure → claim kept + bounce recorded; webhook path in_transit
AND delivered-only vocab both → one email; sweep re-send + crash-window flag).
Lint + build green.
Accepted/deferred (rationale): OAuth token cache (YAGNI at ~100s sends/week);
rebook-after-void to a NEW email stays blocked by the DO claim (doc 08 §8
exactly-once per DO — by design); shared test fixture/db-boot helpers (3
suites, do when next touching them); processed=false reprocessor for dropped
worker slots (pre-existing 1.14 note — carrier retries + dedupe cover it).
**GATE REMAINING: real Graph send needs the GRAPH destination binding (0.5
remainder, human) — then re-verify one real email to Teru's inbox (M4 gate).
Teru offered a Resend account for interim real-send testing — declined for now
(doc 08 §8 fixes Graph as transport); revisit only if Teru asks.**

---

## 0.3 — DONE: Open Items #2, #4, #6 CLOSED (Teru's answers) + carrier placeholders
_2026-07-17, session 2_

Iterations: 1 (answers recorded per doc 12 rules; answer-wins doc updates same commit)
Answers (Teru): **#2** contract account is PROVIDED INTO the app — app config,
not an ECC read; `ZI_CarrierContract` DROPPED from 1.2 (doc 08 §4.1 now "two
CDS views"). **#4** plant dispatch address comes from an SPRO-style CONFIG
table exposed via CDS (not T001W→ADRC) — dock-vs-office ambiguity gone; same
field shape, built at 1.2. **#6** the COURIER APP owns the tracking email —
e-comm does not send; test recipient `terulin.sinulingga@gallagher.com` until
real ECC ADR6 email flows via 1.2 (real logic = ship_to_email from the
delivery payload, never config).
What changed: docs/12 (three answers), docs/08 §4.1 + §4.2 (two views;
ZI_PlantAddress source; ZI_CarrierContract removal note), docs/09 + db/schema.cds
(account_ref = app config comment), docs/02 (0.3 ✅, 1.2 ungated ⬜ 2-views,
1.13 ungated ⬜, blockers table), db/data/courier-Carriers.csv +
courier-CarrierAccounts.csv (placeholder rows for all 6 couriers,
**active=false** — fail-closed router means placeholders can never quote;
SysAdmin flips active when the real account ref is entered).
Verification: cds build green; 51/51 tests green with seeds loaded (no
collision with test-seeded MOCK rows).
**Unblocked: 1.13 (build now), 1.6b (only NZ Post sandbox 0.4 left), 1.2 (no
open questions — needs ECC dev access + Cloud Connector, human).**

---

## 1.16 — DONE (on synthetic data): Fiori Shipment Lookup + Dashboard, S3 re-proven on OData
_2026-07-17, session 2_

Iterations: 1 (one self-caught false alarm: a leaked `cd` into app/ made tests/
build look broken from the wrong cwd; diagnosed before touching anything)
Tools used: superpower (plan), ponytail (3 trims: one CDS file; no ShipmentEvents
exposure — no werks column, join-scoped projection deferred; no CDS reprint
action — FE custom action calls existing POST /reprint), cds-mcp (projection +
where-injection idiom), fiori-mcp (FE_LROP scaffold + 3-step functionality
workflow), ui-ux-pro (floorplan: List Report/Object Page + FPM custom page for
dashboard — OVP rejected as a second app for one counts table), caveman.
**ui5-mcp DISCONNECTED this session** (logged per doc 14 §1.2 rule 3) —
fallback: `@ui5/linter` CLI + JSON validation. One linter finding
(`no-outdated-manifest-version`) is a UI5-2.x-readiness rule; generator emitted
the correct manifest version for UI5 1.136.7 — recorded, not "fixed".
**Design decision (Teru): Fiori Elements over freestyle** — Work Zone embedding
correctness (shell/intents/theming) generated, not hand-assembled. Needs OData
→ new read-only CAP projection over OUR HANA Shipments (missing ECC Gateway
is unrelated to this read path). Doc 08 §3 updated in the same commit.
What changed: `srv/lookup-service.cds` (readonly projection — EXCLUDES
label_bytes/ship_to_email/rate columns/created_by; UI annotations: LineItem,
SelectionFields vbeln/tracking/so/status/werks, FieldGroups #Ship + #Lifecycle
timestamps = the support "events" view), `srv/lookup-service.js` (before-READ:
`view` scope + `werks in <token plants>` injected into every READ incl. $count;
fail closed on empty plants — OData twin of the repository rule),
`test/lookup-odata.test.js` (S3 OData leg), `app/shipment-lookup/` (FE_LROP via
fiori-mcp + hand-authored: ext/Reprint.js header action → POST /reprint,
ext/dashboard/* FPM custom page over GET /dashboard, manifest route/target +
CourierShipment-lookup/-monitor inbounds for 1.17 tiles, i18n),
`package.json` (generator: workspaces + sapux + cds-plugin-ui5 devDep; test
script scoped to `test/*.test.js` — auto-discovery was pulling the app's
browser-only OPA journeys into node --test), docs 08/02 + this entry.
Verification: **48 tests = 48 pass** (43 baseline + 5 new; old "44" counted the
helpers file as a pass — count now honest). S3 OData leg GREEN: cross-plant
$filter by vbeln/tracking/so → empty, by-key → 404, $count plant-filtered,
positive controls per plant; $metadata leaks none of label_bytes/ship_to_email/
rate_*/created_by; no token → 401 (express xssec middleware covers CAP-mounted
routes — verified live: app index, OData, REST all 401 fail-closed), no view
scope → 403. Lint clean, `cds build` green, `cds serve` boots with
LookupService at /odata/v4/lookup + UI5 app mounted at /shipmentlookup.
Known-cosmetic: CAP deprecation warning reading `req.authInfo` via its http
wrapper (our property, their getter shim) — harmless, revisit if CAP removes it.
**SYNTHETIC TAG: FE click-through in Work Zone + real-token S3 re-verify land
with 1.17/M2 (xsuaa binding). Reprint button prints nothing yet by design —
BrowserPrint pipeline is 1.15, gated on the 0.1 spike.**

Review round (10-angle code-review + sweep, security-review skill errored on
`origin/HEAD` — logged, inline S-pass done instead). FIXED before landing:
plant-guard now SHARED (`repository.assertPlants` exported, OData handler uses
it — element-type check no longer weaker than REST); before-READ registered on
'Shipments' not '*' (werks-less future entities won't be mis-scoped); Reprint.js
rewritten to the documented FE V4 handler contract ((oBindingContext, …), no
`this.getModel`, ResourceBundle, CSRF preflight against the OData service root);
Dashboard controller extends sap.fe.core.PageController; HeaderInfo $Type added;
xs-app.json added (srv-api destination routes for odata/reprint/dashboard/label);
dead OPA journey files deleted + test script back to bare `node --test`; new S3
legs: OR-filter, $batch inner request, malformed-werks [''] → 403, write → 405.
**51/51 tests green.** DEFERRED with rationale: destination-content/managed-
approuter wiring in mta = deploy leg (M1/1.17 — gen/app build step + srv-api
destination must be wired before first `cf deploy` of the UI); monitor tile must
set app hash `&/dashboard` when 1.17 wires it; CDS label i18n (English-only
regions); tokenFor test-helper consolidation (5 copies — do when next touching
those suites); publicShipment/projection dual safe-list (both test-guarded);
routes.js /dashboard inline aggregate → repository accessor (follow-up);
CI workspaces install cost (`--workspaces=false` candidate at next CI touch).

---

## 1.14 — DONE: nightly fallback poller + PII purge job, S10 GREEN
_2026-07-17, session 1_

Iterations: 2 (jobs.test.js first hung — no server handle to close; rewrote to
connect+deploy in-memory db directly, no HTTP server. Then CLI wrapper bug:
`cds.entities is not a function` — needed the model loaded/compiled; fixed.)
Ponytail verdict: NO scheduler dep, NO setInterval (a CF restart resets the
timer). Two pure functions + a thin CLI wrapper the CF Job Scheduler / `cf
run-task` calls nightly — scheduling is deploy-time config, not code.
What changed: `srv/lib/jobs.js` (`purgePII({now, retentionDays})` — nulls
ship_to_name/email/label_bytes past the window, KEEPS financial+tracking for
tax, deletes matching Notifications; idempotent via a `[purged]` sentinel;
counts-only log, no PII. `findStalled({now})` — booked >24h, no first_scan_at,
still pre-transit → alert list, catches silent webhook failure),
`srv/jobs-run.js` (CLI: load+compile model → connect db → run purge|poll),
`test/jobs.test.js`, `eslint.config.mjs` (ignore build output `gen/`).
Config: `PII_RETENTION_DAYS` env, default 730 (Open Item #11 confirms number;
job built regardless).
Verification: **44 tests = 44 pass, 0 todo.** S10 with backdated fixtures:
800-day-old row → PII nulled, label_bytes null, rate_quoted/tracking kept, its
Notification deleted; 10-day-old row untouched; second run purges 0
(idempotent). Poller flags a 2-day stalled shipment, ignores recent/scanned/
advanced. Lint clean (gen/ now ignored); cds build green. CLI wrapper loads
model + connects + runs (verified reaching query exec; full run needs the
deployed DB — HANA in CF, or a valid CF token locally).
**Phase 1 backend is COMPLETE on synthetic data. S1–S10 all green.** Remaining
Phase 1: 1.13 (email, gated Open Item #6), 1.6b (real NZ Post, gated #2+0.4),
1.2 (real ECC, gated #4), 1.15–1.17 Fiori (1.15 gated on 0.1 BrowserPrint),
1.18 go-live gate.

---

## 1.13 — SURFACED (gate): email on first pickup — Open Item #6
_2026-07-17, session 1_

Gate check (doc 14 loop step 0): STOP, do not guess. 1.13 is 🔴 in the plan.
Blocker: **Open Item #6 — does e-commerce ALREADY send shipping/tracking
emails to customers?** This is not a mechanism question — it's a design one:
if e-comm owns customer comms, we must NOT send a duplicate email (design note,
doc 12 #6: "consider pushing tracking to e-comm instead of emailing directly").
Building the send path now risks baking in the wrong behavior. Also needs a
Microsoft Graph app secret via the destination service (0.5 remainder).
State: the trigger point is already a marked hook in
`srv/lib/webhook.js` processEvent (on first in_transit/pickup). The atomic
DO-level claim (Notifications.sent via UPDATE..WHERE sent=false) + string
escaping (S11) are ready to build the moment #6 is answered.
Recommendation: ask e-commerce (Open Item #6). If they own comms → 1.13
becomes "push tracking to e-comm", a design change to surface, not the direct
email. If they don't → build the Graph send + atomic claim as specced.
Next BUILDABLE task meanwhile: **1.14** (nightly fallback poller + PII purge
job, S10) — no external gate (retention window is config, Open Item #11; job
built regardless). Involves a PII-delete job — flagged for explicit go-ahead.

---

## 1.12 — DONE (on MOCK carrier): /webhook/:carrier, S5 + S6 GREEN
_2026-07-17, session 1_

Iterations: 1 (ponytail-gated first; one self-caught circular require
webhook↔providers→mock, fixed by extracting pure helpers to srv/lib/sig.js;
one lint catch: dead `ok=false` initializer)
Ponytail verdict: rate-limit / body-cap / bounded-queue are doc 08 §7
security REQUIREMENTS at a public trust boundary (S5/M2 DoS), not simplifiable
away — but implemented minimally: fixed-window Map counter, express.raw limit
(413 auto), and "bounded queue" = setImmediate + in-flight counter because the
event is durably stored in ShipmentEvents BEFORE the 200 (overflow/crash rides
the nightly poller, task 1.14). No queue lib, no new deps (node:crypto).
What changed: `srv/lib/webhook.js` (receiver: rate-limit → cap → HMAC+timestamp
verify → normalize+dedupe insert → fast 200 → async status worker; unknown
status → stored 'unknown', processed, NO state change, S6; carrier strings
shape/length-bounded before store, S11), `srv/lib/sig.js` (pure HMAC/timestamp
helpers, breaks the require cycle), `srv/providers/mock.js` (+ verifyWebhook
HMAC-SHA256 constant-time + ±5min, + normalizeEvent with a STATUS_MAP →
'unknown' fail-closed), `srv/routes.js` (POST /webhook/:carrier with
express.raw 256KB), `test/webhook.test.js`.
Verification: **41 tests = 41 pass, 0 todo.** S5: valid signed → 200 + status
advanced + first_scan_at; replay (stale ts) → 401; tampered → 401; missing sig
→ 401; >256KB → 413; flood → 429; dedupe → one row. S6: never-seen status →
stored 'unknown', processed, shipment stays 'booked'. Lint + build green.
**Webhook secret is an env placeholder (WEBHOOK_SECRET_<CARRIER>) → moves to
the carrier destination at 1.6b. Email trigger is left as a marked hook in
processEvent for 1.13 (gated, Open Item #6).**

---

## 1.11 — DONE: /void + append-only audit, S8 GREEN
_2026-07-17, session 1_

Iterations: 1 (one self-caught structural slip: /void first pasted after the
module.exports closing brace; fixed before running — no bad commit)
What changed: `srv/lib/audit.js` (append-only AuditLog writer — the ONLY
writer, exposes `record` only, no update/delete path in code; DB INSERT/SELECT-
only grant is a HANA .hdbrole at deploy, verified at go-live), `srv/routes.js`
(POST /void — scope void, plant-checked, per-HU: carrier void → mark voided →
audit row with before/after; exidv narrows to one HU), `test/void-audit.test.js`.
Verification: **33 tests = 33 pass, 0 todo.** S8 green: void writes exactly
one audit row (actor=tester, object=vbeln/exidv, before {status:booked} /
after {status:voided}); audit module surface is `['record']` only (no mutate
path); void needs the void scope (book→403) + right plant (other→404).
Lint + build green.
**Phase 1 backend money-path + read/lookup + void are complete on synthetic
data.** Next backend tasks are GATED: 1.12 webhook (needs a webhook secret
via destination — 0.5 remainder), 1.13 email (Open Item #6 + Graph secret).
1.6b (real NZ Post) gated on Open Item #2 + sandbox (0.4).

---

## 1.10 — DONE: /shipments + /dashboard, S3 GREEN — ALL S1–S4 now green
_2026-07-17, session 1_

Iterations: 1
What changed: `srv/routes.js` (GET /shipments — scope view, lookup by
vbeln/tracking/so through the plant-scoped repository ONLY; GET /dashboard —
scope view, counts by (werks,status) filtered to req.plants; `publicShipment`
projection never ships label bytes), S3 test un-todo'd + hardened (all three
lookup paths return [] cross-plant; dashboard shows only caller plants;
positive control proves the SAME query returns the row for its owning plant;
reprint other-plant → 404).
Verification: **30 tests = 30 pass, 0 todo.** S3 GREEN and gating.
**Milestone: the entire test-first S1–S4 spine is green and gating merges**
(S1 destination guard, S2 label auth, S3 cross-plant isolation on every read
path, S4 double-book) — plus S7 (auth pre-handler) and S9 (PII-scrubbed
errors). All verified on synthetic ECC + mock carrier; real-token/real-ECC
re-verify is the M2/M3 gate. Lint + build green.

---

## 1.9 — DONE: /label/:id + /reprint, S2 GREEN
_2026-07-17, session 1_

Iterations: 2 (first run: routes.js missing `cds` require — caught by lint
(no-undef) AND runtime; then LargeBinary read semantics)
Diagnosis of iter-1 test failures (classification (a), fixed): `@cap-js/sqlite`
(and HANA) treat `LargeBinary` as MEDIA — omitted from `SELECT *` (so
`label_bytes` was undefined → 404) and returned as a Readable STREAM when
selected explicitly. Probed directly before fixing.
What changed: `srv/lib/repository.js` (+ byId, labelById [explicit
label_bytes columns], bySo accessors — all plant-scoped), `srv/routes.js`
(GET /label/:id — scope reprint, streams stored bytes, never a carrier URL;
POST /reprint — scope reprint, plant-checked, returns zplRefs; + `cds`
require), S2 test un-todo'd (books a real DO, exercises download auth legs +
drains the stream to assert no URL).
Verification: 30 tests = 29 pass + 1 todo (S3 → 1.10). **S2 GREEN and
gating:** no token → 401, other-plant → 404 (indistinguishable from missing),
right-plant → stored ZPL bytes, never a URL; label_bytes column drained and
URL-checked. Lint + build green.

---

## 1.8 — DONE (on MOCK carrier): POST /book — idempotent money path, S4 GREEN
_2026-07-17, session 1_

Iterations: 1
What changed: `srv/lib/booking.js` (doc 08 §6 order exactly:
idempotency-replay check → per-DO in-process mutex ("exactly one carrier
call"; single CF instance by design, DB unique (vbeln,exidv) as the
cross-instance backstop — ponytail ceiling noted) → existing rows returned
as-is → provider.rate to validate rateId → provider.book → label bytes
persisted with the rows (S2 storage leg) → respond; CRITICAL no-PII log if
carrier-booked-but-not-persisted), `srv/routes.js` (POST /book, scope
`book`, 400/404 legs), S4 test un-todo'd + reworked onto the fixture DO
with a carrier-call spy + routing seeds.
Verification: 29 tests = 27 pass + 2 todo (S2 awaits 1.9 label route, S3
awaits 1.10). **S4 GREEN and gating:** concurrent /book × 2 → both 2xx,
same tracking, exactly ONE carrier call (spy), idempotency replay returns
first result with no carrier call, exactly one row per (vbeln,exidv).
Lint + build green.
**SYNTHETIC TAG: re-verify against real NZ Post sandbox at 1.6b (S4
re-run on real tokens is the M2 gate).**

---

## 1.7 — DONE (on MOCK carrier + SYNTHETIC ECC): POST /rates
_2026-07-17, session 1_

Iterations: 1
What changed: `srv/routes.js` (POST /rates: scope `rate` → visible-delivery
check (unknown and other-plant both 404 — no information leak) → plant
address → router (fail-closed contract) → provider.rate; per-route JSON body
parser, 100kb cap — global parser deliberately avoided so 1.12's webhook can
read the raw body for HMAC), `srv/lib/ecc.js` (+ synthetic ZI_PlantAddress
with bukrs; same production fail-closed guard; Open Item #4 caveat noted),
`test/rates.test.js`.
Verification: 29 tests = 26 pass + 3 todo (S2/S3/S4). Rate options returned
for the test DO; price proves HU weight flows through (2.4 kg → 11.00 NZD;
multi-HU 9.3 kg summed → 28.25); other-plant vs unknown vbeln
indistinguishable (404/404); 403/400 legs. Lint + build green.
**SYNTHETIC TAG: re-verify with real ECC (VEKP weights) + real NZ Post
contract rate at 1.6b/1.2 — M3 gate.**

---

## 1.6a — DONE: provider interface, S1 destination guard, router, mock carrier
_2026-07-17, session 1 (split blessed by Teru: carrier-agnostic half now, nzpost half gated)_

Iterations: 1
What changed: `srv/lib/destinations.js` (assertAllowedCarrierUrl — S1:
destination-origin match + private/link-local/loopback refusal; DNS-rebind
pinning noted for the real provider's HTTP client), `srv/lib/router.js`
(table-driven route(werks, destCountry, bukrs) over Routes/Carriers +
FAIL-CLOSED contract cache over CarrierAccounts, 5-min TTL — no contract,
no quote, ever), `srv/providers/mock.js` (deterministic synthetic carrier,
interface per doc 08 §5; accepts NO webhooks; normalizes to 'unknown' —
fail closed), `srv/providers/index.js` (registry; MOCK registered ONLY
outside production), `test/router.test.js`, S1 test un-todo'd.
Verification: 25 tests = 22 pass + 3 todo (S2/S3/S4). **S1 GREEN and now
gates merges.** Router: no-route/inactive-carrier/no-contract all fail
closed; output carries destination NAME only, never a URL. Lint + build green.
**1.6b (providers/nzpost) SURFACED — still gated on Open Item #2 (contract
source) + NZ Post sandbox (0.4).** Mock provider unlocks 1.7–1.11; every
green on MOCK carries the synthetic re-verify tag (real NZ Post at 1.6b).

---

## 1.5 — DONE (on SYNTHETIC ECC): /deliveries worklist proxy, plant-filtered
_2026-07-17, session 1_

Iterations: 1
Tools used: ponytail (one client module, one route, zero new deps). NOTE:
cds-mcp still disconnected — not needed (express route + fixture).
What changed: `srv/lib/ecc.js` (the ONE ECC access module: synthetic fixture
in dev/test, **fails closed 503 in production or when unimplemented-real-ECC
configured** — mock can never leak to prod), `srv/routes.js` (GET /deliveries
behind requireScope('view'), plants from token only), `srv/server.js` (mount
routes), `test/deliveries.test.js`.
Verification: 20 tests = 16 pass + 4 S-todo red. DONE criterion met: worklist
returns test DOs (incl. multi-HU with weights); wrong-plant token → empty;
multi-plant token unions; no scope → 403; no token → 401. Lint + build green.
**⚠ SYNTHETIC-DATA TAG (per Teru's decision, 2026-07-17): verified against
the fixture in srv/lib/ecc.js, NOT real ECC. When task 1.2 lands, wire the
real OData client in srv/lib/ecc.js, DELETE the fixture, re-run this suite
against a real packed delivery, and clear this tag. M3 gate requires the
real-ECC re-verify.**

---

## 0.3 (partial) — Open Item #3 CLOSED (ADR6 email selection)
_2026-07-17, session 1_

Iterations: 1 (human answer, recorded per doc 12 rules)
What changed: `docs/12` #3 → ✅ CLOSED, `docs/08` §4.1 ADR6 join note updated
in the same commit (answer wins).
Answer (Teru): delivery → VBPA partner function WE (SH) → exactly ONE ADRNR →
exactly ONE ADR6 row per CPD address. Select by ADDRNUMBER alone — no
CONSNUMBER/FLGDEFAULT filter. 1.2 keeps the join deterministic regardless
(lowest CONSNUMBER) so a surprise second row can never fan out a delivery.
Still open in 0.3: **#2** (carrier contract/account source — XK03) and
**#4** (plant dispatch address — OX10). 1.2 remains gated on #4 (+#2 for 1.6).

---

## 1.1 (deploy leg) — DONE: schema deployed to HANA, S4 guard verified live
_2026-07-17, session 1 (after human started the HANA instance)_

Iterations: 2 (first deploy failed: hand-written `db/src/*.hdbindex` had no
`.hdiconfig` mapping — classification (a), fixed by adding `db/src/.hdiconfig`
with the `com.sap.hana.di.index` plugin entry)
Tools used: cf CLI (delete failed instance, recreate `hana hdi-shared`
`E-commerce_Customer_Courier_Email-db`), `cds deploy --to hana:...`,
`cds bind --exec` + raw-SQL verification script.
What changed: `db/src/.hdiconfig` (new), this entry, plan flips.
Verification (DONE criteria met on REAL HANA):
- **Migrations run:** `cds deploy` → "successfully finished deployment"
  (18 files). Binding saved to gitignored `.cdsrc-private.json` — no secrets
  in repo.
- **Constraint verified:** raw-SQL duplicate insert of (vbeln,exidv) →
  `unique constraint violated: Table(COURIER_SHIPMENTS),
  Index(COURIER_SHIPMENTS_DOUBLEBOOKING)`; exactly 1 row remained; cleanup done.
- **Indexes live:** COURIER_SHIPMENTS_DOUBLEBOOKING (unique) +
  TRACKING_NUMBER / VBELN / WERKS_STATUS secondaries confirmed via INDEXES view.
**1.1 is now fully DONE.**

---

## 1.4 — DONE: failing S1–S4 tests (test-first) + lint/CodeQL re-enabled
_2026-07-17, session 1_

Iterations: 1
Tools used: ponytail (no new runtime deps; eslint devDeps were pre-planned in
the CI comment), node:test todo-markers. NOTE: cds-mcp/snyk MCP servers were
disconnected this session leg — not needed for this task (tests + CI config),
logged per doc 14 §1.2 rule 3.
What changed: `test/s1-s4.security.test.js` (four S-tests against the REAL
in-process courier-srv with REAL xssec token validation),
`test/helpers/xsuaa-mock.js` (shared signer + JWKS intercept; s7 suite
refactored onto it), `eslint.config.mjs` + eslint/@sap/eslint-plugin-cds
devDeps (`cds add lint`), `.github/workflows/ci.yml` (lint job),
`.github/workflows/codeql.yml` (restored from history).
Verification: 16 tests — 12 pass, **4 run RED as failing TODOs** (S1: 
destinations module missing; S2: wrong-plant 403 leg 404s; S3/S4: routes
404). `eslint .` clean; `cds build` green.
**Red-in-CI convention (deliberate, review welcome):** DONE says "four red
tests in CI", but `test` is a REQUIRED check — hard-failing tests would block
every merge including their own PR. So the four S-tests carry
`{ todo: 'red until task 1.x' }`: they RUN in CI and their failures are
recorded visibly in the job log, without failing the job. The implementing
task (1.6/1.8/1.9/1.10) REMOVES the todo marker — from then on they gate
merges for real. Asserts must never be weakened (doc 14 §2.1 rule 1).
Follow-up (needs repo admin): add `lint` and CodeQL `analyze` to the ruleset
required checks — bot attempt recorded below; if it failed, it's a 👤 step.

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
