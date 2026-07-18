# 13 — Courier Booking: User Administration

> **Prereq:** 10-Courier-Security §1 (the model this operationalizes).
> **Audience:** Super user (role assignment), System admin, and the agent building xs-security.json.
> **Decided model:** corporate email login via CIS (origin `sap.custom`); plant = static value per regional role collection. No Entra attributes, no CIS claim mapping.

---

## 1. Identity: what exists and what we manage

| Thing | Owner | Our involvement |
|---|---|---|
| Corporate account (jane@gallagher.com) | IT / Entra | None — exists from hire |
| CIS (IAS) trust to BTP | Existing setup | None — authentication only, already working |
| BTP user record | Auto-created on first login, one per IdP origin | Assign collections to the RIGHT record (§4) |
| Role collections | Us | Create once (§2), assign per user (§3) |

**There is no user creation in this project.** Users exist; we only assign.

## 2. One-time setup: create the collections (build task, with 1.17)

From ONE role template per role type in xs-security.json (see 08-TRD / 10-Security), instantiate roles in the cockpit with a STATIC werks value, then bundle into collections:

```
Per region (NZ=1000, AU=2000, US=3000, CA=4000):
  Courier_Dispatcher_<R>   view rate book print reprint    werks=<plant>
  Courier_Supervisor_<R>   + void override                 werks=<plant>
  Courier_Support_<R>      view reprint                    werks=<plant>
  Courier_SysAdmin_<R>     config                          werks=<plant>
Global:
  Courier_SuperUser        (no app scopes — cockpit role admin only)
```

Cockpit path: **Security → Roles → New Role** (from template; set werks = *Static value* = plant) → **Security → Role Collections → New** (add the role).

Naming is fixed: `Courier_<Role>_<Region>`. Do not deviate — renaming collections later is painful.

**SoD check at creation:** SuperUser collection contains NO courier app scopes. SysAdmin collections contain ONLY config. Verify before first assignment.

## 3. Onboarding a user (super user runbook)

New dispatcher, AU warehouse, starts Monday:

1. Confirm they have logged into Work Zone at least once with their corporate email (this creates their BTP user record). If not, have them log in first.
2. **BTP Cockpit → Security → Users** → search their email.
3. ⚠️ **Pick the row with identity provider = CIS (origin `sap.custom`).** The same email appears once per IdP — assigning to the `sap.default` row does nothing and looks broken. This is the #1 support-ticket generator; check the origin every time.
4. Detail panel → **Role Collections → Assign** → `Courier_Dispatcher_AU`.
5. Verify: user re-logs into Work Zone → sees the Courier Dispatch tile → worklist shows AU deliveries only.

Multi-plant user (e.g. support covering NZ+AU): assign `Courier_Support_NZ` AND `Courier_Support_AU`. The app's plant switcher shows both.

**Pairing caution (from 10-Security §1.2):** scopes union globally across a user's collections. Pairing a Dispatcher collection in one region with any collection in another technically extends book-capable scopes to the second plant. Acceptable for trusted staff; if a stricter split is ever required for a specific user, raise it — do not improvise.

## 3a. Maintaining a collection's members: export file + btp CLI (learned 2026-07-18)

Recorded while fixing the Work Zone "Everyone" tile bleed (task-log session 5).

**Export (works).** Role collection page → **Export** → CSV with four sections
(Roles / Users / User Groups / Attribute Mappings). User rows:
`ID,Identity Provider,E-Mail,First Name,Last Name`, e.g.
`jane@gallagher.com,sap.custom,jane@gallagher.com,Jane,Doe`.
Export a known-good collection (e.g. `~ecommerce_courier_dispatcher`) to get the
exact format; the IdP column must be `sap.custom` (§3 rule 3).

**Import (does NOT work here).** This cockpit version (Free Tier subaccount,
checked 2026-07-18) has **no Import button** on the collection page — the export
format cannot be uploaded back. Don't hunt for it; use the CLI.

**btp CLI (the proven path).**
```
btp login --sso manual                    # prints a URL; open it, paste the code back
btp assign security/role-collection "<collection>" --to-user <email> \
    --of-idp sap.custom --subaccount 533a28c1-cf90-4ca0-a70e-f888f6a7e55f
btp get security/user <email> --of-idp sap.custom --subaccount <same>   # verify
```
Loop the assign over users × collections for bulk work — this is the Phase-3
path for the ~16 remaining regional collections (doc 13 §2).

**Work Zone content roles (gotchas).** A role created in Work Zone's Content
Manager auto-creates a matching BTP role collection: local roles get the role id
with underscores (e.g. `Customer_Data_Governance`), channel-provider roles a `~`
prefix (e.g. `~ecommerce_courier_dispatcher`). These collections are
**membership-only** — an empty Roles section is normal, do not add roles to
them. Watch for manually created near-duplicates (spaces vs underscores); the
one matching the WZ role id is the linked one — when in doubt, assign both.
Content attached to the built-in **Everyone** role renders on EVERY site in the
subaccount and its site toggle is locked ON — scope site content to a real role
+ collection instead.

## 4. Region transfer

Jane moves NZ → AU:
1. Remove `Courier_Dispatcher_NZ` from her CIS user record.
2. Assign `Courier_Dispatcher_AU`.
Same day, two clicks. (This is the operational cost of the static model — accepted.)

## 5. Offboarding

1. IT disables the Entra account on exit (their existing process) — **all BTP access dies immediately**. This is the actual security control.
2. Hygiene (within the week): remove their role collections in the cockpit so the assignment list stays truthful.

## 6. Leave cover

Temporary: assign the covering person the needed regional collection; calendar-reminder its removal. There is no expiry mechanism in XSUAA — removal is manual. Log both actions if the collection includes void/config (audit expectation, S8 spirit).

## 7. Adding a fifth region (future)

1. New roles from the existing templates with the new static werks value; new collections per the naming pattern.
2. Rows in `routes`, `carrier_accounts`, `printers`, `sla_thresholds` (09-Data-Model).
3. No code change expected. If one is needed, that's a design gap — surface it.

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| "Assigned the role but no tile" | Wrong IdP row — origin `sap.custom`? Re-login after assignment? |
| Tile visible, API returns 403 | Collection missing the scope, or werks static value wrong on the role |
| Sees wrong region's data | Impossible if S3 passes — treat as a security incident, check which collections the user holds |
| Two users, same email, different behavior | They're on different origins. Consolidate to CIS; consider disabling interactive login on `sap.default` in production |
