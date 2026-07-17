# 09 — Courier Booking: Data Model

> **Prereq:** 07-PRD, 08-TRD.
> **Contains:** Complete Postgres schema (DDL), plus what deliberately does NOT live here.
> **Rule:** Postgres is the courier system of record. ECC data is read live via CDS, never replicated wholesale.

---

## 1. What lives where

| Data | Home | Why |
|---|---|---|
| Delivery, SO, addresses, HU weights | ECC (read via CDS, live) | ECC's document, not ours |
| Shipments, tracking, events, labels | Postgres | The courier domain |
| Carrier URLs + API keys | **BTP Destination service — NEVER Postgres** | Security S1: URL and credential bound |
| Carrier non-secret config | Postgres `carriers` | Business-editable, audited |
| Email/notification state | Postgres | Idempotency + bounce log |
| PII (name, address, email) | Postgres `shipments` snapshot | Needed on the label + email; retention applies (§4) |

## 2. Schema (DDL)

```sql
-- Carrier setup (NON-SECRET only)
CREATE TABLE carriers (
  carrier_id      text PRIMARY KEY,           -- 'NZPOST', 'FEDEX', ...
  display_name    text NOT NULL,
  destination_name text NOT NULL,             -- BTP destination holding URL+credential
  label_format    text NOT NULL DEFAULT 'ZPL',
  status_map      jsonb NOT NULL DEFAULT '{}',-- carrier vocab -> canonical enum
  active          boolean NOT NULL DEFAULT true
);

CREATE TABLE carrier_accounts (
  carrier_id  text REFERENCES carriers,
  bukrs       text NOT NULL,                  -- company code (region)
  account_ref text NOT NULL,                  -- contract/account no. (synced from ECC ZI_CarrierContract)
  valid_from  date, valid_to date,
  currency    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (carrier_id, bukrs, valid_from)
);

CREATE TABLE routes (
  werks        text NOT NULL,
  dest_country text NOT NULL,                 -- ISO2, or 'DOM' / 'INTL'
  carrier_id   text REFERENCES carriers,
  priority     int  NOT NULL DEFAULT 1,
  cutoff_local time,                          -- carrier pickup cutoff at this plant
  active       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (werks, dest_country, carrier_id)
);

-- THE core table. One row per parcel (per HU).
CREATE TABLE shipments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vbeln            text NOT NULL,             -- SAP delivery
  exidv            text NOT NULL,             -- SAP handling unit
  werks            text NOT NULL,             -- plant (EVERY read filters on this)
  bukrs            text NOT NULL,
  so_number        text NOT NULL,             -- LIPS-VGBEL (customer-facing)
  carrier_id       text NOT NULL REFERENCES carriers,
  service_code     text NOT NULL,
  tracking_number  text NOT NULL,
  carrier_shipment_id text,                   -- carrier's own id (for void/matching)
  is_primary       boolean NOT NULL DEFAULT true, -- master tracking for multi-HU
  rate_quoted      numeric(12,2) NOT NULL,
  rate_billed      numeric(12,2),             -- filled by invoice reconciliation (phased)
  currency         text NOT NULL,
  label_bytes      bytea,                     -- OUR copy. Never the carrier URL. (S2)
  label_format     text NOT NULL DEFAULT 'ZPL',
  status           text NOT NULL DEFAULT 'booked',
                   -- booked|printed|pgi|in_transit|delivered|exception|voided
  -- customer snapshot (PII — retention applies, §4)
  ship_to_name     text NOT NULL,
  ship_to_email    text,
  ship_to_country  text NOT NULL,
  -- lifecycle timestamps (record ALL from day 1 — monitoring depends on them)
  packed_at        timestamptz,
  booked_at        timestamptz NOT NULL DEFAULT now(),
  printed_at       timestamptz,
  pgi_at           timestamptz,
  first_scan_at    timestamptz,
  created_by       text NOT NULL,             -- from JWT
  UNIQUE (vbeln, exidv)                       -- ⚠ THE double-booking guard (S4)
);
CREATE INDEX ix_shipments_tracking ON shipments (tracking_number); -- webhook join path
CREATE INDEX ix_shipments_vbeln    ON shipments (vbeln);
CREATE INDEX ix_shipments_werks    ON shipments (werks, status);

-- Idempotency for /book retries
CREATE TABLE booking_idempotency (
  idempotency_key text PRIMARY KEY,
  vbeln           text NOT NULL,
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Raw webhook events (append-only)
CREATE TABLE shipment_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id      text NOT NULL,
  tracking_number text NOT NULL,
  event_type_raw  text NOT NULL,              -- carrier's own word
  event_type      text NOT NULL,              -- canonical enum ('unknown' if unmapped — fail closed, S6)
  event_ts        timestamptz NOT NULL,
  payload         jsonb NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed       boolean NOT NULL DEFAULT false,
  UNIQUE (tracking_number, event_type_raw, event_ts)  -- dedupe (replay/retry guard)
);

-- Email idempotency + bounce log. DO-level: one email per delivery. (PII-bearing.)
CREATE TABLE notifications (
  vbeln       text PRIMARY KEY,
  email       text NOT NULL,
  sent        boolean NOT NULL DEFAULT false, -- claim via UPDATE..WHERE sent=false, check rowcount
  sent_at     timestamptz,
  bounced     boolean NOT NULL DEFAULT false,
  bounce_info text
);

CREATE TABLE printers (
  werks        text NOT NULL,
  station      text NOT NULL,
  printer_name text NOT NULL,                 -- as BrowserPrint sees it
  is_default   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (werks, station)
);

-- Audit for dangerous actions: void, override, config change, role change (S8)
CREATE TABLE audit_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor     text NOT NULL,                    -- from JWT
  action    text NOT NULL,
  object    text NOT NULL,
  before    jsonb,
  after     jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
-- Append-only: application role gets INSERT/SELECT only, no UPDATE/DELETE.

CREATE TABLE sla_thresholds (
  werks          text NOT NULL,
  state          text NOT NULL,               -- packed|booked|printed|pgi
  warn_after     interval NOT NULL,
  escalate_after interval NOT NULL,
  PRIMARY KEY (werks, state)
);
-- Populate AFTER >=1 month of observed timestamps (p95). Do not guess values.
```

## 3. Access-layer rule (security H3 — enforce in code structure)

All `shipments` reads go through ONE repository function that REQUIRES the allowed-plants list:

```typescript
// The only exported query path. There is no variant without plants.
export function forPlants(plants: string[]) {
  return {
    byVbeln: (v) => sql`SELECT ... WHERE vbeln=${v} AND werks = ANY(${plants})`,
    byTracking: (t) => sql`SELECT ... WHERE tracking_number=${t} AND werks = ANY(${plants})`,
    // ...
  };
}
```

A developer must not be ABLE to write an unscoped shipment query. Webhook worker uses an internal system scope — the one documented exception, and it never returns data to a user.

## 4. PII & retention (security S9, S10)

- `shipments` (name, email, label bytes) and `notifications` are PII-bearing.
- Retention: **PENDING business decision** (Open Item — propose 24 months, confirm with legal/finance for tax needs). Build the purge job in Phase 1 with the window configurable; do not defer the job itself.
- Purge = delete rows past window in `shipments` (or null the PII columns + label_bytes if financial fields must survive longer) + matching `notifications`.
- **No PII in logs**: log `vbeln`/`shipment.id`, never name/address/email/label content. Error middleware must scrub. Test S9.
- Postgres backup/restore/DR must exist before go-live — this is now a system of record.
