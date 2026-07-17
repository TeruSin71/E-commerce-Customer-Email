# 07 — Courier Booking: Product Requirements (PRD)

> **Audience:** AI agent + human developers executing this project.
> **Status:** Design approved. Blocked items listed in `12-Courier-Open-Items.md`.
> **Read order:** This doc first, then 08 (TRD), 09 (Data Model), 10 (Security), 11 (Implementation Plan), 12 (Open Items).

---

## 1. What we are building

A courier booking system. It takes packed deliveries from SAP ECC, gets shipping quotes from carriers, books the shipment, prints the label, tracks the parcel, and emails the customer when the carrier picks it up.

## 2. What problem it solves

Today: warehouse staff manually key addresses into carrier web portals, print labels, and type tracking numbers back into SAP. ~4 minutes per parcel, transcription errors, no rate comparison, no tracking visibility.

Target: ~20 seconds per parcel, rate shopping, automatic tracking, automatic customer notification.

## 3. Business context (facts, do not re-derive)

| Fact | Value |
|---|---|
| Regions | NZ, AU, US, CA — each with own plant, company code, sales area |
| Region independence | Each region operates independently. No cross-region reporting required. |
| Carriers | 2–3 per region. FedEx/UPS overlap AU+US+CA — ~6 total integrations |
| Order source | E-commerce platform → SAP ECC (creates SO) |
| Customers | ALL one-time (CPD). No customer master. Address unique per transaction (unique ADRNR every time). |
| Email | Mandatory field in e-commerce. Always present, format-validated upstream. |
| Parcel split | 90% of deliveries = 1 handling unit (HU). 10% = multiple HUs. |
| Volume | Modest — low hundreds of parcels per week per region (unconfirmed; see Open Items) |
| SAP version | ECC, on HANA-capable Gateway, mid-migration to S/4 |
| Carrier contracts | We hold negotiated contracts with all carriers |

## 4. Non-negotiable constraints

1. **Clean core.** SAP ECC is read-only. No Z-tables, no ABAP enhancements, no writes to standard tables, no `LIKP-TRAID` stamp, no IDoc back. The entire courier domain lives on BTP.
2. **Carrier credentials never reach a browser.** All carrier API calls originate server-side.
3. **Customer email triggers on the carrier's first pickup scan** — never at booking time.
4. **Every endpoint returning parcel data enforces plant scope from the JWT** — reads AND writes. See `10-Courier-Security.md`.

## 5. In scope

- Fiori dispatcher app (worklist → rate → book → print) in Work Zone
- Fiori shipment lookup tile (support: search, status, event history, reprint)
- Fiori carrier setup tile (system admin)
- Courier dashboard tile (counts, stuck items, variance)
- `courier-srv` backend on BTP Cloud Foundry (Node.js)
- Postgres on BTP (courier system of record)
- Carrier integrations: NZ Post first, then FedEx, then remaining (~6 total). Aggregator (EasyPost) remains a swappable option per lane — architecture supports both.
- Webhook receiver for carrier tracking events
- Customer email on pickup (Microsoft Graph API)
- Label printing via Zebra BrowserPrint (client-side)
- Invoice reconciliation — **phased, manual-first** (see 11-Implementation, Phase 3b; pending Finance confirmation, Open Item #8)
- Monitoring: state timestamps, tile badges, threshold alerts (instrument first, alert later)

## 6. Out of scope

- Writing anything back to SAP ECC
- SAP shipment costing (VT01N/VI01) — conflicts with clean core
- PO-per-parcel AP flow
- Cross-region consolidated reporting
- AI-based address validation (use carrier address-verify APIs instead)
- E-commerce platform changes

## 7. Users and roles (summary — full spec in 10-Security)

| Role | Does | Scope |
|---|---|---|
| Dispatcher | Worklist, rate, book, print, reprint | Own plant |
| Supervisor | + void, override carrier | Own plant |
| Support | View, reprint only. Cannot book. | Own plant(s) |
| System admin | Carrier/printer/route config | Own region |
| Super user | Assign roles | Global. Cannot book. Cannot config. |

Plant assignment = **static value baked into per-region role collections** (`Courier_Dispatcher_NZ` etc., ~17 collections). Entra/CIS handles authentication only — no custom IdP attributes. One user may hold multiple collections (scopes and plants union). Full spec + rationale in 10-Security §1.

## 8. The end-to-end flow (canonical — all components serve this)

```
 1. Customer buys on e-commerce — email captured
 2. E-commerce → SAP ECC → Sales Order (SO)
 3. ECC → Delivery (DO) → pick → pack → Handling Unit (HU) with REAL weight+dims
 4. Dispatcher app shows DO (filter: picked → packed → not PGI'd, plant-scoped)
 5. Staff clicks DO → rate call to carrier (real HU weight, our contract) → options shown
 6. Staff books → carrier returns tracking number + label
 7. Label prints via BrowserPrint → sticker on box
 8. Staff does PGI in SAP (ECC's own step — not ours)
 9. Carrier collects, scans → webhook → courier-srv
10. First pickup scan → ONE email to customer (SO number + tracking link; never DO number)
11. Carrier invoice arrives weekly/monthly → variance vs quote (phased)
```

## 9. Success criteria

- Booking a single-HU domestic parcel takes < 30 seconds of staff time
- Zero carrier credentials in any browser-delivered code
- Customer email sent within 15 minutes of first carrier scan, exactly once per DO
- A support user in one plant cannot read another plant's parcel data (test: S3 in 10-Security)
- Double-booking is impossible at the database level (test: S4)
- NZ domestic live before any other region or lane

## 10. Explicitly rejected approaches (do not resurrect)

| Rejected | Why |
|---|---|
| Carrier API called from Fiori/browser | Credential exposure — anyone with DevTools can spend our money |
| Email from Fiori (Resend/SMTP/Graph direct) | Browser closed at pickup time; key exposure |
| SAP BPA for email | Cannot receive/verify carrier webhooks; needs an adapter = the server we were avoiding |
| RPA for email | Screen automation to avoid an API; brittle; still needs a trigger |
| Z-table / TRAID stamp in ECC | Clean core |
| RFC_READ_TABLE | Raw table access, no contract, security red flag |
| Carrier URLs stored in Postgres | SSRF / credential exfiltration (security review H1) |
| Storing carrier's label URL | Unauthenticated PII exposure (security review H2) |
| PO per parcel | ~1,000 POs/month, no control value |
| Notifications on every booking | Alert fatigue; exceptions only |
