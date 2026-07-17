# End-to-End: Courier Booking System

**SAP ECC → BTP → Carriers**
Design summary, plain terms.

---

## 1. THE BASIC IDEA

| | |
|---|---|
| **SAP ECC** | The warehouse system. Knows what's packed and where it's going. We only **read** from it. |
| **BTP** | Where our new app lives. Does all the courier work. |
| **Carriers** | NZ Post, FedEx, etc. We call them. They call us back. |

**The rule:** ECC stays untouched (clean core). We read from it. Nothing goes back.

---

## 2. THE SETUP

- **4 regions:** NZ, AU, US, CA
- Each has its own plant, company code, staff, carriers
- **Each region runs independently**
- 2–3 carriers per region (FedEx/UPS cover AU+US+CA — integrate once, use three times)
- Orders come from e-commerce → SAP
- All customers are **one-time (CPD)** — no customer master record
- **90%** of deliveries = 1 box. **10%** = multiple boxes.

---

## 3. THE ENTRY POINT — WORK ZONE

Staff open their browser → **Work Zone launchpad** → already logged in (SSO from Entra) → they see only the tiles their role allows.

### The tiles

| Tile | Who sees it | What it does |
|---|---|---|
| **Courier Dispatch** | Dispatcher, Supervisor | The worklist. Book and print. |
| **Shipment Lookup** | Support + everyone above | "What happened to parcel X?" |
| **Carrier Setup** | System admin | Carriers, routes, printers |
| **Courier Dashboard** | Supervisor, System admin | Counts, stuck items, variance |

Tile visibility = role collection. Assign `Courier_Dispatcher_<Region>` → the tile appears.

### ⚠️ Work Zone hiding a tile is NOT security

- Work Zone hides the tile — **cosmetic**
- `courier-srv` checks the token — **actual security**

If someone guesses the URL or calls `courier-srv` directly with curl, Work Zone isn't in the way. Every endpoint checks the token itself.

**Tiles are convenience. The server is the guard.**

### What Work Zone gives us free

