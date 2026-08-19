---
feature: rust-agent-harness
date: 2026-08-19
revised: 2026-08-19
risk: CRITICAL
status: draft
supersedes-draft: "v1 of this file (2026-08-19), reviewed in docs/superpowers/reviews/2026-08-19-rust-agent-harness-review.md; rev. 2 superseded same day by the §3.3 process split"
pending: [architect-pass, critic-pass, security-reviewer-pass, tracer-evidence-loop, verifier-pass]
reviewers: [architect, critic, security-reviewer, verifier, tracer]
build-order: "Phase 0 (process split + sandbox + eval + headless) → 1 (kernel) → 2 (accuracy levers) → 3 (TUI) → 4 (multi-terminal)"
target-crate: crates/mega-agent
---

# Rust Agent Harness & Multi-Terminal Conductor — Design (rev. 3)

> **Revision note.** This is a rewrite of the 2026-08-19 draft following
> `docs/superpowers/reviews/2026-08-19-rust-agent-harness-review.md`. Every
> finding B1–B7 and N1–N10 is either resolved here or recorded in §14 as an
> accepted deviation. The review remains the authoritative record of *why* the
> first draft changed; this file is the authoritative record of *what we build*.

---

## 1. Overview & Goal

`mega-agent` is a native Rust coding-agent harness. The reason to own a harness
rather than connect to one is that the harness assembles the request, and request
assembly is where both token cost and coding accuracy are decided. Nothing
downstream of a harness can repair a badly assembled prompt.

**The goal is a number.** For a fixed model and a fixed task suite, running
through `mega-agent` must produce a higher resolve rate and a lower token cost
per resolved task than running the same model through a minimal baseline loop.
That delta — not cold-start milliseconds — is what this project owns.

Four properties follow from it, in priority order:

1. **Higher coding accuracy** than the same model on a bare loop (§4 measures it;
   §7, §8, §9 are the levers).
2. **Fewer tokens** per resolved task, without the prompt-cache churn that
   cancelled our previous compression gains (§6).
3. **Faster where it is felt** — time to first token and tool round-trip, not
   process startup (§10).
4. **Safe by default** — the harness runs unattended shell across multiple
   worktrees, which is why this spec is CRITICAL (§11).

The multi-terminal capability (§5) is a delivery mechanism for (1): N terminals
either parallelise independent tasks or race candidate solutions against the
test suite.

---

## 2. Risk Level — CRITICAL

Upgraded from HIGH on 2026-08-19 by operator directive, per the review's B5.

**Justification.** The harness executes unattended shell commands across N git
worktrees inside the operator's own repository. That matches
`docs/conventions/risk-modes.md` CRITICAL verbatim: *"anything that deletes user
data, anything that mutates user repos beyond known ignore patterns."*
`@megasaver/agent-office` already grades the same activity (agent spawning)
CRITICAL. Grading this HIGH while the TypeScript package that spawns agents is
CRITICAL was an inconsistency, not a judgement.

**What CRITICAL pulls in** (`risk-modes.md` §CRITICAL), all blocking Phase 1:

| Requirement | Status |
|---|---|
| Full HIGH chain (spec → plan → TDD → verify → review) | in progress |
| `architect` pass on the design | pending |
| `critic` adversarial pass | pending |
| `security-reviewer` pass (sandbox escape, fence bypass, secret handling) | pending |
| `tracer` evidence loop | pending |
| `verifier` pass with reproduction evidence | pending |
| Worktree isolation — no `main` edits | required |
| Manual operator confirmation recorded in this spec | §13 |
| **Forbidden:** unsupervised or self-referential loops | see §11.4 |
| Skill mode: debug + evidence only, no log compression | required |

Risk may not be lowered to skip any of the above. Wanting to lower it is a signal
to keep the skill.

---

## 3. Architecture

### 3.1 The Rust/TS boundary

The differentiating logic — `output-filter`, `context-gate`, `fence`, `stats`,
`long-memory`, `memory-graph`, `retrieval`, `policy`, `indexer` — is TypeScript,
roughly 30 packages, carrying years of measured behaviour and a documented
ReDoS-hardening history. Reimplementing it in Rust means maintaining two
divergent copies of the product's crown jewels.

**The cut is by hot path, not by package.**

| Frequency | Work | Where |
|---|---|---|
| **Per token** (~10²–10³ / turn) | SSE parse, TUI render, input handling | **Rust** |
| **Per tool call** (~10¹ / turn) | Tool dispatch, process supervision, worktree ops, sandbox entry, edit apply | **Rust** |
| **Per turn** (~10⁰ / turn) | Context assembly, repo map, memory recall, output filtering, fence evaluation, token accounting | **TS daemon over loopback HTTP** |

A per-turn crossing costs ~1 ms against a multi-second model call — unmeasurable.
`packages/daemon` already ships the singleton lock, loopback transport, and
lazy-spawn client, so the seam exists. Only the first spawn pays Node startup,
and it is paid once per machine, not once per turn.

**The transport, stated exactly** (verified against `packages/daemon/src/`, not
assumed — an earlier draft of this spec said "UDS", which is wrong and would have
produced a client that cannot connect):

- `node:http` server bound hard to `127.0.0.1` on an ephemeral port
  (`server.ts` — "must never bind beyond loopback. No host override").
- Every request carries `Authorization: Bearer <token>`; a missing or wrong token
  is a bare `401`.
- Discovery: `<storeRoot>/daemon/daemon.json`, mode `0600`, holding
  `{ port, token, pid, startedAt }`. The client re-checks `pid` before trusting a
  discovered port, because a stale record otherwise hands the bearer token to
  whatever local process next grabbed that port (`client.ts:40`).
- `meshSocketPath()` **is** a UDS, but it belongs to the mesh hub alone. It is not
  the harness's transport.

**Routes that exist today:** `/status`, `/mesh/status`, `/shutdown`, `/excerpt`,
`/expand`, `/exec`, `/search`, `/recall`, and the four `*-registry` variants.

