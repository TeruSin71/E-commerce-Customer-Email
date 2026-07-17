# 14 — Courier Booking: Agent Execution Protocol

> **Audience:** Any AI agent executing tasks from `11-Courier-Implementation.md`.
> **This doc defines HOW to work. The other docs define WHAT to build.**

---

## 1. Required tooling

**Execution environment: Claude Code** (VSCode workspace) with the SAP toolchain available — `cf` CLI and `@sap/cds-dk` (CDS compiler) installed, and the MCP servers below connected. (SAP Business Application Studio is an equivalent environment — the same tools apply.) Prefer the MCP servers + installed toolchain over ad-hoc installs.

### 1.1 SAP MCP servers — REQUIRED when the task touches their domain

| Tool | Use for | Tasks |
|---|---|---|
| **cds-mcp** (CDS + CAP — one server) | CDS/CDL syntax, entities & service definitions, annotations, CAP docs (`search_docs`, `search_model`) | 1.1 (schema), 1.2 (ECC views), 1.3+ (courier-srv) |
| **fiori-mcp** | Fiori elements / SAPUI5 app scaffolding, OData metadata, `manifest.json`, guidelines | 1.15, 1.16, 1.17 |
| **ui5-mcp** | UI5 API reference & guidelines, `run_ui5_linter`, `run_manifest_validation` | 1.15, 1.16, 1.17 |
| **snyk** | Security scans: `snyk_code_scan` (S-controls), `snyk_sca_scan` (deps), `snyk_iac_scan` (mta/config) | 1.4, 1.18, 3b, per-carrier |

Rule: if the task is in an MCP's domain, use it rather than free-handing the artifact.

### 1.2 Additional required tools — confirmed available in BAS

