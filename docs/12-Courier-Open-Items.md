# 12 — Courier Booking: Open Items Register

> **Rule for the agent:** Before starting any task, check whether it is gated by an item below. If gated and UNANSWERED — STOP, surface the item, do not guess.
> **Rule for humans:** Each is a 5-minute-to-1-hour lookup. Answer them, record the answer here, commit.

---

| # | Question | How to answer | Blocks | Status | Answer |
|---|---|---|---|---|---|
| 1 | Is `MARC-STAWN` (HS code) populated across the product range? And `MARC-HERKL` (origin)? | SE16 on MARC, count non-blank STAWN vs total for shipped materials | **Phase 4 (all international)** | ❌ OPEN | |
| 2 | Where does the carrier contract/account number live in SAP? | XK03 on one carrier vendor: check LFB1-EIKTO (company-code data), Z-fields, or ME33K outline agreements. If nowhere — create Z-table + SM30 view | Task 1.6 (`ZI_CarrierContract` source) | ❌ OPEN | |
| 3 | How to select the email from ADR6 for CPD addresses — is FLGDEFAULT set, or filter CONSNUMBER='001'? | SE16 on ADR6 for ~10 recent one-time deliveries' ADRNRs | Task 1.2 (CDS view filter). **Wrong = zero emails, silently** | ✅ CLOSED | **Answered by Teru (2026-07-17):** delivery → VBPA with partner function WE (SH) yields exactly ONE address number, and a CPD address number carries exactly ONE ADR6 row — select by ADDRNUMBER alone, no CONSNUMBER/FLGDEFAULT filter. Defensive note for 1.2: keep the join deterministic anyway (e.g. lowest CONSNUMBER) so a surprise second row can never fan out the delivery. Doc 08 §4.1 updated in the same commit. |
| 4 | Is each plant's T001W→ADRC address the physical dispatch dock, or a registered office? | OX10 / ADRC per plant, confirm with warehouse | Task 1.2 / Phase 3 per region. Wrong = wrong rates + wrong pickup | ❌ OPEN | |
| 5 | Is customs declared value = LIPS-NETWR, or different (samples, discounts, free goods)? Which Incoterm does e-commerce sell on? | Ask whoever does export docs today; check LIKP-INCO1 on past international DOs | Phase 4 | ❌ OPEN | |
| 6 | Does e-commerce already send shipping/tracking emails? | Ask e-commerce team | Task 1.13 content/ownership — avoid duplicate customer comms. If e-comm owns comms, consider pushing tracking to e-comm instead of emailing directly | ❌ OPEN | |
| 7 | Do the regions ship internationally at all, or domestic-only per region? | Business | Whether Phase 4 exists | ❌ OPEN | |
| 8 | How does Finance handle carrier invoices today? (Process, reconciliation, accrual vs invoice-time, cost-object allocation, CSV/EDI availability) 🔶 **Teru checking** | Finance interview — question list in design doc §14 | Phase 3b scope; whether variance reporting is wanted at all; whether any cost must flow to ECC (would be a design change) | ❌ OPEN | |
| 9 | Does anyone need DIFFERENT permissions in DIFFERENT plants (e.g. book in NZ, view-only AU)? | Business / line managers | 10-Security §1.2 | ✅ CLOSED | **Resolved by design decision:** plant baked into role collections as static values. Per-plant permissions now expressible (Dispatcher_NZ + Support_AU). See 10-Security §1.2 for residual scope-union note. |
| 10 | Can the identity team maintain a custom `werks` attribute per user in Entra, and is there a process for it? | Identity/Entra team | 10-Security §1 | ✅ CLOSED | **Not needed.** Decision: static werks per role collection, no IdP attribute, no CIS claim mapping. Entra/CIS used for authentication only. Cockpit check confirmed CIS trust config (origin `sap.custom`) attribute mapping is blank — never needs filling. |
| 11 | PII retention window (proposed 24 months — confirm against tax/legal requirements per region) | Legal/Finance | Purge job config (1.14 / S10) — job is built regardless, window is config | ❌ OPEN | |
| 12 | Do all six carriers offer webhooks, or do some require polling? | Each carrier's API docs during onboarding | Per-carrier webhook tasks in Phase 2 — a polling-only carrier needs a poller variant | ❌ OPEN | |
| 13 | Approximate weekly parcel volume per region | Business | Sequencing of Phase 3; aggregator-vs-direct economics if ever revisited | ❌ OPEN | |

---

## How to close an item

1. Get the answer. 2. Fill the Answer column, flip Status to ✅. 3. If the answer contradicts docs 07–11, update the affected doc in the same commit. 4. Unblock the gated tasks.

## Items already decided (do not reopen)

- Clean core / ECC read-only — decided, constraint #1 in PRD
- Courier domain wholly on BTP/HANA — decided
- Email trigger = first pickup scan — decided
- BrowserPrint client-side printing — decided (pending only the 0.1 spike passing)
- Direct carrier integrations behind a provider interface, aggregator swappable — decided
- No BPA, no RPA, no PO-per-parcel — decided (PRD §10)