- Single sign-on
- Tile catalog and navigation shell
- Deep links (bell notification → straight to the filtered worklist)
- Managed approuter (we don't build one for the UI)

---

## 4. WHAT HAPPENS, STEP BY STEP

### Step 1 — Order arrives
- Customer buys online
- E-commerce sends order to SAP → creates SO
- Email captured (mandatory in e-commerce, so always present)
- Customer is one-time — address written per transaction, unique every time

### Step 2 — Warehouse picks and packs
- SAP creates the delivery (DO)
- Staff pick the goods
- Staff pack into box(es) → SAP creates handling units (HU)
- **Real weight and dimensions recorded on the HU**

### Step 3 — Delivery appears in our app
- App reads SAP, shows only deliveries that are **picked → packed → not yet shipped**
- Staff see only their own plant's deliveries
- Shows: order number, customer, address, weight, box count

### Step 4 — Get a price
- Staff clicks the delivery
- App asks the carrier: *"how much to send this box to this address?"*
- Uses **real packed weight** — not order weight, or we get rebilled
- Uses **our contract number** — so we get our negotiated price
- Carrier replies: service options, price, delivery days

### Step 5 — Book it
- Staff picks a service (or a rule picks automatically)
- App tells the carrier: *"book it"*
- Carrier returns **tracking number + label**
- App saves to its own database (SAP HANA Cloud on BTP)

> ⚠️ **This step spends money.** Protected by scope, and can only happen once per delivery.

### Step 6 — Print the label
- Label comes back to the browser
- **BrowserPrint** (small program on the packing PC) sends it to the Zebra printer
- Sticker goes on the box
- **Reprint is free and unlimited** — labels get damaged, and without a free reprint path staff will re-book and we bleed money

### Step 7 — Ship it
- Staff does PGI in SAP (goods issue)
- Box goes to the dock
- Courier collects

### Step 8 — Courier scans it
- Courier scans the box at pickup
- Carrier sends a **webhook** — *"we've got it"*
- Our app receives it, **verifies the signature**, saves it

### Step 9 — Customer gets an email
- **Triggered by the pickup scan** — not by booking
- Why: don't say "it's shipped" while the box is still on the dock
- Shows: **SO number** (what the customer knows), tracking number, tracking link
- **Never shows the DO number**
- **One email per order**, even if 3 boxes

### Step 10 — Invoice arrives
- Carrier bills weekly/monthly — **only for boxes actually scanned**
- Price may differ from quote (reweigh, dimensional weight, surcharges, fuel)
- We compare quoted vs billed — variance report
- Finance codes the invoice (probably no PO needed — confirm with them)

---

## 5. WHY THINGS ARE WHERE THEY ARE

### Why not do everything in Fiori (the browser)?

A browser **cannot**:

| Can't | Why it matters |
|---|---|
| Keep API keys secret | Anyone with DevTools sees them. They spend our money. |
| Receive messages from carriers | Webhooks are inbound. Browsers can't listen. |
| Run when the tab is closed | Pickup happens at 4:30pm. Staff went home. |
| Send email | Browsers don't speak SMTP. |
| Be reliable | It's one laptop, one tab, one shift. |

So we need **one small server** — `courier-srv` on BTP. ~400 lines. It does the three things a browser structurally can't:

1. Hold the secrets
2. Receive the webhooks
3. Send email when nobody's watching

### Why not put anything in SAP?

**Clean core.** No Z-tables, no ABAP, no writes. Makes the S/4 migration painless.

**Trade-off:** staff can't see tracking in `VL03N`. So we build a **lookup tile** instead — better anyway, because it shows carrier, status, event history, and reprint. A bare tracking number in `TRAID` never answered the real question.

---

## 6. THE PIECES

| Piece | What it is | What it does |
|---|---|---|
| **SAP ECC** | Existing system | Read-only. Gives us delivery data. |
| **3 CDS views** | Read-only windows into SAP | Delivery info, plant address, contract number |
| **Cloud Connector** | Secure tunnel | Lets BTP read SAP safely |
| **courier-srv** | Small Node app on BTP | Rates, books, webhooks, email |
| **SAP HANA Cloud** | Database on BTP | Owns all courier data |
| **Fiori dispatcher** | The app staff use | Worklist, book, print |
| **Fiori lookup tile** | Support tool | "What happened to this parcel?" |
| **Work Zone** | Launchpad | Front door, tiles, SSO |
| **BrowserPrint** | On the packing PC | Sends label to printer |

---

## 7. THE 3 THINGS SAP GIVES US

```
1. ZC_CourierDelivery  → order no, customer, address, email,
                          box weight & size
2. ZI_PlantAddress     → where we're shipping FROM (+ company code)
3. ZI_CarrierContract  → our contract number per carrier
```

That's it. **Nothing goes back.**

### How the delivery view is built

```
LIKP  (delivery header)
  → LIPS   (items — HS codes for customs)
  → VEKP   (handling unit — REAL weight + dims)   ← the rating source
  → VBPA   where PARVW = 'WE' (ship-to partner)
  → ADRC   on VBPA-ADRNR    ← NOT KNA1 (one-time customers)
  → ADR6   (email)

SO number → LIPS-VGBEL   (direct pointer, no VBFA join needed)
```

**Filtered server-side:** picked ✓ + packed ✓ + not yet PGI'd, plus plant-scoped by the user's token.

### Clean core exception — documented

Custom CDS used because the released delivery API doesn't expose VEKP weight/dims, which we need for accurate rating. Views are thin (data shape only, no business logic). Revisit at S/4 — the released API may cover it by then.

**Not** RFC read-table — that's reading raw database tables with no contract at all. Worse than what we have.

---

## 8. THE DATABASE (SAP HANA Cloud on BTP)

```
carriers          → which carriers, their settings
carrier_accounts  → our contract numbers (synced from ECC)
routes            → "NZ plant + NZ address = use NZ Post"
shipments         → every parcel: tracking, carrier, price, label
shipment_events   → every scan the carrier sends us
notifications     → who we emailed, when, bounces
printers          → which printer at which packing station
```

### ⚠️ Carrier URLs do NOT go in the database

**The trap:** if the app reads a web address from a database row, then calls it with our secret key attached — a system admin can change that row to point anywhere. Their own server. An internal BTP service. The cloud's own admin interface. Our key goes with it.

**One config row becomes a key-theft tool.**

**The fix — URL and key stay married:**

```
Destination service:   NZPOST_NZ = web address + key    ← locked together
HANA carriers:         service codes, label format,
                       cutoff time, account ref, active flag
```

System admin picks **which destination** to use. They cannot invent a new address. Changing where we send our keys needs BTP access, not a database edit.

**Also:** block private/internal addresses in code, as a second line of defence.

### The shipments table

Keyed on **delivery + handling unit**:

```
vbeln, exidv          → key (delivery + box)
tracking_number       → INDEXED — the only path back from a webhook
carrier_id, service
rate_quoted, currency
rate_billed           → from the invoice, for variance
label_ref             → our own storage, NOT the carrier's URL   ⚠️ see below
status

packed_at             ┐
booked_at             │
printed_at            ├─ the five timestamps everything depends on
pgi_at                │
first_scan_at         ┘
```

> ⚠️ **Secrets never go in the database.** API keys live in the BTP Destination service. HANA holds service codes, formats, account refs — not credentials, not URLs.

### ⚠️ The label is customer data — treat it that way

**A label has the customer's name and full home address printed on it.** That's personal data, not a harmless bit of paper.

**The trap:** if we save the carrier's link to the label and hand it out, anyone with that link can see the customer's address. No login needed. Our security doesn't apply — it's the carrier's website.

**The fix:**
- At booking, **download the label and store it ourselves**
- Never save or return the carrier's link
- Serve labels only through our own endpoint, which checks the user's role and plant every time

**Reprint is not "safe."** Reading a label is reading customer data. It gets the same checks as everything else.

### ⚠️ Booking twice = paying twice

**The trap:** two staff click "Book" at the same moment. Or one person double-clicks. Both requests check "has this been booked?", both see "no", both book. **Two labels. Two charges.**

Just *intending* it to happen once isn't enough — the check and the write aren't a single action.

**The fix:** let the database refuse it.

```sql
unique constraint on (vbeln, exidv)
insert ... on conflict do nothing
```

The second booking bounces off the database, not off a check in the code. Plus an **idempotency key** on the request, so a retry after a timeout returns the *first* booking instead of making a new one.

---

## 9. SWAPPABLE BY DESIGN

The app doesn't care **who** the carrier is:

```
CourierProvider  (a standard plug shape)
 ├─ EasyPost      (aggregator — one API, many carriers)
 ├─ NZ Post       (direct)
 ├─ FedEx         (direct)
 └─ ...
```

A **router** picks the provider from `(plant, destination country)` — read from the `routes` table.

**Change carrier per region = change a config row.** No code change.

Works for: aggregator, direct carriers, or a mix. That decision can be made per region, per lane, and changed later.

---

## 10. HANDLES ALL FOUR CASES

| Case | How |
|---|---|
| **1 box** (90%) | Normal. Simple screen, no box list. |
| **Multiple boxes** (10%) | Same code. Shows box list. N labels, per-label print status. Still **1 email**. |
| **Domestic** | Simple. No customs. |
| **International** | Adds customs data: HS codes, origin country, declared value, Incoterms. Carrier generates the proforma invoice at booking. |

**Note:** the customs *data* feeds the rate call. The proforma *document* comes after booking and prints with the label.

---

## 11. WHO CAN DO WHAT

### The roles

| Role | Can do | Where |
|---|---|---|
| **Dispatcher** | View, rate, book, print, reprint | Own plant |
| **Supervisor** | + void, override carrier | Own plant |
| **Support** | View, reprint — **no booking** | Own plant(s) |
| **System admin** | Set up carriers, printers, routes | Own region |
| **Super user** | Assign roles | — |

### Which scopes actually matter

| Safe | Dangerous |
|---|---|
| view | **book** — spends money |
| rate | **void** — spends/refunds money |
| print | **config** — could redirect spend |
| reprint | **role_admin** — can grant any of the above |

Only 4 need real protection.

### ⚠️ Segregation of duties

- **Super user** can grant roles — must **not** be able to book
- **System admin** can set up carriers — must **not** be able to assign roles

If super user could also book, they could grant themselves anything and use it, unaudited.

### ⚠️ Write down who did the dangerous things

`void`, `override carrier`, `config change`, `role change` — all need an audit record:

```
who, when, what, before, after
```

The first time someone asks *"who changed our FedEx account number?"* or *"who cancelled that shipment?"*, you'll want the answer. These are exactly the actions that can cost money or hide a mistake.

`void` in particular gets the **same guard as book** — scope + plant — because it moves money too.

### Plant assignment

**DECIDED: plant is a STATIC value baked into per-region role collections — NOT an Entra attribute.** Entra/CIS handles **authentication only** (corporate email login via origin `sap.custom`). No custom IdP attribute, no CIS claim mapping. (This closes Open Items #9 and #10 — see `10-Courier-Security.md` §1.)

> An earlier design put `werks` on the Entra user as a custom attribute so one `Courier_Dispatcher` role could serve all regions. It was dropped: the identity team wouldn't own a per-user attribute, and — as the residual limitation below shows — it couldn't express per-plant permissions anyway.

```
Role collections (one per role × region), each carrying its own static werks:
  Courier_Dispatcher_NZ   scopes = [view, rate, book, print, reprint]   werks = 1000
  Courier_Supervisor_NZ   + [void, override]                            werks = 1000
  Courier_Dispatcher_AU   scopes = [view, rate, book, print, reprint]   werks = 2000
  ...

Jane (NZ dispatcher): assign Courier_Dispatcher_NZ
  Token: scopes = [view, rate, book, print, reprint]
         werks  = ["1000"]   ← comes from the collection, not from Entra
```

Naming is fixed: `Courier_<Role>_<Region>` — **~17 collections total**. That multiplication is the accepted cost of the static model: nothing to maintain in Entra, and per-plant permissions become expressible (below). Always assign to the CIS user record (origin `sap.custom`), never `sap.default` — the onboarding gotcha is in `13-Courier-User-Admin.md`.

### Multiple roles, multiple plants

- **Multiple roles** — scopes AND werks values union across the user's collections. Natural, no special handling.
- **Multiple plants** — assign multiple regional collections (e.g. `Courier_Support_NZ` + `Courier_Support_AU` → werks = ["1000", "2000"]). The app's plant switcher **narrows within the allowed list, never widens**.

Who needs multi-plant: support desk, regional supervisor, leave cover.
Who doesn't: a dispatcher physically packing boxes — they're in one warehouse.

### ⚠️ The residual limitation

Because each collection carries its **own** static plant, the combination "book in NZ, view-only in AU" **is** now expressible — assign `Courier_Dispatcher_NZ` + `Courier_Support_AU`. That's the gain over the old Entra-attribute design.

**But scopes still union globally.** At the raw scope level that same pairing technically also permits `book` on 2000:

```
Jane: Courier_Dispatcher_NZ  (scopes: view, rate, book, print, reprint; werks 1000)
      Courier_Support_AU     (scopes: view, reprint;                    werks 2000)

Union: scopes = [view, rate, book, print, reprint]   werks = [1000, 2000]

⚠ At scope level she CAN book on 2000 — XSUAA can't bind a scope to one plant.
```

The mitigation is **convention, not mechanism**: don't pair a Dispatcher collection in one region with any collection in another for the same user unless that's acceptable. If a hard per-plant split is ever genuinely required, raise it — don't improvise. (Full note in `10-Courier-Security.md` §1.2 and `13-Courier-User-Admin.md`.)

### The enforcement rule

Every protected endpoint, no exceptions:

```js
if (!req.authInfo.checkScope('$XSAPPNAME.book'))
  return 403;

const allowed = req.authInfo.getAttribute('werks');   // from the TOKEN
if (!allowed.includes(delivery.werks))
  return 403;
```

**Plant comes from the token. Never from the request.**

```js
const werks = req.query.werks;                     // ✗ user can lie
const werks = req.authInfo.getAttribute('werks');  // ✓
```

### ⚠️ The plant check applies to LOOKING, not just booking

**The trap:** it's easy to guard the money button and forget the search box.

Shipment Lookup answers *"what happened to parcel X?"* — searched by tracking number. Tracking numbers are often sequential. All four regions share one database.

**So:** an NZ support person types tracking numbers in a loop and reads every customer name and address in NZ, AU, US and CA. No hacking. Just typing.

**The rule:** *every* endpoint that returns parcel data gets the plant check.

```
worklist        ✓
lookup          ✓  ← the one people forget
dashboard       ✓
reprint         ✓
label download  ✓
```

**Better than remembering:** make it impossible to forget. Build one data-access layer that *cannot* fetch a shipment without being told which plants are allowed. Then a developer can't write an unguarded query even by accident.

### JWT validation — say it out loud

Everything rests on trusting the token. So before reading any scope or plant from it, the token's **signature, issuer, audience and expiry** must be checked.

The SAP security library (`@sap/xssec`) does this — but only if it's actually wired in. Given that nothing in BTP checks authorisation for you, don't leave it as an assumption.

**Rule: no claim is read from an unvalidated token.**

### ⚠️ XSUAA is not SAP authorisation

| SAP (PFCG) | BTP (XSUAA) |
|---|---|
| Auth objects, org levels | Flat scopes + attributes |
| Kernel checks automatically | **Your code checks — or nothing does** |
| `AUTHORITY-CHECK` | A line you wrote |

**There is no automatic enforcement.** XSUAA just puts claims in a token. Miss one endpoint and it's wide open.

---

## 12. THE WEBHOOK

How carriers tell us a parcel moved.

- **Public route on CF** — BTP is already internet-facing, so no DMZ/firewall saga
- **Verify the HMAC signature** — non-negotiable. Without it, anyone who finds the URL can fake a "delivered" event or trigger emails from our domain.
- **Respond 200 fast, process async** — carriers time out (~5s) and retry. Slow handler = duplicate emails.
- **Idempotent** on `(tracking, event_type, timestamp)` — carriers re-send events
- **Per-carrier status mapping in config, not code** — six carriers, six vocabularies, one enum:

```
NZ Post: PICKED_UP, COLLECTED, IN_TRANSIT
FedEx:   PU, OC, DP
UPS:     I, M
AusPost: "Picked up", "In transit"
```

Carriers add statuses without telling you. Config means no redeploy.

- **Nightly fallback job** — any parcel PGI'd >24h ago with no pickup event and no email sent. Catches silent webhook failures, which otherwise mean the customer just never hears from us and nobody notices.

### ⚠️ Three more things the public route needs

**1. Reject old messages (replay).**
A valid message, if copied, stays valid forever. Someone who captures one can send it again later.
→ The signature must cover a **timestamp**, and we reject anything older than a few minutes.

**2. Cap the size and rate.**
The route is public. Anyone can flood it. Every request costs us a signature check and a queued job — so "respond fast, process later" actually makes flooding *worse*, because the queue grows while we say 200.
→ Limit request size. Rate-limit per sender. **Put a ceiling on the queue.**

**3. Fail closed on unknown statuses.**
Six carriers, six vocabularies, and they add new words without telling us. An unrecognised status must **do nothing** — never fall through to "delivered", never trigger an email.
→ Unknown status = log it, alert someone, take no action.

### ⚠️ The carrier's reply is untrusted too

We check the *sender*, but not the *content*. Tracking numbers, label text and status strings all come from an outside system and end up in our database, our screens, and **emails we send to customers**.

→ Validate shape and length before storing. Escape before displaying or emailing.

---

## 13. THE EMAIL

- **Trigger:** first pickup / `in_transit` scan
- **Not** at booking — that's "your order has shipped" while it's still on the dock
- **Sent from:** `courier-srv`, via Microsoft Graph API (not SMTP — browsers and SMTP don't mix, and Graph is the HTTP equivalent of Resend)
- **Content:** SO number, tracking number, tracking link
- **Never** the DO number
- **Idempotent** — one email per DO regardless of box count
- **Race guard** — three webhooks arriving together must not send three emails

---

## 13b. CUSTOMER DATA — WE HOLD MORE THAN WE THINK

Every shipment stores a real person's **name, home address, and email**. For one-time customers, we hold it and they never signed up for a relationship with us.

That's regulated personal data — NZ Privacy Act, plus GDPR-style rules if any customer is an EU citizen.

**The design didn't cover this. It needs to.**

### Four questions to answer before go-live

| Question | Why |
|---|---|
| **How long do we keep it?** | "Forever" is not a policy. Pick a window (2 years? 7 for tax?) and build a purge job. |
| **Is it in our logs?** | Error traces and debug logs love printing whole objects. Addresses end up in monitoring tools nobody thinks of as a database. |
| **Is it in the bounce records?** | The `notifications` table holds emails. That's PII too. |
| **What if someone asks us to delete it?** | We need to be able to find and remove one customer's data. |

### The fixes

- **Set a retention window** and run a purge job
- **Scrub name/address/email from logs** and error reporting
- **Treat `notifications` as PII-bearing** — same rules
- **Backups and DR count too** — HANA is now a system of record holding customer data. It needs backup, restore, and a retention story.

> This is the one people forget until an auditor asks. Cheap to design in, expensive to retrofit.

---

## 14. BILLING & INVOICE RECONCILIATION

> ### 🔶 PENDING — Teru to confirm current practice with Finance
>
> Everything in this section is **provisional** until we know how Finance handles carrier invoices **today**.
>
> **Questions to ask them:**
>
> | Question | Why it matters |
> |---|---|
> | How do carrier invoices arrive now, and who processes them? | Tells us if there's a working process we shouldn't disturb |
> | Do you already check invoices against expected cost, or just code and pay? | If nobody reconciles today, variance reporting may be a solution looking for a problem |
> | Do you need freight **accrued at delivery**, or is invoice-time fine? | Accrual = we must push cost back to ECC. Big change. |
> | Does freight need allocating to customer/order for margin analysis? | If yes, forces per-delivery cost into ECC — much bigger conversation |
> | Do you get the CSV/EDI file, or only the PDF? | Decides whether reconciliation can ever be automated |
> | Is anyone chasing carrier overcharges today? | If yes, this is a real win. If no, phase it late. |
>
> **If Finance already has a process that works — don't change it.** Just add visibility.

### How carriers actually bill

- **On first scan** — not on label creation. Labels printed and binned cost nothing.
- **Weekly or monthly** consolidated invoice per account, per region
- **PDF by default. Ask for the data file** (CSV/EDI) — without it, reconciliation is a spreadsheet job forever

### Quoted ≠ billed — this is normal

Expect divergence on **5–15% of parcels**:

- **Reweigh** — declared 2.0kg, scanned 2.4kg, billed 2.4kg
- **Dimensional weight** — charged on the greater of actual or `L×W×H ÷ divisor`. A big light box bills as heavy.
- **Surcharges** — residential, rural (big in NZ), oversize, fuel (%, changes monthly), peak season, address correction, redelivery
- **Duties** — on DDP, the carrier pays customs and rebills, sometimes months later

This is why we store `rate_quoted` at booking.

### Getting the invoice into the app

**Carriers do not send invoices to our app.** They email them. So we pull, not receive:

| How | Reality |
|---|---|
| **Manual upload** — Finance drags the file into a screen | Works day one. Zero integration. |
| **Email → shared mailbox → we read it** | Most common. Works with all six carriers. |
| **SFTP** — carrier drops a file, we collect | Cleaner. Some carriers offer it. |
| **Billing API** — we pull the data | Only bigger carriers (FedEx, UPS). Not NZ Post. |

Realistically: a mix. API where it exists, mailbox/SFTP otherwise, manual as fallback.

### ⚠️ Six carriers = six invoice formats

Same problem as six APIs. Different columns, different date formats, different surcharge codes. Matching to shipments means finding the tracking number in each format.

**It's not one build. It's one parser per carrier.**

Rough effort:
```
Ingestion mechanism (mailbox / SFTP)   ~1 week
Parser per carrier                     ~2-3 days × 6
Matching + variance logic              ~1 week
Report / tile                          ~1 week
                                       ───────────
                                       ~5-6 weeks total
```

Comparable to a carrier integration. **Not free.**

### The plan — in scope, phased, manual first

| Phase | What | Why |
|---|---|---|
| **1** | Capture `rate_quoted` at booking. Nothing else. | Already in the design. Costs nothing. |
| **2** | **Manual upload screen** + one parser (NZ Post) | Finance drags in the CSV, sees variance. **~2 weeks, not 6.** Proves the value before we automate. |
| **3** | Automate ingestion (mailbox or SFTP) | Only once it's earning its keep |
| **4** | Remaining parsers, as each carrier goes live | Spread the cost |

**Why manual first:** if Finance looks at the variance report twice and stops, we've saved a month. If they use it weekly, automation is obviously worth it. Let the usage decide.

### Where the report lives

Not the dispatcher app — warehouse staff don't care about cost.

- **Courier Dashboard tile** (already in §3) — add a variance view for Supervisor + System admin
- Or a **separate Finance tile** — different audience, scoped by company code rather than plant

Given independent regions, variance is **per plant / per company code**. NZ Finance doesn't need US numbers.

### The AP options — also pending Finance

| Pattern | When |
|---|---|
| **Non-PO invoice** (FB60) → freight GL | Probably right at this volume. ~6 invoices/month per region, someone codes them. Near-zero integration. |
| **Blanket PO + periodic service entry** | If procurement wants a PO reference |
| **PO per parcel** | → ~1,000 POs/month. Three-way match adds no control for freight under contract. |
| **SAP shipment costing** (VT01N → VI01) | The "proper" SAP way — **unavailable to us**. Needs freight cost in SAP, conflicts with clean core. |

### ⚠️ The invoice file is untrusted input

It comes from outside. Parse defensively:
- Size limits
- Malformed-row handling
- **Formula-injection guard** — if a cell starts with `=` and someone opens the file in Excel, that's code execution on Finance's laptop

(See §16b — S13)

---

## 15. KEEPING AN EYE ON THINGS

### Everything has a clock

```
packed → booked → printed → shipped → picked up
```

Each step has a time budget. Cross it = abnormal. **Normal queue becomes abnormal when it crosses the timeline** — it's one mechanism, not two categories.

```sql
select vbeln, werks, state, now() - state_entered_at as age
from shipments
where now() - state_entered_at > threshold_for(state, werks)
```

### Thresholds are per state AND per plant

NZ Post picks up at 15:00. FedEx US might be 17:00. "No pickup after 4h" is normal in one, alarming in the other.

### The better measure: time against cutoff

Packed at 09:00 with a 15:00 cutoff = six hours.
Packed at 14:30 = thirty minutes.
Same age at 14:45, wildly different urgency.

```
time_until_cutoff < X  AND not picked up  → urgent
past_cutoff            AND not picked up  → missed today's van
```

Worth capturing carrier cutoff per plant — it's the most actionable field in the model.

### Three levels

1. **Tile badge** — "6 pending" — always visible, passive
2. **Bell notification** — "6 stuck >4h" — supervisor's problem
3. **Email** — still stuck after escalation — chase it

**Aggregate, don't spam.** One notification saying "6 stuck" beats six notifications. Cooldown between repeats, or it fires hourly and gets muted.

**Don't alert on normal work.** Alert on breach only. Otherwise people mute it and miss the real one.

### ⚠️ We don't know the thresholds yet

4 hours might be normal. 30 minutes might be normal.

**Instrument first, alert second.** Record all five timestamps from day 1. Run for a month. Look at the real distribution (p50, p90, p99) per state per plant. *Then* set alerts at ~p95.

---

## 16. SEVEN THINGS TO CHECK

Each is a 5-minute lookup. Any of them could change the plan.

| # | Question | Where | If wrong... |
|---|---|---|---|
| 1 | Is `MARC-STAWN` (HS code) populated? | MM03 / SE16 | International shipping blocked |
| 2 | Where's the contract number? | XK03 → check `EIKTO` (company code data), Z-fields, or outline agreements (ME33K) | Can't get our negotiated rates |
| 3 | `ADR6` — is `FLGDEFAULT` set, or filter on `CONSNUMBER='001'`? | SE16 on recent one-time deliveries | **Zero emails send, silently** |
| 4 | Is the plant address the real dispatch dock or the registered office? | OX10 / ADRC | Wrong rates, wrong pickup location |
| 5 | Is customs value = `LIPS-NETWR`, or different? (samples, discounts, free goods) | Ask export docs person | Customs rejects parcels |
| 6 | Does e-commerce already send shipping emails? | Ask e-comm team | Customer gets two emails |
| 7 | Do the regions ship internationally at all, or domestic-only? | Business | Might not need customs at all — much smaller phase 1 |
| **8** | **How does Finance handle carrier invoices today?** 🔶 **Teru to check** | Finance | Decides the whole of §14 — whether variance reporting is a real win or a solution looking for a problem. Also: accrual vs invoice-time, and whether cost must go back to ECC. |

**Plus two on user profile (both now DECIDED — Open Items #9, #10 closed):**

- ~~Can the identity team maintain a custom `werks` attribute per user in Entra?~~ **No — decided against.** Plant lives in per-region role collections instead (~17 collections). Entra/CIS = authentication only. See §11 and `10-Courier-Security.md` §1.
- ~~Does anyone need **different permissions in different plants**?~~ **Handled by the static model.** Per-plant combinations are expressible via separate regional collections (e.g. Dispatcher_NZ + Support_AU), with the residual scope-union caveat noted in §11.

---

## 16b. SECURITY — MUST PASS BEFORE BUILD

From the security review. Each one is testable — write the test, watch it fail, then fix it.

### 🔴 Blocking

| # | Must be true | How we prove it |
|---|---|---|
| **S1** | Carrier web addresses come from the Destination service, never a database row | Change a `carriers` row to a hostile URL — the app ignores it. Private/internal addresses are refused. |
| **S2** | Labels are stored by us and served only through an authenticated endpoint | The carrier's link is never saved or returned. Fetching a label without a token → 401. With the wrong plant → 403. |
| **S3** | Every endpoint returning parcel data checks scope **and** plant | Log in as NZ support, request an AU tracking number → 403. Repeat for lookup, dashboard, reprint, label. |
| **S4** | Booking twice is impossible | Fire two `/book` calls for the same parcel at the same instant — exactly one carrier call, one charge. |

### 🟠 Before go-live

| # | Must be true | How we prove it |
|---|---|---|
| **S5** | Webhook rejects replays and floods | Replay a captured message — rejected. Oversized body — rejected. Flood — rate-limited, queue bounded. |
| **S6** | Unknown carrier status does nothing | Send a status we've never seen — logged, alerted, **no email**, no state change. |
| **S7** | Tokens are validated before any claim is read | Expired/forged/wrong-audience token — 401 before any logic runs. |
| **S8** | `void`, `override`, `config`, `role change` are audited | Perform each — an immutable record of who/when/before/after. |
| **S9** | No customer PII in logs | Trigger an error mid-booking — check logs and monitoring. No name, address, or email. |
| **S10** | Retention policy exists and runs | A purge job deletes shipments past the window. Bounce records too. |

### 🟡 Confirm

- **S11** — Carrier response content (tracking numbers, status text) is validated and escaped before storing, displaying, or emailing
- **S12** — The ECC technical user genuinely cannot write, and cannot reach anything beyond the 3 CDS views
- **S13** — Invoice CSV/EDI parsing is defensive: size limits, malformed rows, formula-injection guard
- **S14** — Secret rotation has a plan, including what happens to in-flight bookings

---

## 17. BUILD ORDER

### Phase 1 — Prove it works
- **NZ only. Domestic only. NZ Post only.**
- Rate → book → label → webhook → email
- Plus the lookup tile
- **Weeks, not months** — no customs, no OAuth, simple auth

### Phase 2 — Add carriers
- **FedEx next** — hardest (OAuth2 + label certification takes weeks of *waiting*)
- ⚠️ **Start FedEx paperwork now, in parallel with Phase 1**
- Then the rest, one at a time, against a proven interface

### Phase 3 — Other regions
- Config + carrier onboarding
- **Not new development**

### Phase 3b — Invoice reconciliation (manual first)
- **Manual upload screen** + NZ Post parser
- Finance drags in the CSV — sees quoted vs billed variance
- ~2 weeks. Proves the value before we automate anything.
- 🔶 **Scope depends on Finance's answer to check #8**

### Phase 4 — International
- Only if needed (check #7)
- Depends on HS codes (check #1)

### Phase 5 — Automate invoice ingestion
- Mailbox / SFTP / billing API
- Remaining carrier parsers
- **Only if Phase 3b proves people actually use it**

---

## 18. TEST EARLY — THESE BREAK LATE

1. **BrowserPrint inside the Work Zone shell** — works standalone, may fail in an iframe with CSP + mixed content. Test on a **real locked-down corporate PC**, in week 1. If it fails, the printing model changes and that's not a small rework.
2. **A real webhook from a real carrier** — not Postman. Signature verification, payload shape, retry behaviour.
3. **One real rate call with a real contract** — confirms we actually get our negotiated price, not list.

---

## 19. WHAT WE DELIBERATELY DIDN'T DO

| Rejected | Why |
|---|---|
| Carrier API called from Fiori | API key in the browser = anyone can spend our money |
| Resend/SMTP from Fiori | Same key problem, and the browser is closed at pickup time |
| BPA for email | Can't receive the webhook (no HMAC verification, wrong auth). Needs an adapter in front — which is the server we were avoiding. |
| RPA for email | Automating clicks to avoid an API. Brittle, needs a VM, still needs a trigger and a server. |
| Z-table in ECC | Clean core |
| `LIKP-TRAID` stamp | Clean core, and a bare number without carrier/status/reprint doesn't answer the real question |
| RFC read-table | No contract, reads raw DB tables, security red flag |
| PO per parcel | ~1,000 POs/month. Three-way match adds no control for freight under contract. |
| Notify on every booking | 200/week × 4 regions = muted in week one |
| Carrier URLs in the database | An admin could redirect our keys to their own server (security review H1) |
| Storing the carrier's label link | Customer's name + address, readable by anyone with the link (security review H2) |

---

## 20. THE SHAPE, ONE PICTURE

```
                    ┌──────────────────┐
                    │   E-COMMERCE     │  ← where the order starts
                    │                  │
                    │  customer buys   │
                    │  email captured  │  (mandatory field)
                    └────────┬─────────┘
                             │  sales order
                             ▼
                    Work Zone (launchpad, SSO, tiles)
                              │
              ┌───────────────┼───────────────┐
              │               │               │
      Courier Dispatch   Shipment Lookup   Carrier Setup
              │               │               │
              └───────────────┼───────────────┘
                              │  JWT: scopes[] + werks[]
                              ▼
                    ┌──────────────────┐
                    │   courier-srv    │  ← the guard. Checks every call.
                    │   (CF, ~400 loc) │
                    │                  │
                    │  /rates  /book   │───────► Carriers (EasyPost / direct)
                    │  /void  /reprint │
                    │  /webhook        │◄─────── Carriers (pickup scans)
                    │  email on pickup │───────► Customer (via MS Graph)
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │    HANA Cloud    │  ← owns ALL courier data
                    └──────────────────┘
                             │
                    ┌────────┴─────────┐
                    │ Cloud Connector  │
                    └────────┬─────────┘
                             │  read-only, technical user
                             ▼
                    ┌──────────────────┐
                    │     SAP ECC      │◄─── sales order lands here
                    │                  │
                    │  SO → DO → pick  │
                    │     → pack (HU)  │
                    │                  │
                    │  3 CDS views:    │
                    │  · delivery      │
                    │  · plant address │
                    │  · contract      │
                    └──────────────────┘
                       nothing goes back
```

### Following one order all the way through

```
E-commerce          customer buys, email captured
     │
     ▼
SAP ECC             SO created
     │              DO created
     │              picked → packed → (HU has real weight + dims)
     │
     ▼  (BTP reads via CDS)
courier-srv         rate → book → tracking number + label
     │
     ▼
Fiori + BrowserPrint    label printed, stuck on box
     │
     ▼
SAP ECC             PGI (goods issue)
     │
     ▼
Carrier             collects, scans
     │
     ▼  (webhook)
courier-srv         "picked up" → email customer
     │                             (shows SO number, not DO)
     ▼
Carrier             delivers. Invoice arrives later.
```

**Note the two SAP touchpoints are both ECC's own work** — creating the SO/DO from e-commerce, and PGI. Our app never writes to either. It reads what's packed, and does everything else itself.