**Routes this spec assumes and that do not exist yet:** fence evaluation (§11.2),
output-filter over diagnostics (§8), repo map (Phase 2), failed-run rules (§6.5),
task assignment (§5.2). Each is a TypeScript task in the phase that first consumes
it, written against the existing `handlers.ts` pattern with a Zod boundary schema.
A phase that needs a route it did not build is blocked, not degraded.

If profiling later puts a per-turn call in the top five, that single function is
ported to Rust with the TypeScript retained as a conformance oracle (differential
test, both must agree on a fixed corpus).

### 3.2 Component diagram

The trust boundary from §3.3 is the horizontal rule near the bottom: everything
above it runs sandboxed with no network; the supervisor below it is the only
Rust component that holds a socket.

```
┌════════════════ AGENT CHILD — sandboxed, network: none (§3.3, §11.1) ══════════┐
│ 1. AGENT KERNEL                                                                │
│    ├── Conversation state machine (Idle→Plan→Act→Observe→Verify→Done)          │
│    ├── Tool-call dispatch + malformed-call retry + stop conditions             │
│    ├── Turn/step/token budgets and circuit breakers                            │
│    └── Compaction trigger at the context ceiling (§6.3)                        │
├────────────────────────────────────────────────────────────────────────────────┤
│ 2. TOOL LAYER                                                                  │
│    ├── EditApply (search/replace ladder, apply_success_rate) …………………… §7       │
│    ├── Bash (OS sandbox: seatbelt / Landlock+seccomp) ………………………………… §11      │
│    ├── Read / Grep / Glob (fence-checked via daemon)                           │
│    ├── Diagnostics (tsc / cargo check / ruff / go build / LSP) …………… §8        │
│    ├── Worktree + Checkpoint (shadow git) ……………………………………………………… §9, §11.3   │
│    └── MCP client (stdio + HTTP) ………………………………………………………………… §12.3          │
├────────────────────────────────────────────────────────────────────────────────┤
│ 3. MODEL DRIVER                                                                │
│    ├── 3 wire formats: Anthropic / OpenAI-compatible / Gemini …………… §10.2      │
│    ├── Prompt-cache invariant enforcement (append-only prefix) ………… §6         │
│    └── Config-first per-role routing + fallback on 429/5xx                     │
├────────────────────────────────────────────────────────────────────────────────┤
│ 4. MESH CLIENT (thin — no second mesh)                                          │
│    └── presence + role + task pull via @megasaver/mesh & agent-office ……… §5   │
├────────────────────────────────────────────────────────────────────────────────┤
│ 5. TUI (ratatui + crossterm) ……………………………………………………………………… §10.3, Phase 3   │
├────────────────────────────────────────────────────────────────────────────────┤
│ 6. OBSERVABILITY: events framed to the supervisor, which writes them ……… §4.5  │
└════════════════════════════════════════════════════════════════════════════════┘
                    │ inherited stdin/stdout pipes · len-prefixed JSON        
                    │ model.* · daemon.* · event (the agent cannot write the journal)
                                     ▼
┌──────────── SUPERVISOR — unsandboxed, holds both connections (§3.3) ───────────┐
│ spawns agents · proxies model and daemon calls · budgets · journal writer      │
│ no filesystem work of its own — small enough to audit                          │
└────────────────────────────────────────────────────────────────────────────────┘
             │ HTTPS to the model provider        │ loopback HTTP + bearer token
                                     ▼
┌───────────────── @megasaver/daemon (TypeScript, warm sidecar) ─────────────────┐
│ context-gate · output-filter · fence · indexer (repo map) · long-memory        │
│ memory-graph · retrieval · policy · stats                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 The process model — supervisor and agent

Two processes, and the split is a security boundary, not an optimisation.

| | Supervisor (`mega-agent`, process 1) | Agent (child, one per arm / task / worker) |
|---|---|---|
| Sandbox | none | **`workspace-write`, network literally none** |
| Holds | the model API connection, the daemon HTTP connection | one inherited pipe pair, nothing else |
| Does | spawns agents, proxies their model and daemon calls, enforces budgets, writes the NDJSON journal | every filesystem read/write, every edit apply, every `bash` |
| Trust | same as the operator's shell — it is what the operator typed | model-directed; assume it is hostile |

They speak over the child's own **stdin/stdout pipe pair** — already inherited,
already bidirectional, and needing neither `unsafe` nor a `libc` dependency nor
platform-specific fd passing. Frames are 4-byte big-endian length + JSON. Two
message families: `model.*` (a chat completion, streamed back frame by frame)
and `daemon.*` (a named daemon route plus its JSON body). The agent never learns
the daemon's port or bearer token, and has no socket it could use if it did.

Its diagnostics go to stderr, which the supervisor forwards unchanged. Its
**events go down the pipe as a third family, `event`** — because the NDJSON
journal (§4.5) lives outside the worktree, and outside the worktree is outside
the only tree the profile makes writable. The supervisor owns the file; the agent
owns nothing but the pipe. This is not a workaround for the sandbox, it is the
sandbox being consistent: if the agent could append to a file outside its
worktree, the boundary would already be broken.

| Frame kind | Direction | Body |
|---|---|---|
| `model.chat` | agent → supervisor | a serialised chat request |
| `chunk` | supervisor → agent | one streamed completion chunk |
| `end` | supervisor → agent | stream complete, no body |
| `error` | supervisor → agent | the provider failed; a message string |
| `daemon.<route>` | agent → supervisor | the route's JSON body |
| `event` | agent → supervisor | one journal event, written by the supervisor |

**One emitter per event type**, assigned by which process holds the evidence.
The supervisor times the socket and therefore owns `agent_started`, `ttft`, and
`usage`; the agent ran the turn and the tool and therefore owns `turn_started`,
`tool_call`, and the edit outcomes; the eval driver decides pass/fail and owns
`run_started` and `task_finished`. The trap is `usage`, which reaches the agent
as a forwarded chunk and the supervisor as a real one: if both emit it, every
token metric doubles and every gate still passes.

The supervisor serves one turn at a time and is **not** reading the pipe while it
streams a completion, so agent events emitted mid-stream wait in the pipe buffer
until that turn ends. The agent must therefore not emit more than a pipe buffer's
worth of events between `model.chat` and `end` — on the order of 64KB against
~100-byte events, which no real turn approaches, and a deadlock rather than a
slowdown if one ever does. The kernel (§5) emits in `Observe`, after the stream
has drained; the baseline arm emits inside the loop and stays under the bound by
having almost nothing to say.

The frame layer is deliberately **opaque to payload types**: it moves
`{kind, body}` where body is arbitrary JSON. The provider layer serialises its
own request types into that body. Without this the RPC module would depend on
the provider module, which is built later and for a different reason.

**Why this shape and not a single self-sandboxing process.** A process that
sandboxes itself with no network cannot call the model, so a single process must
carve the model endpoint — an outbound internet host — out of its own sandbox.
That is precisely the exfiltration path §11.1 exists to close. Splitting moves
both connections to the side of the boundary that never executes model-chosen
code, which is what makes "network: none" a true statement rather than a
qualified one.

**What this buys, listed so it is not re-litigated:**

1. **In-process writes are covered.** The harness's own `write` and edit-apply
   are ordinary `fs::write` calls, invisible to a sandbox that only wraps child
   `Command`s. Under a process-level profile they are inside it. Without this,
   §11.2's central claim — no fenced path is writable by any route — is false.
2. **Both eval arms run in the same box.** Arm A is a real agent loop with real
   `bash`; running it unsandboxed to collect measurements is the thing the
   harness is supposed to prevent. Identical containment on both arms also
   removes an environment asymmetry from the comparison (§4).
3. **Workers are just more children.** Phase 2's multi-terminal workers need
   per-turn daemon access from inside a sandbox. Under this model they get it
   through the supervisor like everything else, so no new mechanism and no
   carve-out is ever introduced later.
4. **The supervisor is the policy chokepoint.** It is the one place that can
   refuse a daemon route to a worker, cap spend, or kill a runaway. A carve-out
   gives that away to the kernel's packet filter, which cannot tell `/status`
   from `/exec`.

**Cost, stated honestly:** one process split and a small framed-RPC module
(~150–200 LOC) that Phase 0 must carry before the first model call. The
supervisor does no filesystem work and no parsing beyond the frame header, which
is what keeps the unsandboxed side small enough to audit.

**Sequencing consequence.** Containment must exist before anything runs a model
loop, so the sandbox and the split land in Phase 0, ahead of Arm A — not in
Phase 1 as the previous plan had it.

---

## 4. The Eval Loop (Phase 0 — built before anything else)

Without this the spec is unfalsifiable against its own purpose, and the project
will optimise what it can measure (milliseconds) instead of what it exists for.

### 4.1 Two-arm design

Mirrors the discipline in `@megasaver/bench-replay`: *a measurement tool that
silently drifts is worse than no tool.* A refusal to emit a verdict is the
instrument working.

- **Arm A (baseline):** the same model over the bare provider API with a minimal
  read / edit / bash loop and no harness features.
- **Arm B (harness):** the same model, same task set, same seed, through
  `mega-agent`.
- Both arms are driven through the headless interface (§12.1). Arm A is a ~200-line
  reference loop kept in `crates/mega-agent/src/bin/baseline.rs` precisely so it
  stays honest and cheap.

### 4.2 Metrics

| Metric | Definition | Gate |
|---|---|---|
| `resolve_rate` | tasks whose test suite passes after the run | **primary** — no feature merges if it regresses |
| `tokens_per_resolved` | total in+out tokens ÷ resolved tasks | must not regress |
| `apply_success_rate` | edits applied ÷ edits attempted (§7) | floor ≥ 98% |
| `cache_read_ratio` | cache-read ÷ (cache-read + cache-creation) tokens (§6) | must not regress |
| `wall_clock_per_task` | p50, p95 | reported, not gated |

### 4.3 Task suite and budget

`decisions/a4-closed-under-model` records that there is no API budget for paid
replay. Therefore:

- The loop runs against a **local model** (Ollama / vLLM, qwen-coder class) by
  default. Absolute resolve rates will be low. That is acceptable — the harness
  owns the **delta between arms**, and the delta is measurable for free.
- Suite: a pinned, versioned set. Start with a self-hosted set generated from this
  repo's own git history (bug report → fixing commit → the tests that commit
  touched), which costs nothing and exercises a real TypeScript monorepo. A
  ~50-instance SWE-bench-Verified subset is added as a second corpus once a paid
  run is authorised.
- The suite hash is pinned in config. A changed suite invalidates stored
  baselines rather than silently comparing across corpora.
- Report the delta as a range across corpora, never as one number
  (`decisions/a4-closed-under-model` precedent).

### 4.4 The three things that make the delta trustworthy

The measurement's failure modes are all quiet, which is what makes them
expensive. Each gets a mechanism, not a warning in a README.

**Preflight, or refuse to start.** `mega-agent eval` resolves the configured
endpoint and issues one real completion before the first instance runs. No
endpoint, an endpoint that 404s, or a reply that does not parse — the run aborts
with the endpoint, the model id, and the underlying error. Without this the run
completes green and empty: `ArmReport`'s ratios return `None` on missing data by
design (§4.1's refusal-to-emit rule), so an absent model looks exactly like a
finished measurement.

**Both arms, provably the same model.** A delta between two arms means nothing
unless the arms differ only in the harness. Each arm records `endpoint`,
`model`, and `suite_hash` into its journal; the reporter refuses to compute a
delta when any of the three disagree, and says which one. This is the hole that
would silently invalidate the product's entire claim, so it is checked rather
than trusted — including against the operator who reruns one arm a week later
against a different local model and forgets.

**The spend lock.** §13 item 5 confirms eval runs against a local model with no
paid API spend absent separate authorisation. That is enforced, not documented:
a `base_url` whose host is not loopback is rejected unless the invocation carries
`--allow-remote-model`. The flag is per-invocation and never persisted to config,
matching how `danger-full-access` is handled in §11.1.

The endpoint itself is configuration (§10.2), never code. Any OpenAI-compatible
server satisfies it — Ollama, llama.cpp, vLLM, LM Studio — and the architecture
is bound to none of them.

### 4.5 NDJSON event side-channel

Every internal event is NDJSON on a side channel from day one (`--events
<path>`, default `.megasaver/agent/events-<session>.ndjson`). Every metric above
is then a `jq` invocation rather than an instrumentation project six months
later. The TUI (Phase 3) is a consumer of this stream, not a privileged path into
the kernel.

The **supervisor** holds the file handle, always — the path is normally outside
the worktree, which puts it outside what the agent's profile makes writable
(§3.3). The kernel emits into a `dyn Events` seam that is the pipe in production
and a stub in tests, so nothing below the supervisor ever opens a file. One
practical consequence worth stating because it is easy to get wrong: under the
eval driver the path must be **absolute**, since each instance runs with its cwd
set to a disposable worktree. A relative path there produces a journal that is
deleted with the worktree and a report where every token count is zero — an empty
measurement that is indistinguishable, at a glance, from a clean one.

---

## 5. Multi-Terminal — Conductor as a Role, Not an Election

### 5.1 Decision

The harness **does not implement a mesh, a leader election, presence files, or a
task board.** All four already exist:

- `docs/superpowers/specs/2026-08-12-session-mesh-family-design.md` —
  `approved-design`, HIGH.
- `@megasaver/mesh@0.1.0` — presence/heartbeat, repo-family scoped peers,
  at-most-once inbox with `drainInbox` (**atomic claim of pending messages**),
  advisory claims (TTL 30 m), board, peer Q&A, handoff.
- `@megasaver/agent-office` — `task-store`, `supervisor`, `role-store`,
  `predefined-roles` (13 safe-by-default seed roles), `permission`, `audit-store`,
  `transcript-store`, `launcher-registry` / `AgentLauncher`.

Between them that is presence, delegation, roles, supervision, and an audit trail
— the entire Conductor job description.

**Therefore the Conductor is a role, not an elected leader.** The terminal the
operator hands a goal to decomposes it and posts tasks to the existing
agent-office board. Workers cooperate over a queue; they never compete for a
title.

Two different stores carry that, and the distinction matters for anyone
implementing §5.2:

| Store | Primitive | Contention model |
|---|---|---|
| `agent-office/task-store` | `saveTask` / `loadTask` / `listTasks` / `deleteTask`, with `status: queued \| running \| done \| failed \| canceled` | **No atomic claim.** Tasks are addressed to one agent by the Conductor, so two workers never reach for the same task. |
| `@megasaver/mesh` inbox | `drainInbox(liveSessionId)` — at-most-once pull | Atomic, but it delivers **messages**, not tasks. |

So the design is *assignment*, not *claim*: contention is designed out rather
than locked away, which is why no election is needed under either primitive. If
a later phase wants unassigned workers pulling from a shared pool, that needs a
claim primitive `task-store` does not have today — an open question for Phase 4,
not a Phase 1 blocker.

Consequences — all of these are **deleted** from the v1 draft:

- leader election by earliest `startedAt`
- heartbeat-ranked promotion and failover
- `.megasaver/mesh/peers/<pid>.json` (PID identity — `liveSessionId` is the
  identity, and it survives worktrees)
- a second UDS socket mesh
- the **Claim Lock Engine**. Blocking claims are an explicit Non-Goal of the
  approved design, and they are redundant anyway: workers in separate worktrees
  edit separate copies of a file. The real conflict is at merge (§5.3).

No superseding spec is required, because nothing here contradicts the approved
design.

### 5.2 What the Rust side actually implements

A thin client, ~300 LOC:

```
register_presence(liveSessionId, role)     → daemon → @megasaver/mesh
post_tasks(decomposition, assignees)       → daemon → agent-office task-store
next_assigned_task(liveSessionId)          → daemon → task-store, status=queued
                                                      (assigned, not claimed)
