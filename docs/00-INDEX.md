# Courier Booking System — Documentation Index

> **For the AI agent:** Read this file first. It tells you what exists, in what order to read it, and the rules that override everything else.

## The documents

| Doc | Purpose | Read when |
|---|---|---|
| `07-Courier-PRD.md` | What we're building, business facts, constraints, rejected approaches | Always, first |
| `08-Courier-TRD.md` | Stack, landscape, API surface, ECC/carrier/email/print/webhook contracts | Before any implementation task |
| `09-Courier-Data-Model.md` | Full Postgres DDL, access-layer rule, PII/retention | Before touching the database or any query |
| `10-Courier-Security.md` | Auth model, threat findings, 14 acceptance criteria (S1–S14) | Before EVERY task — S-criteria gate merges |
| `11-Courier-Implementation.md` | Phased task list with dependencies and DONE criteria | Your work queue |
| `12-Courier-Open-Items.md` | Unanswered questions with blocking flags | Before starting any task — check gates |
| `13-Courier-User-Admin.md` | Role collections setup, onboarding/offboarding runbook, IdP-origin gotcha | Task 1.17 + day-2 operations |
| `14-Courier-Agent-Protocol.md` | Required tooling, the task execution loop, per-phase paste-ready prompts | EVERY agent session, before any task |

## The five rules that override everything

1. **SAP ECC is read-only.** No writes, no Z-objects, no exceptions. A task that seems to need one is misread — stop and surface.
2. **S1–S4 are build-blocking, test-first.** Never weaken a security control to make something pass.
3. **Plant scope + scope check on every parcel-data route** — reads included. Enforced via middleware + the plant-scoped repository. A route without both does not merge.
4. **Secrets live in the BTP Destination service only.** Never code, config files, Postgres, or logs. Carrier URLs are bound to their credentials there (SSRF defense).
5. **Open Items gate tasks.** If a gating item is unanswered, stop and surface it. Never guess. When an answer contradicts a doc, the answer wins — update the doc in the same commit.

## Canonical flow (one line per step)

```
e-commerce order → ECC SO → DO → pick/pack (HU: real weight) → app worklist
→ rate (contract price) → book (idempotent, money) → label stored + printed
→ PGI in ECC → carrier scans → webhook (verified) → ONE email (SO no. + tracking)
→ invoice later → variance (phased)
```

## Current state

- Design: approved, security-reviewed, findings incorporated
- Auth model: DECIDED — static werks per regional role collection (Open Items #9, #10 closed; no IdP attribute work needed)
- Code: none yet — Phase 0 is the starting point
- Blocking right now: Open Items #2, #3, #4 (Phase 1) and the BrowserPrint spike (0.1)
