# Loop Protocol — Autonomous Multi-Unit Execution

OPC flows handle single build→review→gate cycles. This protocol sits **above** flows, orchestrating multi-unit feature delivery across sessions.

## When to Use

Use the loop protocol when:
- A task requires multiple independent units of work (e.g., a feature with spec, backend, frontend, tests)
- The user says "build this feature", "implement F1-F4", or gives a multi-step backlog
- The task will take more than one flow cycle to complete
- The user explicitly requests autonomous/loop/24-hour execution

Do NOT use for single-cycle tasks (a code review, a single bug fix, a brainstorm).

## State Machine

```
┌─────────────────────────────────────────────────────┐
│                    LOOP STATE                        │
│                                                      │
│  plan.md ──→ decompose ──→ loop-state.json          │
│                               │                      │
│              ┌────────────────┤                      │
│              ▼                │                      │
│         ┌─────────┐    ┌─────┴─────┐                │
│         │  TICK N  │───▶│  TICK N+1 │───▶ ...       │
│         └─────────┘    └───────────┘                │
│              │                                       │
│         Each tick runs one OPC flow                  │
│         (build-verify, review, etc.)           │
│                                                      │
│              ▼                                       │
│         next_unit = null ──→ AUTO-TERMINATE          │
└─────────────────────────────────────────────────────┘
```

## Terminology

- **Flow** = single-round node graph (`build-verify`, `review`, etc.). Runs within one tick.
- **Runbook** = multi-round autonomous procedure. Defines the unit sequence for an entire task across many ticks.

## Runbook Discovery

Before decomposing a task from scratch, check for existing runbooks:

```
Discovery order (matches `opc-harness runbook` CLI exactly):
1. --dir <path>          (flag passed to opc-harness runbook)
2. OPC_RUNBOOKS_DIR      env var
3. ~/.opc/runbooks/      (user-global default)
```

The CLI does **not** scan project-local `.opc/runbooks/` automatically
and does **not** auto-generate runbooks on a miss. If you want a
project-local runbook, point `OPC_RUNBOOKS_DIR` at `.opc/runbooks/`
in the project's setup script (or pass `--dir .opc/runbooks/` to the
harness invocation). Saving generated plans back to disk is a manual
step today — see `docs/runbooks.md` for the full schema and the
`examples/runbooks/add-feature.md` seed as a reference.

**If runbook found (matchRunbook returns a match):**
1. Use the best-matching runbook's `units:` list as the plan
2. Use its `flow:` as the per-unit flow template (overrides auto-detection)
3. Use its `tier:` as the quality tier (if set)
4. Skip Step 1 (Plan Decomposition) — the runbook IS the plan
5. In interactive mode, confirm the chosen runbook with the user; in
   auto mode, print the match + score and proceed

**Disable runbooks per-invocation:**
- `OPC_DISABLE_RUNBOOKS=1 opc-harness runbook match …` — forces a
  match-miss without scanning disk (exit 3, payload `disabled: true`).
  This is the wired escape hatch; use it in the orchestrator when the
  user wants to force fresh decomposition.
- `/opc loop --no-runbook <task>` is *planned* CLI sugar that would
  set the env var for one invocation. **Not yet wired into `/opc loop`
  arg parsing as of v0.8** — until it lands, set the env var directly.

**If no runbook found:**
1. Proceed to Step 1 (Plan Decomposition) as normal
2. (Optional) After decomposition, suggest the user save the generated
   plan to `~/.opc/runbooks/{task-slug}.md` for reuse. There is no
   auto-write step — the orchestrator only emits the suggestion.

## Procedure

### Step 0 — Runbook Lookup (before decomposition)

Before Step 1, shell out to:

```bash
opc-harness runbook match "<task phrase>" [--dir <runbook-dir>]
```

- Exit `0` + `matched: true` → **skip Step 1**. Adopt the returned
  runbook's `units`, `flow`, `tier`, `protocolRefs` as the plan. Write
  them into `$SESSION_DIR/plan.md` with a header noting which runbook fired
  and the score.
- Exit `3` (match-miss) → proceed to Step 1.
- To force a miss without scanning disk, prepend `OPC_DISABLE_RUNBOOKS=1`
  to the command. The CLI returns exit 3 with `disabled: true` in the
  payload. (Once `/opc loop --no-runbook` ships in CLI parsing, it will
  set this env var for you.)