await_directed_message(liveSessionId)      → daemon → mesh drainInbox (atomic)
report_result(taskId, worktree, diff, verify_outcome)
```

Everything durable lives in the existing store. The harness holds no coordination
state of its own, so a crashed terminal loses nothing.

### 5.3 Worktree isolation and merge-back

Merge-back is where parallel-agent harnesses actually fail, and the v1 draft gave
it one line. The rules:

1. Each task runs in `.worktrees/<taskId>` created by `git worktree add`.
2. Integration is **serialized** — one merge at a time, guarded by a single
   `flock` on `.megasaver/agent/integration.lock`. Parallelism is in the work, not
   in the merge.
3. Before merging: `git rebase origin/main`, then **re-run the verification gate
   after the rebase**, never on the pre-rebase diff. A diff that passed in
   isolation is not evidence it passes on current main.
4. On conflict or post-rebase failure: the task bounces back to the board with
   the conflict hunks and the failure output as context. It is not auto-resolved.
5. Lockfiles and generated files are fence-protected (§11.2), so N workers cannot
   each regenerate them into a conflict. Regeneration is an explicit integration
   step run once, after merge.

```
Operator terminal (Conductor role)     Worker terminal (any role)
     │                                        │
     ├─ decompose goal → assign tasks ────────►│ next_assigned_task
     │                                        ├─ git worktree add .worktrees/<id>
     │                                        ├─ agent loop, sandboxed (§11)
     │                                        ├─ diagnostics loop (§8)
     │                                        ├─ verify gate
     │◄──── result + diff + verify outcome ───┤
     ├─ flock(integration) → rebase → re-verify → merge
     └─ on failure: bounce task back with evidence
