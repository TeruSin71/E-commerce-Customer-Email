# 09 — Courier Booking: Data Model

> **Prereq:** 07-PRD, 08-TRD.
> **Contains:** The complete courier schema, expressed as **CDS entities** (compiled to SAP HANA Cloud via `@cap-js/hana`), plus what deliberately does NOT live here.
> **Rule:** SAP HANA Cloud is the courier system of record. ECC data is read live via CDS, never replicated wholesale.
>
> **DB note:** The domain is defined in CDS and deployed as an HDI container on the shared HANA Cloud instance (`hana / hdi-shared`). PostgreSQL was the original design but is **not entitled** in the BTP account; HANA is the CAP-native, available option and matches `@cap-js/hana` in `package.json`. HANA-specific type choices are called out inline (no `interval` type → minutes as integer; JSON held as `LargeString`; `bytea` → `LargeBinary`).

---

## 1. What lives where

| Data | Home | Why |
|---|---|---|
| Delivery, SO, addresses, HU weights | ECC (read via CDS, live) | ECC's document, not ours |
| Shipments, tracking, events, labels | HANA (courier HDI container) | The courier domain |
| Carrier URLs + API keys | **BTP Destination service — NEVER the database** | Security S1: URL and credential bound |
| Carrier non-secret config | HANA `Carriers` | Business-editable, audited |
| Email/notification state | HANA `Notifications` | Idempotency + bounce log |
| PII (name, address, email) | HANA `Shipments` snapshot | Needed on the label + email; retention applies (§4) |

## 2. Schema — CDS entities

> These compile to HANA tables via `cds build` / `cds deploy`. The `@assert.unique` annotations generate the unique indexes that enforce the security guards (S4, S6, dedupe).

```cds
namespace courier;

// ── Carrier setup (NON-SECRET only) ─────────────────────────────
entity Carriers {
  key carrier_id   : String(20);               // 'NZPOST', 'FEDEX', ...
  display_name     : String(100)  not null;
  destination_name : String(200)  not null;    // BTP destination holding URL + credential (never the URL itself)
  label_format     : String(10)   not null  default 'ZPL';
  status_map       : LargeString;              // JSON: carrier vocab -> canonical enum (HANA has no jsonb; JSON as text)
  active           : Boolean      not null  default true;
}

entity CarrierAccounts {
  key carrier_id : String(20);                 // -> Carriers.carrier_id
  key bukrs      : String(4);                  // company code (region)
  key valid_from : Date;
  account_ref    : String(40)  not null;       // contract/account no. — APP CONFIG (Open Item #2: provided into the app, not read from ECC)
  valid_to       : Date;
  currency       : String(3)   not null;
  active         : Boolean     not null default true;
}

entity Routes {
  key werks        : String(4);                // plant
  key dest_country : String(4);                // ISO2, or 'DOM' / 'INTL'
  key carrier_id   : String(20);               // -> Carriers.carrier_id
  priority         : Integer   not null default 1;
  cutoff_local     : Time;                     // carrier pickup cutoff at this plant
  active           : Boolean   not null default true;
}

// ── THE core table. One row per parcel (per HU). ────────────────
@assert.unique.doubleBooking: [ vbeln, exidv ]   // ⚠ THE double-booking guard (S4)
entity Shipments {
  key ID              : UUID;                   // surrogate (replaces bigint identity)
  vbeln               : String(10)   not null;  // SAP delivery
  exidv               : String(20)   not null;  // SAP handling unit
  werks               : String(4)    not null;  // plant (EVERY read filters on this)
  bukrs               : String(4)    not null;
  so_number           : String(10)   not null;  // LIPS-VGBEL (customer-facing)
  carrier_id          : String(20)   not null;  // -> Carriers.carrier_id
  service_code        : String(40)   not null;
  tracking_number     : String(60)   not null;
  carrier_shipment_id : String(60);             // carrier's own id (for void/matching)
  is_primary          : Boolean      not null default true;  // master tracking for multi-HU
  rate_quoted         : Decimal(12,2) not null;
  rate_billed         : Decimal(12,2);          // filled by invoice reconciliation (phased)
  currency            : String(3)    not null;
  label_bytes         : LargeBinary;            // OUR copy. Never the carrier URL. (S2)
  label_format        : String(10)   not null default 'ZPL';
  status              : String(20)   not null default 'booked';
                        // booked|printed|pgi|in_transit|delivered|exception|voided
  // customer snapshot (PII — retention applies, §4)
  ship_to_name        : String(200)  not null;
  ship_to_email       : String(255);
  ship_to_country     : String(2)    not null;
  // lifecycle timestamps (record ALL from day 1 — monitoring depends on them)
  packed_at           : Timestamp;
  booked_at           : Timestamp    not null  @cds.on.insert: $now;
  printed_at          : Timestamp;
  pgi_at              : Timestamp;
  first_scan_at       : Timestamp;
  created_by          : String(255)  not null;  // from JWT
}
// Secondary indexes (webhook + worklist paths) as native .hdbindex / @sql.append:
//   Shipments(tracking_number)   — webhook join path
//   Shipments(vbeln)
//   Shipments(werks, status)

// ── Idempotency for /book retries ───────────────────────────────
entity BookingIdempotency {
  key idempotency_key : String(100);
  vbeln               : String(10)   not null;
  response            : LargeString  not null;  // JSON
  created_at          : Timestamp    not null  @cds.on.insert: $now;
}

// ── Raw webhook events (append-only) ────────────────────────────
@assert.unique.event: [ tracking_number, event_type_raw, event_ts ]  // dedupe (replay/retry guard)
entity ShipmentEvents {
  key ID          : UUID;
  carrier_id      : String(20)  not null;
  tracking_number : String(60)  not null;
  event_type_raw  : String(60)  not null;       // carrier's own word
  event_type      : String(40)  not null;       // canonical enum ('unknown' if unmapped — fail closed, S6)
  event_ts        : Timestamp   not null;
  payload         : LargeString not null;        // JSON
  received_at     : Timestamp   not null  @cds.on.insert: $now;
  processed       : Boolean     not null default false;
}

// ── Email idempotency + bounce log. DO-level: one email per delivery. (PII-bearing.) ──
entity Notifications {
  key vbeln   : String(10);
  email       : String(255)  not null;
  sent        : Boolean      not null default false;  // claim via UPDATE..WHERE sent=false, check rowcount
  sent_at     : Timestamp;
  bounced     : Boolean      not null default false;
  bounce_info : String(500);
}

entity Printers {
  key werks    : String(4);
  key station  : String(40);
  printer_name : String(100)  not null;         // as BrowserPrint sees it
  is_default   : Boolean      not null default false;
}

// ── Audit for dangerous actions: void, override, config change, role change (S8) ──
// Append-only: application role gets INSERT/SELECT only, no UPDATE/DELETE (enforce in service).
entity AuditLog {
  key ID  : UUID;
  actor   : String(255)  not null;              // from JWT
  action  : String(40)   not null;
  object  : String(200)  not null;
  before  : LargeString;                         // JSON
  after   : LargeString;                         // JSON
  at      : Timestamp    not null  @cds.on.insert: $now;
}

entity SlaThresholds {
  key werks          : String(4);
  key state          : String(20);              // packed|booked|printed|pgi
  warn_after_min     : Integer  not null;       // HANA has no interval type -> minutes
  escalate_after_min : Integer  not null;       // minutes
}
// Populate AFTER >=1 month of observed timestamps (p95). Do not guess values.
```

