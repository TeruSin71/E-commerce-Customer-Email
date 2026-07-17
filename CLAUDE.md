# CLAUDE.md — Courier Booking System (SAP CAP on BTP)

> This file is loaded automatically at the start of every session. It is a pointer
> and a guardrail, not the full spec — the detail lives in `docs/`.

## Read first — every session, before any task

1. **`docs/00-INDEX.md`** — what exists, in what order to read it, and the rules that override everything.
2. **`docs/14-Courier-Agent-Protocol.md`** — HOW to work: required tools, the task execution loop, and per-phase paste-ready prompts. **Mandatory before any task.**
3. **`docs/02-Project-Plan.md`** — live status: what's done, what's blocked, what to do next.

`docs/11-Courier-Implementation.md` defines WHAT to build (task order + DONE criteria); doc 14 defines HOW. Follow the doc-14 §2 loop for every task — do not freestyle.

## Non-negotiables — do not violate, even under time pressure

1. **Land every change via a pull request — never push to `main`.** `main` is protected by a branch ruleset; direct push is rejected. Branch → commit → PR → auto-merge on green (`build` + `test`). See `CONTRIBUTING.md`.
2. **SAP ECC is read-only. Ever.** No writes, no Z-objects, no exceptions (PRD constraint #1). A task that seems to need one is misread — stop and surface.
3. **Secrets live in the BTP Destination service ONLY** — never in code, config files, the database, or logs.
4. **Security controls S1–S14 (`docs/10`) are non-negotiable.** Never weaken an S-control or S-test to make something pass. Plant + scope checks on every parcel-data route — via middleware + the one plant-scoped repository, never "TODO later".
5. **Open Items (`docs/12`) gate tasks.** If a gating item is unanswered, STOP and surface it — never guess. When an answer contradicts a doc, the answer wins; update the doc in the same commit.

## How to work (the doc-14 §2 loop, in short)

- **Plan** with the `superpower` skill (loop step 1). **Guard** with `ponytail` before writing code (loop step 2) — it enforces the simplicity targets (courier-srv ~400–800 LOC, one app, not microservices).
- **Review** after code with `code-review` + `security-review`. **Verify** with `verify` / `run` against the task's DONE criteria — never claim "done" without a check.
- **Domain tools:** `cds-mcp` (CDS/CAP), `fiori-mcp` + `ui5-mcp` (Fiori/UI5), `snyk` (security scans). Use the MCP when the task is in its domain rather than hand-writing the artifact.
- **One task at a time**, in `docs/11` order. Append a `docs/task-log.md` entry per completed or surfaced task — it's the handover between sessions.