```

---

## 6. Token Efficiency and the Prompt-Cache Invariant

### 6.1 The defect we must not re-enter

`syntheses/saver-cache-churn` (2026-07-19): the PostToolUse saver's **in-place
`tool_result` rewrite invalidated the native prompt cache**. Net cost came out
**0.96×** balanced and **0.93×** aggressive — no win, and more aggressive
compression was *worse*. `syntheses/saver-root-cause-2026-07-28` adds three
design-level causes why the saver "neither hits 60–90% nor stays lossless", and
flags two false claims in the earlier synthesis.

Owning the harness is the opportunity to fix this, because the harness assembles
its own requests. It is only an opportunity if it is a constraint.

### 6.2 The invariant

1. **The prompt prefix is append-only within a session.** A historical
   `tool_result` is never rewritten in place. Ever.
2. **Compression happens at write time**, before content enters history — never
   retroactively. A tool result is filtered once, on the way in, and what enters
   history is what stays there.
3. **`cache_control` breakpoints sit at stable boundaries**, coarse to fine:
   `[system + tool schemas] | [repo map] | [history]`. Assert ≤ 4 breakpoints
   (provider limit).
4. Anything that would violate (1) — compaction included — produces a **new
   prefix and a new cache generation**, deliberately and at a counted moment,
   rather than invalidating the old one incrementally.

### 6.3 Compaction

Every long run hits the context ceiling; without a strategy the run dies or
degrades silently. On reaching the configured fraction of the window:

- **Preserved verbatim:** the goal, the current plan, the cumulative diff, the
  last error, and the last N turns.
- **Summarized:** everything else, into a single structured block.
- The result is a **new prefix** (per §6.2.4), and the event is emitted to the
  NDJSON channel with before/after token counts so §4.2 can price it.

### 6.4 ContextOps reuse

Output filtering, redaction, fence evaluation, ranking, and memory recall are
**called on the daemon**, not reimplemented (§3.1). The harness's contribution is
*where* in the request lifecycle they run — at write time, in front of the cache
boundary — which is precisely what the TypeScript hook path could not control.

### 6.5 Failed-attempt recall

v1 carried a "Failed Attempt Recall" pillar. It is kept, but as a daemon call
rather than a harness subsystem: `concepts/failed-run-learning` (FORGE) already
specifies find-similar-failures → failure-to-rule → rank-applicable-rules,
deterministic (BM25 + path overlap), no model call.

The harness's part is the seam, not the algorithm: on a task bounce (§5.3) or a
red diagnostics loop (§8), it posts the failure with its worktree and file set;
at turn construction it asks for applicable rules and injects them **after** the
cache boundary (§6.2), because they change per attempt.

This is an accuracy lever, so it is measured like one — §4's eval loop reports
the resolve-rate delta with recall on vs. off. If the delta is inside noise it
gets cut; it does not ship on the strength of the idea.

---

## 7. Edit-Apply Reliability

The largest single source of lost points in every harness is an edit that fails
to apply. The v1 draft had a `WritePatch` tool with no format, no fuzzy matching,
no retry, and no metric.

**Format:** search/replace blocks. **Ladder**, in order, stopping at first hit:

1. Exact match.
2. Whitespace-normalized match (indentation-insensitive, re-indented on write).
3. Anchored fuzzy match above a similarity threshold, with unique-anchor
   requirement — ambiguity is a failure, not a coin flip.
4. **Reject with the real surrounding file content returned to the model** — never
   a bare "edit failed". A failed edit that returns the current text is one
   corrected turn; a failed edit that returns an error string is a guessing loop.

`apply_success_rate` is a first-class metric with a **DoD floor of 98%**, measured
by the eval loop (§4.2) and emitted per-edit to the NDJSON channel.

Every applied edit is preceded by a fence check (§11.2) and followed by a
checkpoint commit (§11.3).

---

## 8. Post-Edit Diagnostics Feedback Loop

The cheapest accuracy lever available, and absent from v1.

After every edit batch, before the model continues, run the project's fast
checker and feed back **only the newly introduced** diagnostics:

| Language | Command |
|---|---|
| TypeScript | `tsc --noEmit` (project refs) |
| Rust | `cargo check --message-format=json` |
| Python | `ruff check` |
| Go | `go build ./...` |

- Detection is by project marker file; unknown project types simply skip the step.
- The diff against the pre-edit diagnostic set is what matters. Pre-existing
  errors are noise and are suppressed.
- Output routes through the daemon's `output-filter`, which already does
  root-cause extraction — this converts a 4000-line `tsc` dump into the first
  failure plus its cause.
- An LSP client is a later refinement; the checker subprocess captures most of
  the value for a fraction of the complexity.

---

## 9. Test-Time Compute — N Candidates, Selected by Tests

This is the multi-terminal architecture's actual killer application, and v1 missed
it: it built N isolated worktrees and N parallel workers, then assigned each a
*different* task.

Assigning them the **same** task and selecting the winner by test outcome is a
larger accuracy lever than parallel throughput, and the infrastructure is
identical.

```bash
mega-agent solve "<goal>" --candidates 3 --select-by verify
```

- N worktrees, N independent attempts, different seeds/temperature.
- Selection is by **verification**, not by model confidence: the candidate whose
  test suite passes wins; ties break on smallest diff.
- If none pass, the failures are aggregated and returned as context for a
  follow-up attempt rather than merging the least-bad patch.
- Cost is N× tokens for one task, so it is opt-in per invocation and reported as
  a separate arm in the eval loop (§4) — `resolve_rate` at N=1 versus N=3 is
  exactly the kind of number this project exists to produce.

---

## 10. Speed — the Metrics That Are Actually Felt

### 10.1 Metric replacement

The v1 draft made cold start a pillar and then drifted 25× across documents
(2 ms → 5 ms → 50 ms). Cold start is noise: the agent immediately blocks 2–30 s
on a model call, once per session.

| Metric | Definition | Target |
|---|---|---|
| **TTFT** | prompt sent → first visible token | p50 < 400 ms |
| **Render throughput** | sustained stream render | no dropped frames at 200 tok/s |
| **Tool round-trip** | tool call parsed → result in context | p50 < 50 ms for read/grep |
| **Resident memory** | steady state, streaming | < 15 MB |
| Cold start | process exec → ready | smoke assertion `< 50 ms`, not a pillar |

Tool round-trip is where a native harness genuinely wins: TypeScript harnesses
lose whole seconds per turn re-reading files, re-globbing, and re-spawning.

### 10.2 Providers — three wire formats, stated honestly

| Format | Endpoint | Covers |
|---|---|---|
| Anthropic | `/v1/messages` (SSE, `cache_control`) | Claude |
| OpenAI-compatible | `/v1/chat/completions` | OpenAI, DeepSeek, Groq, OpenRouter, vLLM, LM Studio, Ollama |
| Gemini | `/v1beta/models/{model}:streamGenerateContent` | Gemini |

That is the honest description. The v1 draft's "140+ providers" was a config
surface advertised as an engineering feat, and it invites a support matrix nobody
asked for.

`reqwest` + `serde_json` is sufficient — SSE parsing is not the bottleneck, the
network and the model are. The v1 draft's "zero-copy" and "SIMD JSON" language is
removed; if profiling ever puts JSON parse in the top five, `simd-json` is a
drop-in at that point.

**Routing is config-first with no defaults compiled into the binary**, so the
table cannot rot the way v1's did (it shipped `claude-3-7-sonnet-20250219`,
`claude-3-5-haiku-20241022`, `o3-mini`). Model ids belong in `config.toml`, and
the current family is verified at config-write time, not at compile time:

```toml
[models.director]                     # decomposition, review, integration
provider = "anthropic"
model = "claude-opus-5"
fallback = ["anthropic/claude-sonnet-5"]