**HANA / CDS conversion notes (vs. the original Postgres DDL):**

- `bigint GENERATED ALWAYS AS IDENTITY` surrogate keys → `UUID` (CAP-native). Business uniqueness is preserved by the `@assert.unique` guards — which is what S4/S6 actually depend on, not the surrogate type.
- `jsonb` → `LargeString` holding JSON (HANA has no `jsonb`; use HANA JSON functions when querying).
- `bytea` → `LargeBinary` (BLOB) for `label_bytes`.
- `timestamptz` → `Timestamp`; `now()` defaults → `@cds.on.insert: $now`.
- `interval` (SLA windows) → `Integer` minutes (HANA has no `interval` type).
- `UNIQUE(...)` → `@assert.unique.<name>` (enforced at the service layer AND as a unique DB index).
- Secondary (non-unique) indexes are added as native `.hdbindex` artifacts / `@sql.append`, since CDS entity syntax models keys and unique constraints only.

## 3. Access-layer rule (security H3 — enforce in code structure)

All `Shipments` reads go through ONE repository module that REQUIRES the allowed-plants list (from the JWT `werks` attribute). There is no query path without it:

```javascript
// The only exported query path. There is no variant without plants.
const cds = require('@sap/cds')
module.exports = function forPlants(plants) {            // plants = req.user's werks list
  const { Shipments } = cds.entities('courier')
  return {
    byVbeln:    (v) => SELECT.from(Shipments).where({ vbeln: v,             werks: { in: plants } }),
    byTracking: (t) => SELECT.from(Shipments).where({ tracking_number: t,  werks: { in: plants } }),
    // ... every accessor injects `werks in plants`
  }
}
```

A developer must not be ABLE to write an unscoped shipment query. Enforce structurally: parcel-data handlers go through this module, and CAP service handlers add the plant `where` (S3). The webhook worker uses an internal system scope — the one documented exception, and it never returns data to a user.

## 4. PII & retention (security S9, S10)

- `Shipments` (name, email, label bytes) and `Notifications` are PII-bearing.
- Retention: **PENDING business decision** (Open Item — propose 24 months, confirm with legal/finance for tax needs). Build the purge job in Phase 1 with the window configurable; do not defer the job itself.
- Purge = delete rows past window in `Shipments` (or null the PII columns + `label_bytes` if financial fields must survive longer) + matching `Notifications`.
- **No PII in logs**: log `vbeln` / `Shipments.ID`, never name/address/email/label content. Error middleware must scrub. Test S9.
- **HANA Cloud** backup/restore/DR must exist before go-live — this is now a system of record. ⚠️ The free `hana-free` plan auto-stops when idle and carries no DR SLA, so a production go-live needs a paid HANA Cloud plan.