Rationale: matching is cheap (O(#runbooks × #patterns)), and a reused
plan avoids a full LLM decompose round. See `docs/runbooks.md` for the
schema and `examples/runbooks/add-feature.md` for a canonical seed.

### Step 0.5 — Codebase Reconnaissance (MANDATORY)

Before decomposing, you MUST explore the existing codebase and write a recon summary. This prevents planning units that duplicate existing work.

**What to capture** (write to `$SESSION_DIR/recon.md`):
- Directory structure of relevant areas
- Existing tests and their coverage
- Already-implemented features related to the task
- Key files that will be touched

**How to pass it:**
```bash
node "$OPC_HARNESS" init-loop \
  --plan $SESSION_DIR/plan.md \
  --recon $SESSION_DIR/recon.md \
  --dir $SESSION_DIR
```

The harness validates: file exists + ≥ 200 chars. If you skip recon, you risk decomposing into units that rebuild what's already there.

### Step 1 — Plan Decomposition

Given a task or feature backlog, decompose into **atomic units**. Each unit is one OPC flow invocation.

Rules for decomposition:
- **Implement and review are SEPARATE units.** Never combine build + review in one tick. The builder's context pollutes the reviewer's judgment.
- **Each unit has verifiable output.** Tests pass, screenshots captured, API responds correctly.
- **Each unit has one commit.** Atomic commits enable git bisect.
- **Tests are EXPLICIT units, not afterthoughts.** If an implement unit produces code that needs tests, the tests MUST be a separate unit (or part of the implement unit's verify line). Do not assume "the implement tick will write tests too" — if tests are important, give them their own unit or make them a hard gate in verify.
- **Meta work is a unit.** Version bumps, documentation sync, changelog entries, config updates — anything that must ship with the feature gets its own unit. If it's not in the plan, it won't get done.
- **Nothing defers to "next loop."** Every item the plan intends to deliver MUST have a unit. If you find yourself thinking "we'll handle that later" — add a unit now. The loop's job is to finish what it starts.

Standard unit sequence for a feature:

```
{F}.1  spec          — acceptance criteria, API contract, data model
{F}.2  implement-a   — backend / core logic
{F}.3  review-a      — independent subagent review of {F}.2
{F}.4  fix-a         — address 🔴 and 🟡 findings from review
{F}.5  implement-b   — frontend / UI
{F}.6  review-b      — independent subagent review of {F}.5
{F}.7  fix-b         — address findings
{F}.8  e2e-verify    — end-to-end user path verification
{F}.9  accept        — final acceptance against spec criteria
```

Adjust based on feature complexity:
- Simple feature (single-file fix): skip spec, merge implement+review into 2-3 units
- Complex feature (new subsystem): add design unit between spec and implement
- Pure backend: skip implement-b/review-b/fix-b

Write the plan to `$SESSION_DIR/plan.md` with unit numbers, descriptions, and acceptance criteria per unit.

**Each unit in plan.md MUST include a verification method.** This is not optional — it's how each tick knows how to verify itself after context compaction.

Format per unit:
```markdown
- F1.2: implement-backend — User authentication with email/password
  - verify: `npm test -- --grep "auth"` passes; `curl -X POST /api/auth/login` returns 200 with token
  - eval: No plaintext passwords in code; session expires after 24h; handles duplicate email gracefully
```

The `verify:` line tells the implement tick what to run. The `eval:` line tells the review tick what to look for. Without these, the tick either skips verification (quality hole) or guesses wrong (wasted time).

### Step 1.5 — Definition of Done (Pre-Flight)

Before writing plan.md, establish a global definition of done. Follow the "Definition of Done — Mandatory Pre-Flight" section in skill.md. The three questions (what does done look like, how to verify, how to evaluate) must be answered and written to `$SESSION_DIR/acceptance-criteria.md`.

Per-unit verify/eval lines in plan.md are derived from these global criteria.

### Step 2 — Initialize Loop State

Write `$SESSION_DIR/loop-state.json`:

```json
{
  "tick": 0,
  "unit": null,
  "description": "Loop initialized",
  "status": "initialized",
  "artifacts": [],
  "next_unit": "{first unit id}",
  "blockers": [],
  "review_of_previous": "",
  "plan_file": "$SESSION_DIR/plan.md"
}
```

### Step 3 — Start Loop

Use CronCreate to schedule the tick prompt:

```
cron: "*/10 * * * *"   (every 10 minutes, or user-specified interval)
prompt: <the tick execution prompt — see Tick Prompt below>
recurring: true
durable: true          (MANDATORY for autonomous runs — survives process restart)
```

Then immediately execute the first tick (don't wait for cron).

### Step 4 — Tick Execution

Each tick follows this sequence:

```
1. Read loop-state.json → get next_unit
2. Read plan.md → get unit details and acceptance criteria
3. Skill check (pre-work): scan your session context for installed skills
   designed for pre-task preparation (memory recall, context loading, etc.).
   If any are found, invoke them now — before starting the unit.
4. Review previous tick's output (review_of_previous)
5. If previous tick has unfixed issues → fix first, then proceed
6. Determine unit type → select OPC flow template:
   - spec/design units      → discussion protocol (no flow, direct execution)
   - implement units        → build-verify flow OR direct implementation
   - review units           → review flow with independent subagents
   - fix units              → direct implementation targeting review findings
   - e2e-verify units       → executor-protocol (orchestrator runs directly)
   - accept units           → pre-release flow
   - **custom handler**     → if `next-tick` returns `handler`, dispatch to that skill/command instead of OPC's built-in dispatch (see Unit Handlers below)
7. Execute the flow
8. Verify output:
   - Tests pass (pytest, vitest, etc.)
   - Build succeeds (vite build, cargo build, etc.)
   - UI changes → screenshot verification (MANDATORY, not optional)
   - API changes → curl/httpie verification
9. Git commit (atomic, one per unit)
10. Skill check (post-work): scan your session context for installed skills
    designed for post-task capture (knowledge retro, learning capture, etc.).
    If any are found, invoke them now — before writing loop-state.
11. Write updated loop-state.json (see format below)
```

### Step 5 — Verification Gate (per tick)

**Every tick MUST produce verification evidence.** This is not optional.

| Unit type | Required evidence |
|-----------|------------------|
| implement | Tests pass + build clean |
| implement (with UI) | Tests pass + build clean + screenshot |
| review | eval-{role}.md files with 🔴/🟡/🔵 severity |
| fix | Tests still pass + specific findings addressed |
| e2e-verify | Playwright/curl output showing user path works |
| accept | All acceptance criteria checked off with evidence |

If evidence cannot be produced (tool unavailable, test infra broken):
- Write `status: "blocked"` in loop-state.json
- Write `blockers: ["description of what's missing"]`
- Skip to next unblocked unit (if any)
- Do NOT mark as completed without evidence

### Step 6 — Loop State Update

After each tick, write:

```json
{
  "tick": N,
  "unit": "{completed unit id}",
  "description": "{what was done, concisely}",
  "status": "completed",
  "artifacts": ["{file paths or test output references}"],
  "next_unit": "{next unit id, or null if done}",
  "blockers": [],
  "review_of_previous": "{assessment of previous tick's quality}"
}
```

### Step 7 — Auto-Termination (with Backlog Drain)

When `opc-harness next-tick` returns `terminate: true`:

**7a. Check backlog before terminating.**

If `next-tick` returns `backlog.open_items > 0`, the orchestrator MUST attempt a **backlog drain** before declaring the pipeline complete:

1. Read `$SESSION_DIR/backlog.md` — parse all `- [ ]` items
2. Filter to actionable items (🔴 and 🟡 findings that map to code changes)
3. Group by theme → generate fix/implement + review unit pairs
4. Call `opc-harness reinit-loop` (if loop is stalled) or create a **new mini-plan** and call `opc-harness init-loop` with it in a fresh `.harness-drain/` directory
5. Execute the drain units

**Drain limits (prevent infinite loops):**
- Maximum **1 drain cycle** per pipeline run. If the drain itself produces new backlog items, those go to the final summary — no second drain.
- Maximum **6 drain units** (3 implement+review pairs). If backlog has more than 6 actionable items, pick the 🔴 items first, then 🟡 by severity. Remaining items go to final summary.
- Drain ticks share the parent loop's `_max_total_ticks` budget. If budget is exhausted, skip drain.

**7b. If no backlog or drain complete → terminate.**

1. Set `next_unit: null` and `status: "pipeline_complete"`
2. Cancel the cron job (CronDelete)
3. Write a summary to `$SESSION_DIR/progress.md`:
   - Total ticks
   - Units completed
   - Any skipped/blocked units
   - Outstanding items from `$SESSION_DIR/backlog.md` (should be 0 or only 🔵 suggestions after drain)
4. Generate HTML report:
   ```bash
   node "$OPC_HARNESS/../opc-report.mjs" --dir $SESSION_DIR --output $SESSION_DIR/report.html --title "{task summary}"
   ```
5. Notify user: `✅ Pipeline complete. {N} units delivered in {M} ticks. Report: $SESSION_DIR/report.html`

**7c. Final summary must NOT contain "defer to next loop."**

If any actionable items remain after drain (or if drain was skipped due to budget), the summary MUST:
- List them explicitly with severity
- Explain WHY they weren't addressed (budget exhausted / drain limit reached / not actionable)
- Never use vague language like "deferred" or "future work" — say exactly what's left and why

**Do NOT** let the cron continue firing with `next_unit: null`. Auto-terminate.

### Step 8 — Stall Detection

If the same unit appears in 2 consecutive ticks with status "completed" but next_unit unchanged:

1. Decompose the stalled unit into smaller sub-units
2. Update plan.md with the sub-units
3. Reset next_unit to the first sub-unit

If the same unit appears in 3 consecutive ticks → stop the loop, surface to user:
```
⛔ Stalled on unit {X} for 3 ticks. Needs human input.
```

### Step 9 — Context Resilience

Each tick prompt MUST be self-contained. After context compaction, the orchestrator loses:
- skill.md procedural instructions
- CLAUDE.md project conventions  
- Review independence requirements
- Backlog management rules

**Mitigations:**
1. The tick prompt explicitly lists critical rules (see Tick Prompt Template above)
2. Use `durable: true` on CronCreate so the tick prompt survives process restart
3. Each tick should re-read protocol files, not rely on in-context memory
4. Keep individual ticks small (one flow, not full-stack) to reduce context pressure

**What cannot be recovered after compaction:**
- Project-specific conventions from CLAUDE.md (mitigate: include key rules in plan.md)
- Nuanced understanding of acceptance criteria (mitigate: write detailed criteria in plan.md per unit)
- Previous tick's detailed reasoning (mitigate: write key decisions to progress.md)

## Tick Prompt Template

The cron job should schedule this prompt (adapt paths to project):

```
Read $SESSION_DIR/loop-state.json and $SESSION_DIR/plan.md.
Read $SESSION_DIR/acceptance-criteria.md for the definition of done.
Re-read the full loop-protocol.md and skill.md protocols — do NOT rely on memory from previous ticks.
Find the current unit's verify: and eval: lines in plan.md — these tell you HOW to verify this specific unit.
Key rules to re-verify each tick:
  - Review units MUST dispatch ≥2 independent subagents via Agent tool (never self-review)
  - Implement/fix units MUST produce a git commit
  - UI units MUST include a screenshot artifact
  - Use the unit's verify: line to run the correct verification command
  - Use opc-harness complete-tick with actual artifact paths (never skip)
  - On blocked/failed, include --description explaining why
  - Pre-work: if any installed skills handle pre-task recall/preparation, invoke them before starting
  - Post-work: if any installed skills handle post-task retro/capture, invoke them after completing
Execute the current next_unit. After completion, call opc-harness complete-tick, then opc-harness next-tick.
If next-tick returns terminate:true, call CronDelete to stop the loop.
```

## Review Units — Mandatory Independence

Review units MUST use independent subagents (Agent tool). The orchestrator:

1. Dispatches 2-5 reviewer agents in parallel via Agent tool
2. Each agent gets: file list, acceptance criteria, project context
3. Each agent produces eval-{role}.md with 🔴/🟡/🔵 findings
4. Orchestrator collects evals and writes handshake
5. Orchestrator does NOT modify or filter findings

**Anti-patterns:**
- ❌ Orchestrator doing the review itself ("let me check the code...")
- ❌ Switching personas in the same context ("now I'll be the security reviewer...")
- ❌ Filtering findings before writing them ("this 🟡 isn't important, skip it")

## External Validators — Leverage What Already Exists

LLM subagent reviews are same-model cosplay. True independent validation comes from **external tools the project already has**. These are not optional extras — they are the backbone of quality assurance in autonomous runs.

### The Validation Stack (outermost = hardest to bypass)

1. **Pre-commit hooks** (lint, typecheck, format) — triggered by `git commit`, agent cannot skip (`--no-verify` is prohibited by CLAUDE.md and harness checks git HEAD). Hook failure = no commit = complete-tick hard error.
2. **Test suites** (`npm test`, `pytest`, `cargo test`) — agent runs these to produce artifact evidence. Harness validates artifact exists, has test fields, and is recent.
3. **E2E / visual verification** (Playwright, webapp-testing skill) — produces screenshots that harness validates for UI units. Browser rendering is ground truth no LLM can fake.
4. **CI pipeline** (GitHub Actions, etc.) — truly out-of-process. Runs on push, independent of agent.

### How to Leverage Per Unit Type

| Unit type | External validator | Enforcement |
|---|---|---|
| implement/build | pre-commit hooks + test suite | git HEAD must change (hard error) |
| implement-ui | above + Playwright screenshot | screenshot artifact required (hard error) |
| review | LLM subagents + lint/typecheck findings | ≥2 distinct eval files (hard error) |
| fix | pre-commit hooks + test suite | git HEAD must change + eval hashes intact |
| e2e-verify | Playwright / webapp-testing | screenshot + test-result artifact |

### Discovery at Init

At `init-loop`, the orchestrator SHOULD probe for available validators:
- Check for `.husky/`, `.git/hooks/pre-commit`, `.pre-commit-config.yaml`
- Check for `package.json` scripts (`test`, `lint`, `typecheck`)
- Check for `playwright.config.*`, `cypress.config.*`
- Check for `.github/workflows/`
- Record findings in plan.md so each tick knows what validators to invoke

### Key Principle

**The agent that does the work is supervised by tools it doesn't control.** Pre-commit hooks are executed by git, not by the agent. CI is executed by GitHub, not by the agent. This is real independence — not same-model-different-prompt cosplay.

## Unit Handlers — External Skill Dispatch

When a loop is initialized with `--flow-template` or `--handlers`, certain unit types can be dispatched to external skills instead of OPC's built-in flow dispatch.

### How It Works

1. `init-loop --flow-template <name>` stores the template name in `_flow_template`
2. `next-tick` looks up the unit type in the template's `unitHandlers` (or `_unit_handlers` from `--handlers`)
3. If a handler is found, `next-tick` returns it in the `handler` field:
   ```json
   {
     "ready": true,
     "next_unit": "D1.2",
     "unit_type": "discover",
     "handler": { "skill": "/dw-discover", "invocation": "/dw-discover {task}" }
   }
   ```
4. The orchestrator invokes the handler's skill/command **instead of** the built-in dispatch table

### Handler Resolution Order

1. Flow template's `unitHandlers` (looked up via `_flow_template` in loop-state)
2. Inline `_unit_handlers` (set via `--handlers` at init-loop time)
3. OPC's built-in dispatch (spec→discussion, implement→build-verify, review→review, etc.)

First match wins. If no handler matches, fall back to built-in dispatch.

### Handler Object Schema

```jsonc
{
  "skill": "/dw-discover",              // skill invocation (mutually exclusive with command)
  "invocation": "/dw-discover {task}",   // optional: full invocation string with placeholders
  "command": "dw publish {id}"           // CLI command alternative (mutually exclusive with skill)
}
```

Placeholders: `{task}` = unit description from plan.md, `{id}` = unit ID.

### Example: dreamworks Using OPC Loop with Custom Handlers

```bash
# dreamworks initializes a loop with its own unit type handlers
node "$OPC_HARNESS" init-loop \
  --plan $SESSION_DIR/plan.md \
  --flow-template pitch-ready \
  --dir $SESSION_DIR

# Or with inline handlers (no flow template needed):
node "$OPC_HARNESS" init-loop \
  --plan $SESSION_DIR/plan.md \
  --handlers '{"discover":{"skill":"/dw-discover"},"pitch":{"skill":"/dw-pitch"}}' \
  --dir $SESSION_DIR
```

When `next-tick` encounters a `discover` unit, it returns the handler. The orchestrator (dreamworks) invokes `/dw-discover` instead of OPC's default `build-verify` flow.

Unit types without a matching handler fall through to OPC's built-in dispatch table — so an orchestrator only needs to override the types it cares about.

## Backlog Management

During execution, unaddressed findings accumulate. The loop maintains `$SESSION_DIR/backlog.md`:

- Gate 🔴/🟡 findings not fixed in the current cycle → auto-accumulated by harness
- Devil's advocate product concerns → append to backlog
- Skipped units due to blockers → append to backlog
- Nice-to-have improvements discovered during implementation → append to backlog

Format:
```markdown
## Backlog

- [ ] 🔴 [F4 review] SQL injection in user handler _(from eval-security.md)_
- [ ] 🟡 [F4 review] No frontend component tests — parseChoices() untested _(from eval-quality.md)_
- [ ] ⏭️ [F4 skip] CoachDashboard diagnostic panel — needs backend API change
```

**Backlog is not a parking lot.** It's a queue that gets drained at pipeline end (see Step 7a). Items should only survive to the final summary if:
- They are 🔵 suggestions (nice-to-have, not blocking)
- The drain budget was exhausted (max 1 cycle, max 6 units)
- They require external input the loop cannot provide

## File Layout

```
$SESSION_DIR/
├── plan.md              # Unit decomposition + acceptance criteria
├── loop-state.json      # Current tick state (the cursor)
├── backlog.md           # Accumulated unaddressed items
├── progress.md          # Human-readable narrative log
└── nodes/               # Per-node artifacts (same as standard OPC)
```