[models.worker]                       # implementation turns
provider = "anthropic"
model = "claude-sonnet-5"
fallback = ["openai-compat/deepseek-chat", "openai-compat/ollama:qwen2.5-coder"]

[models.fast]                         # diagnostics triage, summarization
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
```

Fallback triggers on 429/5xx only, with bounded retry and no silent retry on
malformed responses (`anti-patterns.md`: diagnose the root cause).

**The eval endpoint is its own config block**, deliberately separate from the
routing table above so that a change to production routing cannot silently move
what the measurement runs against:

```toml
[eval]
base_url = "http://127.0.0.1:11434/v1"   # any OpenAI-compatible server
model = "qwen2.5-coder:7b"
# Non-loopback base_url requires --allow-remote-model per invocation (§4.4).
```

Both arms read this one block. That is what makes the same-model check in §4.4 a
verification of the run rather than a restatement of the config.

### 10.3 TUI (Phase 3)

`crossterm` already parses SGR 1006 and emits
`MouseEvent { kind, column, row, modifiers }`. The v1 draft's hand-written mouse
parser is removed. What is actually written is hit-testing rects → widget ids
(~40 LOC) and one test for it.

The TUI is a **consumer of the NDJSON event stream** (§4.5), not a privileged
path into the kernel. That keeps the headless mode (§12.1) first-class and means
the TUI cannot be the reason a metric is unobservable.

Layout (unchanged from v1 — it was good):

```
┌─ MEGA AGENT ────────────────────────────────────────────────────────────────┐
│ [👑 Director] [⚙️ Worker-1: API] [🧪 Worker-2: Test]  [📊 $0.12 · cache 84%] │
├─────────────────────────────────────────────────────┬───────────────────────┤
│ LIVE STREAM                                         │ 📋 TASK BOARD         │
│ Goal: "Add OAuth2 authentication"                   │ [✓] 1. Auth schemas   │
│ > decomposed into 3 tasks, posted to board          │ [●] 2. Google OAuth   │
│ > worker-1 claimed #2                               │     └ worker-1        │
│ ┌─ worker-1 diff ─────────────────────── (scroll ▲▼)┤ [ ] 3. E2E tests      │
│ │ + pub async fn verify_oauth_token(…) -> Result    │                       │
│ └───────────────────────────────────────────────────┤ 🛡️ SAFETY             │
│                                                     │ • sandbox: workspace  │
│                                                     │ • fence: 0 violations │
│                                                     │ • apply rate: 99.1%   │
├─────────────────────────────────────────────────────┴───────────────────────┤
│ [✅ Approve & Merge]  [❌ Request Changes]  [⏸️ Pause]  [↩️ Rollback]         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Safety (CRITICAL)

