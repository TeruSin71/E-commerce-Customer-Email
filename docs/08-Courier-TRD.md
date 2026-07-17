# 08 — Courier Booking: Technical Requirements (TRD)

> **Prereq:** Read `07-Courier-PRD.md` first.
> **Contains:** Stack decisions, component contracts, API surface, integration patterns.
> **Rule for the agent:** These are decisions, not suggestions. Deviate only via a documented decision record.

---

## 1. System landscape

```
E-COMMERCE ──sales order──► SAP ECC (SO→DO→pick→pack→HU; later PGI)
                                │
                                │ 3 CDS views, READ-ONLY, technical user
                                ▼
                         Cloud Connector
                                ▼
BTP ┌───────────────────────────────────────────────────────────────┐
    │  Work Zone (launchpad, SSO, tiles)                            │
    │    ├─ Fiori: Courier Dispatch    (dispatcher, supervisor)     │
    │    ├─ Fiori: Shipment Lookup     (support+)                   │
    │    ├─ Fiori: Carrier Setup       (sysadmin)                   │
    │    ├─ Fiori: Courier Dashboard   (supervisor, sysadmin)       │
    │                                                               │
    │  courier-srv (CF, Node.js)  ← THE authorization boundary      │
    │    /rates /book /void /reprint /label /webhook /config        │
    │    + email on pickup + monitoring jobs                        │
    │                                                               │
    │  HANA Cloud        ← courier system of record                 │
    │  Destination svc   ← carrier URLs + credentials, BOUND        │
    │  XSUAA             ← scopes + werks attribute → JWT           │
    └───────────────────────────────────────────────────────────────┘
        │ outbound: rate/book/void          ▲ inbound: webhooks
        ▼                                   │
     CARRIERS (NZ Post, FedEx, UPS, AusPost, CanPost, PostHaste)
        │
        ▼ email on pickup (via MS Graph)
     CUSTOMER
```

**Nothing flows from BTP back into ECC. Ever.**

## 2. Stack (fixed)

| Layer | Choice | Notes |
|---|---|---|
| Frontend | SAPUI5/Fiori, deployed to HTML5 App Repo, surfaced in Work Zone | Managed approuter from Work Zone |
| Backend | Node.js on BTP Cloud Foundry, single app `courier-srv` | ~400–800 LOC target. Do NOT split into microservices. |
| DB | SAP HANA Cloud (hdi-shared) | Courier system of record |
| Auth | XSUAA. `@sap/xssec` for JWT validation. | Plant = STATIC `werks` value per regional role collection (~17 collections, pattern `Courier_<Role>_<Region>`). Entra/CIS = authentication only. |
| Secrets | BTP Destination service ONLY | URL + credential bound together per destination |
| ECC access | OData over custom CDS views, via Cloud Connector, technical user | Read-only. Documented clean-core exception (released API lacks VEKP dims). |
| Email | Microsoft Graph API, client-credentials flow | Secret in destination service |
| Printing | Zebra BrowserPrint agent on packing PCs | Client-side. ZPL passthrough. |
| Carrier calls | Direct REST per carrier, behind a provider interface | Aggregator (EasyPost) is a swappable provider, not the default |

## 3. courier-srv API surface

All routes require a validated XSUAA JWT except `/webhook/:carrier`.
All routes enforce scope + plant (see 10-Security). Plant is read from the token attribute, NEVER from request params/body.

