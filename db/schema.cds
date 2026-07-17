// Courier domain schema — source of truth: docs/09-Courier-Data-Model.md §2.
// Deployed as an HDI container on SAP HANA Cloud (hana / hdi-shared) via @cap-js/hana.
// Secrets NEVER live here (docs/00-INDEX rule 4): Carriers holds destination NAMES only.
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
  account_ref    : String(40)  not null;       // contract/account no. (synced from ECC ZI_CarrierContract)
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
  // customer snapshot (PII — retention applies, docs/09 §4; purge job = task 1.14)
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
// Secondary indexes (webhook + worklist paths) live in db/src/*.hdbindex:
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
  payload         : LargeString not null;       // JSON
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
  before  : LargeString;                        // JSON
  after   : LargeString;                        // JSON
  at      : Timestamp    not null  @cds.on.insert: $now;
}

entity SlaThresholds {
  key werks          : String(4);
  key state          : String(20);              // packed|booked|printed|pgi
  warn_after_min     : Integer  not null;       // HANA has no interval type -> minutes
  escalate_after_min : Integer  not null;       // minutes
}
// Populate AFTER >=1 month of observed timestamps (p95). Do not guess values.