### 11.1 Bash sandbox — OS-enforced, not a denylist

The v1 draft guarded file writes with `fence.yaml` and left `bash` unguarded.
A write-path validator that only covers the write tool is theatre: `sed -i`,
`> file`, `git checkout`, and `rm` each bypass it in one line. A denylist of
dangerous commands is unwinnable — the kernel must do the enforcing.

| Platform | Mechanism |
|---|---|
| macOS | `sandbox-exec` seatbelt profile |
| Linux | Landlock (filesystem) + seccomp (syscall) |
| Windows | deferred; `mega-agent` refuses to run unattended modes until implemented |

Three modes:

| Mode | Filesystem | Network | Default for |
|---|---|---|---|
| `read-only` | read anywhere allowed by fence; no writes | none | analysis, review, planning |
| `workspace-write` | write within the assigned worktree + tmp only | **none** | **default — all worker execution** |
| `danger-full-access` | unrestricted | unrestricted | explicit operator flag per invocation, never persisted to config |

Network is off in `workspace-write` because an agent that can both write code and
reach the internet is an exfiltration path. Package installs are an explicit,
separately-approved step, not a side effect of a tool call.

**Network is off with no exception, and that took a process split to afford.**
An earlier revision of this section carved TCP-connect-to-the-daemon-port out of
`workspace-write`, then admitted in the same breath that the carve-out weakened
the argument it was attached to: the daemon exposes `/exec`, so a reachable
daemon bounds a sandbox escape by the daemon's own permission checks rather than
by the sandbox. The carve-out is gone. Per §3.3, the sandboxed agent has no
socket at all; its model and daemon calls travel over an inherited `socketpair`
fd to an unsandboxed supervisor that holds both connections. The profile denies
network unconditionally — loopback included — and there is no port to pin.

**The profile applies to the process, not to the `bash` tool.** This is the other
half of the same correction. A sandbox installed by wrapping each child
`Command` never sees the harness's own in-process `fs::write`, which reintroduces
the v1 defect with the polarity flipped: `bash` guarded at the syscall boundary,
`write` guarded only by a tool-level check that a single `sed -i` in the same
process image would not even need to bypass. The agent child enters the profile
at startup — `landlock_restrict_self` on Linux, a re-exec under `sandbox-exec` on
macOS — before its first model call, so every route to the filesystem is inside
it: `write`, edit-apply, `bash`, and any process `bash` itself spawns.