| Route | Method | Scope | Behavior |
|---|---|---|---|
| `/deliveries` | GET | view | Proxy to ECC CDS worklist view. Server-filtered: `KOSTK='C' AND PKSTK='C' AND WBSTK≠'C'` AND plant ∈ token werks. Returns flat delivery objects. |
| `/rates` | POST | rate | Body: `{vbeln}`. Reads delivery+HUs from ECC, resolves carrier via router, calls carrier rate API with contract account. Returns rate options. Read-only, no side effects. |
| `/book` | POST | book | Body: `{vbeln, rateId, idempotencyKey}`. IDEMPOTENT — see §6. Books with carrier, downloads label(s), persists shipment rows + label bytes, returns `[{exidv, tracking, zplRef}]`. |
| `/void` | POST | void | Body: `{vbeln, exidv?}`. Calls carrier void/refund. Audited (who/when/before/after). |
| `/reprint` | POST | reprint | Returns stored ZPL for shipment. Scope + plant checked — labels are PII (customer name+address). |
| `/label/:shipmentId` | GET | reprint | Serves stored label bytes. Auth + plant checked. NEVER a redirect to a carrier URL. |
| `/shipments` | GET | view | Lookup by vbeln / tracking / SO. Plant-filtered ALWAYS (security H3). |
| `/dashboard` | GET | view | Counts by state per plant, stuck items. Plant-filtered. |
| `/config/carriers` | GET/PUT | config | Non-secret carrier config only (service codes, cutoffs, label format, account ref, active). URLs and keys are NOT here — destination service only. Changes audited. |
| `/webhook/:carrier` | POST | — (public) | See §7. HMAC-verified, timestamp-checked, size-capped, rate-limited, 200-fast, async processing. |

## 4. ECC integration contract

### 4.1 The three CDS views (build in ECC, expose via Gateway OData)

**`ZC_CourierDelivery`** — the worklist + booking payload source. One flat entity.

```
Joins:  LIKP
        → LIPS                      (items; VGBEL = SO number; customs fields)
        → VEKP                      (HUs; BRGEW real weight; LAENG/BREIT/HOEHE dims)
        → VBPA  WHERE PARVW = 'WE'  (ship-to partner — NOT sold-to)
        → ADRC  ON VBPA.ADRNR       (⚠ VBPA's ADRNR, NOT KNA1's — CPD customers)
        → ADR6  ON ADRC.ADDRNUMBER  (email; filter per Open Item #3 — likely CONSNUMBER='001')
Filter: KOSTK='C' AND PKSTK='C' AND WBSTK <> 'C'
Fields: vbeln, werks, soNumber(=LIPS-VGBEL), shipToName, street, city,
        postcode, region, country, email, hus[{exidv, weightKg, lengthCm,
        widthCm, heightCm}], incoterms(LIKP-INCO1),
        items[{matnr, description, qty, netValue, hsCode(MARC-STAWN),
        originCountry(MARC-HERKL)}]   — items[] only needed for international
```

**`ZI_PlantAddress`** — ship-from per plant.
```
T001W → ADRC on T001W-ADRNR. Fields: werks, bukrs, name, street, city,
postcode, region, country. (~4 rows; cache in courier-srv, refresh hourly.)
⚠ Open Item #4: confirm this is the dispatch dock, not the registered office.
```

**`ZI_CarrierContract`** — account/contract ref per carrier per company code.
```
Source TBD — Open Item #2 (XK03: LFB1-EIKTO? Z-table? outline agreement?).
Fields: lifnr, carrierId, bukrs, accountRef, validFrom, validTo, currency, active.
Cache in courier-srv with TTL. On cache-miss/ECC-unreachable: FAIL the rate
call. NEVER fall back to no-contract (would silently quote list rates).
```

### 4.2 Rules
- CDS views are data shape ONLY. No business logic, no CASE-encoded rules.
- ECC technical user: read-only, authorized ONLY for these three services (security S12).
- Domestic/international switch: `plantAddress.country !== delivery.country`.

## 5. Carrier provider interface

```typescript
interface CourierProvider {
  rate(req: RateRequest): Promise<RateOption[]>;
  book(req: BookRequest): Promise<Booking>;     // Booking: [{exidv, tracking, labelBytes, format}]
  void(req: VoidRequest): Promise<void>;
  verifyWebhook(headers, rawBody): boolean;      // HMAC per carrier
  normalizeEvent(payload): TrackingEvent;        // carrier vocab → our enum
}
```

