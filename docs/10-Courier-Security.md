# 10 — Courier Booking: Security & Authorization

> **Prereq:** 07-PRD, 08-TRD, 09-Data-Model.
> **Source:** Design security review (threat model). Findings incorporated below.
> **Rule:** S1–S4 are BUILD-BLOCKING. Write each test first, watch it fail, then implement.

---

## 1. The authorization model

**DECIDED: plant is baked into role collections as a STATIC attribute value.** No IdP attribute, no Entra custom attribute, no CIS claim mapping. (Closes Open Items #9 and #10.)

```
Entra/CIS:  authentication ONLY (corporate email login via origin sap.custom)
XSUAA:      role collections carry scopes + a STATIC werks value per region
     ↓
JWT:        scope[] + xs.user.attributes.werks[]   (union across the user's roles)
     ↓
courier-srv: validates token, checks scope, filters by plant — ON EVERY ROUTE
```

### 1.1 Non-negotiable rules

1. **Validate before reading.** Every request: `@sap/xssec` validates signature/issuer/audience/expiry BEFORE any claim is read (S7). Unvalidated → 401, no logic runs.
2. **Plant from token only.** `req.authInfo.getAttribute('werks')`. NEVER from query/body/header. A client-supplied plant that isn't in the token → 403.
3. **Scope + plant on EVERY route that touches parcel data** — reads included: worklist, lookup, dashboard, reprint, label download (H3/S3). Not just `/book`.
4. **XSUAA enforces nothing by itself.** It only mints tokens. Every check is code we write. Missing check = open endpoint.

### 1.2 Role collections (per-region, static werks)

One role TEMPLATE per role type in xs-security.json; N roles instantiated in the cockpit with a static `werks` value; bundled into per-region collections.

| Role collection pattern | Scopes | werks (static) |
|---|---|---|
| Courier_Dispatcher_{NZ\|AU\|US\|CA} | view, rate, book, print, reprint | 1000 / 2000 / 3000 / 4000 |
| Courier_Supervisor_{region} | + void, override | per region |
| Courier_Support_{region} | view, reprint | per region |
| Courier_SysAdmin_{region} | config | per region |
| Courier_SuperUser | (role assignment via cockpit) | — |

~17 collections total. Naming discipline: `Courier_<Role>_<Region>`, fixed at creation.

- **Multiple roles per user:** scopes AND werks values union. A user with Dispatcher_NZ + Support_AU gets book-capable scopes and werks=[1000,2000] — BUT because each role carries its own static plant, the per-plant permission combination "book in NZ, view-only in AU" IS correctly expressible: assign Dispatcher_NZ + Support_AU. The union limitation from the earlier IdP-attribute design no longer applies in the same way; note the residual: scopes still union globally, so this pairing technically permits book on 2000 at the scope level — the mitigation is convention (don't pair Dispatcher_X with Support_Y for the same user unless acceptable) documented in 13-User-Admin.
- **Multi-plant users:** assign multiple regional collections. UI plant-switcher narrows WITHIN the token list, never widens.
- **Segregation of duties:** SuperUser must NOT hold book/config. SysAdmin must NOT hold role_admin. Enforce in collection design; verify in review.
- **Assignment gotcha:** users appear once per identity provider origin. Assign collections to the `sap.custom` (CIS) user record, NOT `sap.default`. Wrong row = silent no-access. Runbook in 13-User-Admin.

## 2. Threat-model findings — design responses

| ID | Finding | Design response |
|---|---|---|
| H1 | SSRF/credential exfil via admin-editable carrier URLs | URLs live ONLY in BTP destinations, bound to their credential. HANA `Carriers.destination_name` references a destination; it never holds a URL. Provider code refuses non-destination URLs; deny private/link-local ranges. |
| H2 | Label = PII, carrier URL fetchable unauthenticated | Download label bytes at booking, store in `shipments.label_bytes`, serve ONLY via authenticated `/label/:id` with scope+plant. Carrier URL never stored/returned. Reprint is NOT a "safe" scope. |
| H3 | Lookup IDOR across plants (sequential tracking numbers) | Repository pattern: the only shipment query path requires the plants list (09 §3). Test cross-plant read → 403. |
| M1 | Double-book race | DB UNIQUE (vbeln,exidv) + ON CONFLICT + idempotency key. Never check-then-write. |
| M2 | Webhook replay + public-route DoS | Signed timestamp ±5min; body cap 256KB; per-source rate limit; bounded async queue. |
| M3 | void under-specified | Same scope+plant guard as book, + immutable audit row. |
| M4 | JWT validation assumed | Stated in §1.1.1. `@sap/xssec` wired on every route; test with forged/expired tokens. |
| M5 | PII retention/logging | 09 §4: retention window + purge job in Phase 1; PII scrubbed from logs; notifications is PII-bearing. |
| L1 | SQL injection in monitoring queries | All queries parameterized. No string-built SQL anywhere. |
| L2 | Invoice file = untrusted input | Size limits, malformed-row handling, formula-injection guard (cells starting with = + - @). |
| L3 | Unknown carrier status drives behavior | Fail closed: unmapped status → store as 'unknown', alert, NO email/state change. |
| L4 | ECC technical user over-privileged | Authorize ONLY the 3 CDS OData services. Verify no write/RFC capability. |
| L5 | Secret rotation | Rotation via destination service; document in-flight-booking behavior during rotation. |
| — | Carrier RESPONSE content untrusted (our addition) | Validate shape/length of tracking numbers & status strings before store; escape before render/email. |

## 3. Acceptance criteria — each is a test

### 🔴 Build-blocking

- **S1** — Change a `carriers` row to reference a hostile URL/destination → provider refuses; call to private IP range → refused. Credentials only ever sent to destination-service URLs.
- **S2** — `/label/:id` without token → 401; with wrong-plant token → 403. Grep codebase: no carrier label URL is ever stored or returned.
- **S3** — Token werks=[1000]; request shipment with werks=2000 via EACH of: /shipments (by vbeln, by tracking, by SO), /dashboard, /reprint, /label → all 403/empty.
- **S4** — Two concurrent /book for same (vbeln,exidv) → exactly ONE carrier call, one row, second request receives the first booking. Same with duplicate idempotencyKey after timeout.

### 🟠 Before go-live

- **S5** — Replayed webhook (valid sig, old timestamp) → 401. 300KB body → 413. Flood → rate-limited; queue depth bounded.
- **S6** — Webhook with never-seen status string → stored as 'unknown', alert raised, no email, no shipment status change.
- **S7** — Expired token → 401. Wrong-audience token → 401. Tampered signature → 401. All BEFORE any handler logic (assert via logging/ordering).
- **S8** — void, override, config PUT, role change each produce an audit_log row (actor, before, after). App DB role cannot UPDATE/DELETE audit_log.
- **S9** — Force an exception mid-/book with real-shaped data → inspect logs/monitoring: no name, address, email, or label bytes present.
- **S10** — Purge job deletes/nulls PII past the retention window, including notifications. Runs on schedule; verified by test fixture with backdated rows.

### 🟡 Confirm during build

- **S11** — Property test: hostile tracking-number/status strings (HTML, oversized, control chars) are rejected or stored inert and render escaped in UI + email.
- **S12** — ECC technical user: attempt any write/other service → authorization failure. Documented evidence from Basis.
- **S13** — Invoice parser: oversized file, malformed rows, `=cmd()` cells → handled/neutralized.
- **S14** — Rotation runbook exists; rotating a carrier secret mid-day does not orphan in-flight bookings.