### 11.2 Fence — enforced at the syscall boundary, not the tool boundary

`fence.yaml` rules are evaluated by the daemon (§3.1) and compiled down into the
sandbox profile's writable-path set. Consequence: **no fenced path is writable by
any route** — `bash`, the `write` tool, and edit-apply alike. The tool-level check
remains as a fast, friendly rejection with a good error message; the sandbox is
what makes it true.

That claim depends entirely on §3.3: the profile covers the agent *process*, so
in-process writes are inside it. Under a sandbox that only wrapped child
`Command`s the sentence above would be false, and the fence would be exactly the
theatre this section was written to end.

The fence is compiled **before** the agent child enters the sandbox. The
supervisor calls the daemon's fence route at spawn time, folds the result into
the profile, and only then execs the child. The agent never needs the fence route
at runtime, which is why the fence costs nothing per turn and needs no channel of
its own.

Fenced by default: lockfiles, generated files, `.git/` internals, everything
already covered by the shipped `generated-file-fence` work.

### 11.3 Checkpoints and rollback

Every tool call that mutates the worktree is preceded by a commit into a **shadow
git repository** (`--git-dir .megasaver/agent/shadow/<taskId>`), leaving the
operator's own history and index untouched.

- `mega-agent rollback <checkpoint>` restores the worktree to any prior step.
- The TUI exposes it as `[↩️ Rollback]`.
- For a harness running unattended across N worktrees this is not a nicety; it is
  the difference between a bad run and a bad day.

### 11.4 No unsupervised self-referential loops

`risk-modes.md` CRITICAL forbids them. Concretely:

- `mega-agent` never targets its own source tree in an autonomous mode.
- A worker cannot post tasks to the board (only the Director role can), so a run
  cannot fan itself out without bound.
- Hard caps, all configurable and all enforced: max turns per task, max total
  tokens per run, max concurrent workers, max worktrees. Hitting a cap stops and
  reports; it never silently continues.

### 11.5 Secrets

API keys are read from the environment or the OS keychain, never from repo files,
never written to the NDJSON event stream, never included in a transcript, and
redacted from tool output via the daemon's existing redaction path before the
content enters history.

The **daemon bearer token** is a secret of the same class and is handled the same
way. It is read from `daemon.json` (mode `0600`, so same-uid only) at startup,
held in memory, and never logged, never emitted to the event stream, and never
passed as a command-line argument — `argv` is world-readable on both target
platforms. Loopback HTTP with a bearer token is a weaker boundary than a
filesystem-permissioned UDS: any process running as the same user can read the
file and impersonate the harness. That is a pre-existing property of
`packages/daemon`, not one this spec introduces, but it is in scope for the
`security-reviewer` pass because this spec is what puts an unattended shell agent
behind that boundary.

Under §3.3 the exposure narrows: only the **supervisor** ever reads
`daemon.json` or holds the token, and the sandboxed agent has neither the token
nor a socket to use it on. Same-uid impersonation of the daemon remains possible
for any other process the user runs — that is `packages/daemon`'s property, not
this spec's — but a compromised agent child is no longer one of them.

---

## 12. Interfaces

### 12.1 Headless / programmatic mode

```bash
mega-agent -p "<prompt>" --output-format json --sandbox workspace-write
```

Stable exit codes. This is what makes the harness usable in CI, in scripts, and
as a subagent of another harness — and it is the only way the eval loop (§4) can
drive it. It exists in **Phase 0**, before the TUI.

### 12.2 Session persistence, resume, fork

Sessions are durable and resumable; a session can be forked to retry a different
approach from a known-good point. This consumes the existing
`docs/superpowers/specs/2026-08-11-conversation-fork-time-travel-design.md`
rather than inventing a parallel mechanism.

### 12.3 MCP, hooks, skills

- **MCP client** (stdio + HTTP) — table stakes; it is how the harness reaches
  everything it does not build. Tool schemas from MCP servers are counted against
  the token budget and gated by the tool router.
- **Hooks** — the operator's insertion point for policy. `mega hooks` already
  ships; the harness fires the same event names so one hook configuration covers
  both.
- **Skills** — on-demand instruction loading keeps the system prompt small. That
  is a token win before it is a feature.

---

## 13. Operator Confirmation (required at CRITICAL)

`risk-modes.md` CRITICAL requires manual user confirmation recorded in the spec.

| # | Item | Status |
|---|---|---|
| 1 | Risk upgraded HIGH → CRITICAL | **confirmed 2026-08-19** |
| 2 | Default sandbox mode is `workspace-write` with network **off** | **confirmed 2026-08-19** |
| 3 | The harness may spawn worker processes via `AgentLauncher` | **confirmed 2026-08-19** |
| 4 | Shadow-git checkpoints write to `.megasaver/agent/shadow/` | **confirmed 2026-08-19** |
| 5 | Eval loop runs against a local model; no paid API spend without separate authorisation | **confirmed 2026-08-19** — enforced in code by the §4.4 spend lock, not by documentation |
| 6 | Mission-level change: shipping our own agent inverts `docs/conventions/mission.md` ("agents connect to Mega Saver, never the reverse") | **confirmed 2026-08-19 — see §15** |

All seven items confirmed. Item 6 was executed the same day: `docs/conventions/mission.md`
gained a "First-party agent" section and `pnpm conventions:sync` regenerated `CLAUDE.md`,
`AGENTS.md`, and `.cursor/rules/*.mdc`.

The §11.1 sandbox/daemon conflict that blocked Phase 1 alongside these is also
closed — resolved 2026-08-19 by the §3.3 process split rather than by a
carve-out (§14). What remains before Phase 1 merges is the CRITICAL review chain
itself: `architect`, `critic`, `security-reviewer`, `verifier`, and the `tracer`
evidence loop (§2). The §3.3 split is the design those passes should scrutinise
hardest — it is a new trust boundary, and the supervisor is the thing on the
privileged side of it.