- One implementation per carrier: `providers/nzpost.ts`, `providers/fedex.ts`, …
- `providers/easypost.ts` may exist as an aggregator option — same interface.
- **Router:** `route(werks, destCountry) → {providerId, destinationName, accountRef}` from the `routes` table. Table-driven; no hardcoded carrier selection.
- **Base URLs and credentials come ONLY from the BTP destination named in the route.** The provider must refuse any URL not from its destination (security S1). Deny private/link-local IP ranges as defense-in-depth.
- Status normalization: per-carrier mapping lives in `carriers.status_map` (JSONB config, not code). **Unknown status = log + alert + NO action. Fail closed** (security S6).

Canonical event enum: `pre_transit | in_transit | out_for_delivery | delivered | exception | returned | unknown`.

## 6. Booking semantics (money path — exact requirements)

1. `shipments` has UNIQUE constraint on `(vbeln, exidv)`. Booking inserts with `ON CONFLICT DO NOTHING`; a conflict returns the EXISTING booking. Never check-then-write (security S4).
2. Client supplies `idempotencyKey`; a retried request with the same key returns the first result, no second carrier call.
3. Order of operations: carrier book → download label bytes → persist shipment row + label → THEN return to client. If persist fails after carrier book: log CRITICAL with carrier shipment id for manual void. Never return a booking that isn't persisted.
4. Multi-HU: one row per HU. If the carrier supports multi-piece, one consignment with a master tracking; else N bookings. `is_primary` marks the master.
5. Void path: PGI reversed / DO deleted / user voids → call carrier void, mark row `voided`, audit.

## 7. Webhook contract (public endpoint — exact requirements)

```
POST /webhook/:carrier
1. Cap body size (256KB). Over → 413.
2. Rate-limit per source.
3. Verify HMAC signature over raw body (secret from destination service). Fail → 401. Constant-time compare.
4. Verify signed timestamp within ±5 min. Stale → 401 (replay defense, security S5).
5. Insert raw payload into shipment_events with dedupe key (tracking, event_type, event_ts) ON CONFLICT DO NOTHING.
6. Return 200 IMMEDIATELY. No email, no ECC calls, no heavy work inline.
7. Async worker: normalize status → match tracking → shipments → on first in_transit/pickup for a DO where notifications says not-sent → send ONE email → mark sent (atomic UPDATE ... WHERE sent=false, check rowcount — race guard).
8. Bounded queue. Unknown carrier status: store, alert, take NO action.
```

**Fallback poller:** nightly job → shipments PGI'd/booked >24h with no pickup event and no email → alert list (catches silent webhook failure).

## 8. Email contract

- Microsoft Graph `sendMail`, client-credentials (app-only). Secret in destination service.
- Trigger: FIRST pickup-class event per DO. Exactly once per DO (DO-level flag, atomic update).
- Content: **SO number** (customer-known), tracking number(s), carrier tracking link. **NEVER the DO number.** Multi-HU: all tracking numbers, one email.
- Sender address per plant (config).
- Carrier-sourced strings (tracking numbers, status text) are UNTRUSTED: validate shape/length before store, escape before render (security S11).
- Bounces: log to `notifications`, surface in lookup tile. Do not retry into the void.

## 9. Printing contract

- BrowserPrint agent on each packing PC exposes localhost HTTP; Fiori JS posts ZPL to it.
- `/book` and `/reprint` return ZPL refs; the app fetches bytes via `/label/:id` (authenticated) and hands to BrowserPrint.
- Printer selection: derive from user's station via `printers` table; remembered default; never per-print prompting.
- ⚠ **Week-1 spike (blocking):** BrowserPrint from inside the Work Zone iframe on a locked-down corporate PC. HTTPS→localhost mixed-content + iframe CSP is the known risk. If it fails, printing model must be redesigned — do this before building anything else UI-side.

## 10. Monitoring contract

- Record ALL of: `packed_at, booked_at, printed_at, pgi_at, first_scan_at` from day one.
- Phase 1: record only + dashboard counts. NO alerts.
- Later: thresholds per (state, werks) in `sla_thresholds` config; alert on breach; aggregate ("6 stuck"), cooldown ≥4h; escalation ladder badge→bell→email. Prefer time-to-carrier-cutoff over raw age where cutoff is configured.
- Set thresholds from observed p95 after ≥1 month of data. Do not guess.