| Tool | Purpose | When to invoke |
|---|---|---|
| **superpower** (skill) | Writing/working-plan structuring and brainstorming | Loop step 1 (PLAN) of any non-trivial task; drafting/updating any doc; Phase 0 spike write-ups; whenever a task-log SURFACED entry needs a recommendation |
| **ponytail** (skill) | Over-engineering guard | Loop step 2 (EXECUTE) review gate — run it on the planned change BEFORE writing code for tasks 1.3+; MANDATORY before any task that adds a new table, new service, new abstraction layer, or new dependency |
| **ui-ux-pro** (skill) | SAP Fiori/UI5 UI-UX design & review — floorplans, annotations, accessibility, Fiori guidelines | Fiori tasks 1.15–1.17 (design + review) |
| **verify** / **run** (skills) | Drive the change end-to-end / launch the app to confirm real behaviour | Loop step 3 (VERIFY) — never claim done on tests alone |
| **code-review** + **security-review** (skills) | Correctness + security review of the diff | Loop step 3, on the PR (after ponytail's simplicity pass) |
| **deep-research** (skill) | Multi-source fact-checked research (carrier API docs, SAP field semantics) | Phase 0 onboarding (0.2, 0.4); per-carrier (Ph2) |
| **dataviz** (skill) | Chart/dashboard design | Dashboard tile (1.16) |
| **ruflo** (MCP) | Agent meta-harness (formerly Claude Flow). **SCOPED FOR THIS PROJECT TO PERSISTENT MEMORY ONLY:** `memory_store` / `memory_search` / `memory_list` for cross-session knowledge (decisions made, carrier API quirks discovered, spike results) | Start of session: search memory for the current task's context. End of any task that produced a non-obvious learning: store it. **FORBIDDEN for this project:** swarm_*, agent_spawn, hive-mind_*, neural/training tools — one agent, one task, per the §2 loop. Spawning sub-agent swarms for a ~400–800 LOC service is exactly the over-engineering ponytail exists to block. |

Rules:
1. **ruflo security caveat:** an automated scan (SkillsLLM) flagged high-severity issues in the ruflo repo, and an independent audit found most of its 314 tools to be stubs or token-wasting cosmetics — the memory tools are the audited-as-real capability, hence the memory-only scoping above. Before Phase 0, someone reviews the security report in the context of THIS environment (it runs beside carrier credentials). If the review fails, drop ruflo and use docs/task-log.md as the only cross-session memory.
2. **ponytail has teeth:** if it flags a change as over-engineered, that is a loop step 5 classification — treat as (a) implementation approach wrong, simplify, and re-enter step 2. Do not argue past it. The design already sets simplicity targets (courier-srv ~400–800 LOC, one app not microservices, doc 08 §2) — ponytail is how the loop enforces them.
3. If a tool errors or is missing in a given session, log it once and proceed. NEVER fabricate output as if the tool had run.

### 1.3 Overlap precedence (when two tools cover the same ground)

| Ground | Winner | Rule |
|---|---|---|
| Planning | **superpower** | Use superpower for plan structure in loop step 1. Claude Code's native plan mode may run, but the plan artifact follows superpower's structure — don't produce two competing plans. |
| Cross-session memory | **task-log.md is the source of truth** | task-log.md is authoritative and MANDATORY (it's the human-readable handover). ruflo memory is a search index OVER the same facts — store into ruflo only what is ALSO in task-log.md, never ruflo-only. If they disagree, task-log.md wins. Claude Code auto-memory (CLAUDE.md) holds only stable conventions, not task state. |
| CDS / CAP artifacts | **cds-mcp** | One server covers both ECC CDS views (1.2) and courier-srv CAP artifacts (1.3+). |
| Fiori scaffolding vs UI5 checks | **fiori-mcp** scaffolds, **ui5-mcp** validates | fiori-mcp generates the app + OData wiring; ui5-mcp runs the linter + manifest validation and provides API/guidelines. |
| ponytail vs code-review skills | **Both, different lenses** | ponytail = simplicity gate BEFORE code (step 2). Code/security review = correctness AFTER code (step 3). Not duplicates — do not skip one because the other ran. |

### 1.3 Always

- Read `00-INDEX.md` rules before the first task of any session.
- Check `12-Courier-Open-Items.md` gates before starting any task.
- Security tests per `10-Courier-Security.md` are test-first for S1–S4.

---

## 2. The task execution loop

Run this loop for EVERY task in doc 11. Do not freestyle.

```
┌─────────────────────────────────────────────────────────┐
│ TASK LOOP (max 5 iterations per task)                   │
│                                                         │
│ 0. GATE CHECK                                           │
│    - Dependencies from doc 11 met? Open Items clear?    │
│    - If gated → STOP. Surface. Do not guess. Exit loop. │
│                                                         │
│ 1. PLAN (first iteration only)                          │
│    - Use superpower skill to structure the plan         │
│    - Restate the task's DONE criteria verbatim          │
│    - List files to create/change                        │
│    - Name which MCPs/skills apply (§1)                  │
│                                                         │
│ 2. EXECUTE                                              │
│    - Run ponytail on the planned change first —         │
│      flagged as over-engineered → simplify before code  │
│    - Smallest change that could satisfy DONE            │
│    - Security rules (doc 10 §1.1) apply to every line   │
│                                                         │
│ 3. VERIFY — against DONE criteria, not vibes            │
│    - Run the task's tests (S-tests where referenced)    │
│    - Run existing test suite (no regressions)           │
│    - Lint/build passes                                  │
│                                                         │
│ 4. LAND (green only)                                    │
│    - Branch → commit → PR → auto-merge (build+test).    │
│    - main is PROTECTED — never push to main directly.   │
│    - Green → task-log entry → DONE, then exit loop.     │
│    - Failure → step 5                                   │
│                                                         │
│ 5. DIAGNOSE (do not blind-retry)                        │
│    - State WHY it failed in one sentence                │
│    - Classify: (a) my implementation bug                │
│                (b) test/criteria wrong or ambiguous     │
│                (c) environment/dependency broken        │
│                (d) design gap                           │
│    - (a) → fix, go to 2. Iteration count +1.            │
│    - (b),(c),(d) → STOP. Surface with the diagnosis.    │
│      Do NOT change tests to pass. Do NOT weaken         │
│      security controls. Exit loop.                      │
│                                                         │
│ 6. CAP: iteration 5 reached without green →             │
│    STOP. Surface: task id, criteria, what was tried     │
│    (all 5 diagnoses), current state, recommendation.    │
└─────────────────────────────────────────────────────────┘
```

### 2.1 Hard rules inside the loop

1. **Never modify a DONE criterion or an S-test to make it pass.** Classification (b) exists for genuinely wrong criteria — surfacing, not self-serving edits.
2. **Never weaken a security control to exit the loop.** (Doc 11 standing instruction 1.)
3. **One task at a time.** Do not start task N+1 while N is mid-loop.
4. **Blind retry is forbidden.** Every iteration after the first requires a written diagnosis that differs from the previous one. Same diagnosis twice = you're stuck = surface at that point, don't wait for the cap.
5. **Surfacing is success, not failure.** A blocked task correctly surfaced with a diagnosis is a completed loop.
6. **Land via PR — never push to `main`.** `main` is protected by a branch ruleset (direct push is rejected). A green task lands as branch → commit → PR → **auto-merge** on `build`+`test`; `.github/**` changes are owner-gated. See `CONTRIBUTING.md`.

### 2.2 Task log entry (append per completed/surfaced task)

```
## [task id] — [DONE | SURFACED]
Iterations: N
Tools used: [CDS MCP, ...]
What changed: [files]
Verification: [tests run, results]
(if SURFACED) Classification + diagnosis + recommendation
```

Keep the log in `docs/task-log.md`. It is the handover artifact between agent sessions — a new session reads it before resuming.

---

## 3. Per-phase loop prompts (paste-ready)

Use these to start an agent session on a phase. Each embeds the loop.

### Phase 0 prompt
```
Read docs/00-INDEX.md, then docs/14 (this protocol), then docs/11 Phase 0.
FIRST: per doc 14 §1.2, all three additional tools are mapped — use as
specified. Note ruflo is memory-only for this project; confirm its security
review (doc 14 §1.2 rule 1) is done or surface it as a gate.
Then execute tasks 0.1–0.5 using the task loop in doc 14 §2. Tasks 0.1–0.4
are spikes/lookups — their DONE criteria are evidence, not code. 0.3's
answers go into docs/12 (flip status, fill Answer, update contradicted docs
in the same commit). Surface immediately on any gate. Write task-log entries.
Stop after Phase 0 and summarize: what's green, what's surfaced, what
blocks Phase 1.
```

### Phase 1 prompt
```
Read docs/00-INDEX.md, docs/14, docs/10 (all of it), docs/11 Phase 1, and
docs/task-log.md for prior state. Confirm Open Items #2, #3, #4 are CLOSED
in docs/12 — if not, STOP and surface; do not guess ECC field answers.
Execute tasks 1.1–1.18 strictly in order with the doc 14 §2 loop.
Task 1.4 (write failing S1–S4 tests) MUST precede 1.6/1.8/1.9/1.10 —
red tests first. Task 1.18 is a gate, not a formality: every S-criterion
green or evidenced before you declare Phase 1 complete.
```

### Phase 2 prompt (per carrier — parameterize {CARRIER})
```
Read docs/14, docs/08 §5 (provider interface), docs/task-log.md.
Implement providers/{CARRIER} via the doc 14 loop:
  provider class → destination config (URL+credential in destination
  service ONLY, S1) → status_map entries → webhook verify (HMAC,
  timestamp, S5) → sandbox fixtures for rate/book/void/webhook →
  re-run S1, S5, S6 against the new provider.
DONE = all four operations green against {CARRIER} sandbox + unknown-status
fail-closed re-verified. Surface if the carrier lacks webhooks (Open Item
#12) — that needs a poller variant decision, not improvisation.
```

### Phase 3 prompt (per region — parameterize {REGION})
```
Read docs/14, docs/13 (user admin), docs/11 Phase 3, docs/task-log.md.
This phase is CONFIG, not code: carrier_accounts + routes + printers +
sla_thresholds rows, destinations, role collections per docs/13 §2 naming,
plant address verified (Open Item #4 for {REGION}), sender email config.
Loop rule addition: if any task appears to require a code change, that is
classification (d) — design gap. Surface it; do not code around it.
DONE = a {REGION} test user books and prints a {REGION} parcel end-to-end,
and cross-region S3 checks still pass.
```

---

## 4. Session hygiene

- **Start of session:** read task-log.md — resume at the first non-DONE task.
- **End of session:** ensure task-log.md reflects reality — an agent that crashes mid-task should leave a SURFACED entry, not silence.
- **Doc drift:** if execution reveals a doc is wrong, the fix goes in the same commit as the discovery, and the task-log entry names the doc change.