---

## 14. Accepted Deviations from the Review

Recorded so the review's findings are closed rather than silently dropped.

- **N1 (unsafe leader election)** — resolved by deletion (§5.1). The `flock` +
  monotonic-term design the review proposed is retained in the review document
  only, in case a future spec reintroduces a leader.
- **N8 (empty implementation steps in plan Tasks 4 and 5)** — a plan-level
  finding. The plan is regenerated from this spec; the new mesh task (§5.2) is
  ~300 LOC of client code rather than a concurrency problem, which removes the
  cause.
- **Closed — the sandbox/daemon loopback conflict (§11.1).** Found while
  verifying the transport for the plan: `workspace-write` said "network: none"
  while §3.1 required a call to `127.0.0.1`. Resolved by removing the conflict
  rather than carving an exception: §3.3 splits the harness into an unsandboxed
  supervisor holding both the model and daemon connections, and a sandboxed agent
  child with no socket at all. The `daemon_port` carve-out and its pinned-port
  test are deleted.
- **New finding that forced the above, recorded because it was nearly shipped.**
  The plan installed the sandbox by wrapping each child `Command`. That leaves
  the harness's own in-process `fs::write` and edit-apply outside the profile,
  which makes §11.2's central claim — no fenced path is writable by any route —
  **false**, and reintroduces the v1 defect with its polarity flipped: `bash`
  guarded at the syscall boundary, `write` guarded by a tool-level check in the
  same process image. It also left Arm A (`baseline.rs`, a real agent loop with
  real `bash`) running unsandboxed in Phase 0, five tasks before any sandbox
  existed. The profile is now entered by the agent *process*, and containment
  moves ahead of the first model call (§17).
- **N10 (monorepo plumbing)** — carried into the plan: biome ignore for
  `crates/**`, a turbo task wrapping `cargo build --release` / `cargo test`,
  extension of `pnpm verify` (otherwise the DoD gate silently skips all Rust),
  pinned `rust-toolchain.toml`, `target/` in `.gitignore`, CI matrix addition.

---

## 15. Relationship to the Existing Product

This spec does not change `@megasaver/core`'s agent-agnostic guarantee: the Rust
harness is a **consumer** of core via the daemon, exactly like any connector, and
contributes no agent-specific logic to core.

It does, however, change the mission statement. `docs/conventions/mission.md`
currently reads:

> Mega Saver Core is agent-agnostic. Agents connect to Mega Saver, never the
> reverse.

Shipping our own agent inverts that sentence. This is a product-identity decision,
not a documentation edit — §13 item 6.

**Confirmed 2026-08-19 and executed.** `docs/conventions/mission.md` gained a
"First-party agent" section: Core stays agent-agnostic, `mega-agent` reaches it
through the daemon on the same routes as any third-party agent with no
privileged path, and the harness ships only while the two-arm eval (§4) shows a
positive delta — if the delta goes to zero the harness is cut, not the
measurement. `pnpm conventions:sync --write` regenerated `CLAUDE.md`,
`AGENTS.md`, and `.cursor/rules/mega-context.mdc`; `pnpm conventions:check` is
green. All four land in the same commit, per the dogfood rule.

(Note the flag: bare `pnpm conventions:sync` runs in *check* mode and exits 1 on
drift. `--write` is what regenerates.)

---

## 16. Verification & DoD Gates

Replaces v1 §8 entirely. Cold start and RAM were the only gates; neither
correlates with the goal.

**Correctness**

- `cargo test --all` green, including: state-machine transitions (one test per
  transition), edit-apply ladder (each rung, plus the ambiguity rejection),
  sandbox escape attempts (must fail), fence bypass via bash (must fail),
  **fence bypass via the in-process `write` tool (must fail)**, **all network
  egress from the agent child denied including loopback (must fail)**, worktree
  merge with induced conflict, compaction boundary, SSE parse for all three wire
  formats.
- Every sandbox test carries a positive control — a permitted write that must
  *succeed* under the same profile, and a supervisor RPC round-trip that must
  *succeed* over the inherited fd. Without them, "the sandbox works" and "nothing
  works" produce the same green.
- `pnpm verify` green (with the Rust tasks wired in per N10) — a Rust regression
  must be able to fail the monorepo gate.

**Accuracy** (the primary gate)

- Eval loop (§4) run on the pinned suite. `resolve_rate` must not regress;
  `apply_success_rate` ≥ 98%; `cache_read_ratio` must not regress.
- Evidence is the stored run journal, not a claim.
- The journal's two arms must agree on `endpoint`, `model`, and `suite_hash`
  (§4.4). A delta computed across a mismatch is not evidence, and the reporter
  will not produce one.

**Performance**

- §10.1 metrics measured in-process (not by timing `std::process::Command`, which
  is dominated by OS exec and dyld and would pass regardless of what the binary
  does).

**Process** (per §2)

- `architect`, `critic`, `security-reviewer`, `verifier` passes; `tracer` evidence
  loop; operator confirmations §13 items 2–6.

---

## 17. Phasing

| Phase | Content | Rationale |
|---|---|---|
| **0** | Supervisor/agent split + OS sandbox (§3.3, §11.1) → eval loop (§4) + headless mode (§12.1) + NDJSON channel (§4.5) | Nothing merges until a number exists — and nothing runs a model loop until it is contained |
| **1** | Kernel: agent loop & state machine, streaming, tool dispatch, edit-apply with apply-rate (§7), fence compiled into the profile (§11.2) | The harness itself, inside a box that already exists |
| **2** | Accuracy levers: diagnostics feedback (§8), repo map via daemon, prompt-cache invariant (§6), checkpoints (§11.3), compaction (§6.3) | Each lands with a bench delta or it does not land |
| **3** | TUI (§10.3) | After it works headlessly and measurably |
| **4** | Mesh client (§5), worktree integration queue (§5.3), `--candidates N` verify-select (§9) | Coordination, once there is a measurable agent to coordinate |

v1 ordered this the other way — interface and coordination first. All four stated
goals are numbers; the thing that produces the numbers is built first.
