---
reviews: [2026-08-19-rust-agent-harness-design.md, 2026-08-19-rust-agent-harness-plan.md]
date: 2026-08-19
reviewer: claude-code (design review, pre-implementation)
verdict: revise-before-phase-1
risk-recommendation: CRITICAL (upgrade from HIGH)
---

# Review — Rust Agent Harness & Multi-Terminal Conductor

## Verdict

The direction is right: owning the harness is the only way to control request
assembly, and request assembly is where both token cost and coding accuracy are
actually decided. Nothing downstream of a harness can fix a badly assembled
prompt.

As written, neither document can ship. Three classes of problem:

1. **The primary goal has no instrument.** The stated purpose is to raise model
   coding scores. Neither doc contains a baseline, a task suite, a scoring
   method, or a gate. Every claim in §2 is currently unfalsifiable.
2. **It re-implements three approved/shipped subsystems with contradicting
   semantics** — `@megasaver/mesh`, `@megasaver/agent-office`, and the
   ContextOps stack.
3. **The headline metric is the wrong metric**, and its value drifts 25× across
   the two documents (2 ms → 5 ms → 50 ms).

Findings are tagged **[BLOCKS P1]** (must resolve before any Phase-1 code) or
**[LATER]** (resolve before the phase that lands it).

---

## Blocking findings

### B1 — No eval loop. The north star has no instrument. [BLOCKS P1]

The requirement driving this whole project is that the harness measurably raises
a model's coding score. Spec §8 "Verification & DoD Gates" measures cold start,
RAM, and stream latency. None of those correlate with coding accuracy. There is
no task suite, no baseline arm, no resolve-rate, no regression gate.

Consequence: the project cannot tell success from failure, so it will optimise
the things it *can* measure (milliseconds) instead of the thing it exists for.

**Fix — this becomes Task 1, not a paragraph in Task 7.** Build `mega-agent
bench` mirroring the discipline already established in `@megasaver/bench-replay`
("a measurement tool that silently drifts is worse than no tool"):

- **Arm A (baseline):** the same model over the bare API with a minimal
  read/edit/bash loop.
- **Arm B (harness):** the same model, same task set, through `mega-agent`.
- **Metrics:** resolve rate, tokens/task, wall-clock/task, and `apply_success_rate`
  (see missing-1).
- **Suite:** pinned and versioned. A ~50-instance SWE-bench-Verified subset, or a
  self-hosted repo-task set generated from this repo's own git history
  (issue → fixing commit → its tests). Whichever — pin the hash.
- **Budget constraint:** `decisions/a4-closed-under-model` records that there is
  no API budget for paid replay. Run the loop against a **local model**
  (Ollama/vLLM, qwen-coder class) first. Absolute scores will be low; that is
  fine. The harness owns the **delta between arms**, and the delta is what needs
  measuring. Paid runs become a one-off confirmation later, not the loop.
- **DoD gate:** no harness feature merges if arm B's resolve rate regresses.

### B2 — §3.2 contradicts an approved design; §3 duplicates two shipped packages. [BLOCKS P1]

The Rust spec builds presence files, heartbeat discovery, leader election, a
claim-lock engine, and a role/task board. All four already exist as approved
design and partly shipped code:

- `docs/superpowers/specs/2026-08-12-session-mesh-family-design.md` —
  status `approved-design`, risk HIGH.
- `@megasaver/mesh@0.1.0` — presence/heartbeat, repo-family scoped peers,
  at-most-once inbox, advisory claims (TTL 30m), board, peer Q&A, handoff.
- `@megasaver/agent-office` — roster, rich roles, per-agent task queues, live
  board, agent-agnostic `AgentLauncher` connector capability. Phase 0 shipped.

These are not merely duplicated; they are **contradicted**:

| Rust spec §4 | Approved session-mesh-family |
|---|---|
| Leader election; Conductor owns the task board | "files are truth, pull-based" — no leader |
| "Claim Lock Engine (prevents two agents editing the same file)" | Advisory claims, warn-only. **Blocking claims are an explicit Non-Goal.** |
| `.megasaver/mesh/peers/<pid>.json` + socket path | `store/mesh/presence/<liveSessionId>.json`, repo-family scoped |
| PID as identity | `liveSessionId` as identity (survives worktrees) |

**Fix — the Conductor is a _role_, not a leader. No superseding spec needed.**

The multi-terminal requirement survives intact without leader election, because
the delegation primitives already exist:

- `@megasaver/agent-office` ships `task-store.ts`, `supervisor.ts`,
  `role-store.ts`, `predefined-roles.ts` (13 seed roles), `permission.ts`,
  `audit-store.ts`, `transcript-store.ts`, and `launcher-registry.ts` /
  `AgentLauncher`. That is a task board, role assignment, supervision, spawning,
  and an audit trail — the entire Conductor job description.
- `@megasaver/mesh` ships `drainInbox(liveSessionId)` — an **atomic claim of
  pending messages**. That is exactly the primitive a worker needs to take a
  work order without anyone electing a leader.

So: `mega-agent` registers a presence entry, adopts an agent-office role, and
pulls work from the existing board. The terminal the operator gives the goal to
*decomposes and posts tasks*; the others *pull*. Workers cooperate over a queue —
they never compete for a title — so there is nothing to elect, nothing to fail
over, and no split-brain to defend against. Election, heartbeat ranking, and
promotion (§4.1, N1) all delete.

The one piece that would have required a supersede is the blocking **Claim Lock
Engine** — the approved design lists blocking claims under Non-Goals. N3 already
recommends cutting it for an unrelated reason (worktrees make it redundant), so
the conflict disappears with it.

Note also that `agent-office` is already graded **risk CRITICAL for spawning**,
which is the same activity this spec grades HIGH (see B5).

### B3 — The ContextOps pillar walks back into a measured, first-party failure. [BLOCKS P1]

Pillar §2.4 says the Rust agent enforces ContextOps natively. The repo's own
evidence says the current ContextOps write path does not pay off:

- `syntheses/saver-cache-churn` (2026-07-19): the PostToolUse saver's **in-place
  `tool_result` rewrite invalidated the native prompt cache**. Net cost balanced
  **0.96×**, aggressive **0.93×** — no win, and more aggressive compression came
  out *worse*.
- `syntheses/saver-root-cause-2026-07-28`: three design-level causes why the
  saver "neither hits 60–90% nor stays lossless", and it flags two false claims
  in the earlier synthesis.

Owning the harness is precisely the opportunity to fix this — the harness
assembles its own requests. But only if the spec makes it a constraint. As
written it inherits the defect.

**Fix — add a "Prompt Cache Invariant" section to the spec:**

- The prompt prefix is **append-only** within a session. A historical
  `tool_result` is never rewritten in place.
- Compression happens **at write time**, before content enters history — never
  retroactively.
- `cache_control` breakpoints sit at stable boundaries:
  `[system + tools] | [repo map] | [history]`. Assert ≤ 4 breakpoints.
- **DoD gate:** cache-read ÷ cache-creation ratio measured per session; a
  regression fails the build. `bench-replay` already has this instrumentation.

This is also the largest single token-cost lever, i.e. the "less tokens" half of
the product tagline.

### B4 — The plan has no task for the agent loop. [BLOCKS P1]

Plan tasks: domain models, streaming, tools, mesh, TUI, memory/fence,
integration. The **agent loop itself is absent** — conversation state machine,
tool-call dispatch, context assembly, turn/step budget, compaction at the
context ceiling, malformed-tool-call retry, stop conditions, error recovery.
Spec §3.3 names an "EventBus & State Machine" that no plan task builds.

That loop *is* the harness. It should be the largest task in the plan, with an
explicit state table and a test per transition.

### B5 — `bash` has no sandbox; the risk grade is too low. [BLOCKS P1]

The spec guards file writes with `fence.yaml` and leaves `bash` unguarded. A
write-path validator that only covers the write tool is theatre: `sed -i`,
`> file`, `git checkout`, and `rm` all bypass it in one line.

An autonomous harness running arbitrary shell across N worktrees, unattended,
meets §12's CRITICAL examples verbatim — "anything that deletes user data",
"anything that mutates user repos beyond known ignore patterns". The spec grades
itself HIGH. `@megasaver/agent-office` already grades the same activity CRITICAL.

**Fix:**

- **Upgrade to CRITICAL.** Per §12 that pulls in the `tracer` evidence loop,
  `security-reviewer`, `verifier` with reproduction evidence, and manual user
  confirmation recorded in the spec. §12 also states risk may not be lowered to
  skip a skill.
- **OS-level sandbox, not a denylist.** macOS `sandbox-exec` (seatbelt) profile;
  Linux Landlock + seccomp. Both are ~100 lines and the kernel does the
  enforcing — a denylist of dangerous commands is unwinnable.
- **Three modes:** `read-only` | `workspace-write` (worktree + tmp only, no
  network) | `danger-full-access`. Default `workspace-write`.
- No fenced path is writable by **any** route, bash included.

### B6 — The speed metric is wrong, and the number drifts 25×. [BLOCKS P1]

Spec §2.1 says cold start ≤ 2 ms. Plan Global Constraints say ≤ 5 ms. Plan Task 7's
test asserts `< 50 ms`. The drift is a symptom: the metric was chosen because it
sounds fast, not because anyone feels it.

Cold start is noise. The agent immediately blocks 2–30 s on a model call. Nobody
perceives 2 ms versus 50 ms, once per session.

**Fix — replace the metric with what the operator actually feels:**

- **TTFT** (prompt sent → first visible token), target p50 < 400 ms.
- **Render throughput** — no dropped frames under a 200 tok/s stream.
- **Tool round-trip** (tool call parsed → result in context). This is where a
  harness genuinely wins: TS harnesses lose whole seconds per turn re-reading
  files, re-globbing, and re-spawning. It is also the metric Rust actually
  improves.
- **RAM** — keep it. It is real, and Rust wins it for free.

Keep a cold-start assertion as a smoke test (`< 50 ms`), not a pillar.

### B7 — The Rust/TS boundary is undefined; as implied, it is a 30-package rewrite. [BLOCKS P1]

The differentiators — `output-filter`, `context-gate`, `fence`, `stats`,
`long-memory`, `memory-graph`, `retrieval`, `policy`, `indexer` — are TypeScript,
~30 packages, carrying years of measured behaviour and a documented
ReDoS-hardening history (10 catalogued instances). "Enforces `fence.yaml`
natively in Rust" plus "integrated with SAGE FTS5" quietly means: reimplement all
of it, with divergent semantics, and then maintain two of everything.

**Fix — cut by hot path, not by package:**

- **Rust (per-token work):** SSE parse, TUI render, input handling, tool
  dispatch, process supervision, worktree ops, mesh client.
- **TS daemon (per-turn work):** context assembly, memory recall, output
  filtering, fence evaluation, token accounting. Crossed once or twice per turn
  over UDS at ~1 ms — invisible beside a multi-second model call.

`packages/daemon` already ships the singleton lock, loopback HTTP, and
lazy-spawn client. The seam exists; use it. The speed claim survives because the
sidecar is warm — only the first spawn pays Node startup. If a per-turn call
ever shows up in a profile, port that one function to Rust and keep the TS as
the conformance oracle.

---

## Non-blocking findings

**N1 — The leader-election algorithm is unsafe as specified. [LATER — P4]**
Recorded in case B2's role-based Conductor is rejected and election is kept
anyway. "Earliest `startedAt` wins" plus 5 s heartbeats: PID reuse aliases
identity, clock adjustment reorders the ranking, and a 6 s GC or swap pause
split-brains two Conductors onto one board with no fencing token.
If a leader is kept: `flock(2)` on `.megasaver/mesh/leader.lock`, held for
process lifetime, released by the kernel on crash. No heartbeats, no timestamps,
no split-brain, ~10 lines. Store a monotonic `term` in the lock file so late
messages from a deposed Conductor are rejected. The recommended path is to delete
the whole mechanism per B2.

**N2 — Worktree merge-back gets one line and is the hardest part. [LATER — P4]**
"Merge Worktree to Main" is where parallel-agent harnesses actually die: two
workers touch the same file, both pass their own tests, and the result conflicts
or silently breaks semantically. Needs a serialized integration queue (one merge
at a time), rebase onto main **before** the gate, re-running verification *after*
the rebase rather than on the pre-rebase diff, and a defined failure path that
bounces the task back with the conflict as context. Also decide what happens to
lockfiles and generated files that every worker regenerates.

**N3 — The Claim Lock Engine is redundant with worktrees. [LATER — P4]**
If every worker owns a worktree, two agents cannot edit the same file — they
edit different copies. The real conflict is at merge (N2). Keeping a file-level
lock as well only blocks work that would have been fine.

**N4 — Model IDs are stale. [LATER — P1]**
`claude-3-7-sonnet-20250219`, `claude-3-5-haiku-20241022`, `o3-mini`. Per the
current Claude Code environment (not a repo source — re-check before pinning),
the Claude family is `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5`, and
`claude-haiku-4-5-20251001`. Make the routing table config-first with no
hardcoded defaults compiled into the binary, so it cannot rot again.

**N5 — The TUI mouse spec reinvents `crossterm`. [LATER — P3]**
§5.2 and plan Task 5's "SGR mouse hit testing": `crossterm` already parses SGR
1006 and emits `MouseEvent { kind, column, row, modifiers }`. The part that
actually needs writing is hit-testing rects → widget ids, roughly 40 lines and
one test. Cut the parser.

**N6 — "Zero-copy" / "SIMD JSON" is vocabulary, not design. [LATER — P1]**
SSE parsing is not the bottleneck; the network and the model are. `reqwest` +
`serde_json` handles 200 tok/s at near-zero CPU. Drop the adjectives; if
profiling later puts JSON parse in the top five, swap in `simd-json` then.

**N7 — "140+ providers" is a config surface, not an engineering feat. [LATER — P1]**
Three wire formats — Anthropic `/v1/messages`, OpenAI `/v1/chat/completions`,
Gemini `generateContent` — cover essentially everything, with OpenAI-compatible
absorbing Ollama, vLLM, LM Studio, OpenRouter, DeepSeek, and Groq. State it that
way. Claiming 140 invites a support matrix nobody asked for.

**N8 — Plan Tasks 4 and 5 have empty implementation steps. [BLOCKS the tasks]**
Both go "Step 3: Implement …" with no code and straight to Step 4. They are the
two hardest and most concurrency-sensitive tasks in the plan and carry the least
detail. Give them real interfaces and a state table, or split them.

**N9 — The cold-start benchmark cannot fail. [LATER — P1]**
It times `std::process::Command` spawn (dominated by OS exec and dyld) and
asserts `< 50 ms` against a 2 ms goal. It will pass regardless of what the binary
does. Replace with the B6 metrics, measured inside the process.

**N10 — A Rust workspace inside a pnpm/turbo monorepo needs plumbing. [LATER — P1]**
Task 7 mentions `package.json` scripts only. Also required: a biome ignore for
`crates/**`, a turbo pipeline task wrapping `cargo build --release` / `cargo
test`, extension of `pnpm verify` (otherwise the DoD gate silently skips all Rust
code), a pinned `rust-toolchain.toml`, `target/` in `.gitignore`, and the CI
matrix addition.

---

## Missing capabilities

Ranked by expected effect on the actual metric — coding score. These are the
features other harnesses have that this spec does not.

**1. Edit-apply reliability, with apply-success rate as a gate. [highest ROI]**
The largest single source of lost points in every harness is edits that fail to
apply. Aider publishes per-model edit-format success rates precisely because the
effect dominates. This spec has a `WritePatch` tool and no format, no fuzzy
matching, no retry, and no metric.
Ship a search/replace format with a ladder: exact match → whitespace-normalized
match → anchored fuzzy match above a similarity threshold → reject **with the
real surrounding file content returned to the model**, never a bare "failed".
Track `apply_success_rate` as a first-class metric with a DoD floor (≥ 98%).

**2. Post-edit diagnostics feedback loop. [highest ROI, cheapest]**
After every edit, run the language's fast checker (`tsc --noEmit`, `cargo check`,
`ruff`, `go build`) or an LSP client, and feed **only the new** diagnostics back
before the model continues. OpenCode does this via LSP. It converts silent
breakage into a corrected turn and is the closest thing to a free accuracy
increase available. It also feeds the existing `output-filter` root-cause
extraction perfectly.

**3. Test-time compute: N candidates, selected by tests. [the mesh's real killer app]**
This is how the leading SWE-bench entries got there — generate multiple candidate
patches, run the suite against each, and select by verification rather than by
model confidence. The spec builds N isolated worktrees and N parallel workers,
then assigns them *different* tasks. Assigning them the *same* task and picking
the winner by test outcome is a larger score lever than parallel throughput, and
the infrastructure is identical.
Make it a mode: `mega-agent solve --candidates 3 --select-by verify`.

**4. Repo map with graph ranking.**
"AST chunking" without ranking is not a repo map. Tree-sitter symbol extraction
plus PageRank over the reference graph, budgeted to N tokens, is the proven way
to give a model whole-repo awareness for roughly 1k tokens. It is also
cache-stable — it changes rarely, so it belongs in a cached prefix block (B3).
`packages/indexer` already does the TS AST work; this is exactly the per-turn
TS-side call described in B7.

**5. Checkpoint and rollback.**
Cline and Roo snapshot the workspace into a shadow git repo per step, so a bad
run is one command to undo. For a harness running unattended across N worktrees
this is not a nicety. Cheap with git: a shadow `--git-dir` committing per tool
call, leaving the user's history untouched.

**6. Context compaction / handoff at the ceiling.**
Every long run hits the context limit. Without a strategy the run either dies or
degrades silently. Needs an explicit design: what is preserved verbatim (the
goal, the plan, the diff so far, the last error), what is summarized, and —
critically per B3 — that compaction produces a **new** prefix rather than
rewriting the old one.

**7. MCP client, hooks, and skills.**
Table stakes. MCP is how the harness reaches everything it does not build; hooks
are how the operator inserts policy (and `mega hooks` already ships); skills keep
the system prompt small, which is a token win rather than merely a feature.

**8. Headless / programmatic mode.**
`mega-agent -p "<prompt>" --output-format json` with stable exit codes. This is
what makes the harness usable in CI, in scripts, and as a subagent of another
harness — and it is the only way the B1 eval loop can drive it at all.

**9. Session persistence, resume, and fork.**
Resume a session; fork it to retry a different approach from a known-good point.
The repo already has `2026-08-11-conversation-fork-time-travel-design.md` — the
harness should consume it rather than ignore it.

**10. NDJSON event side-channel.**
Emit the raw internal event stream as NDJSON from day one. Every metric in B1 and
B6 then becomes a `jq` invocation instead of an instrumentation project six
months later.

---

## Cut list

- Hand-written SGR 1006 mouse parser (N5) — `crossterm` does it.
- "Zero-copy / SIMD JSON" (N6) — not the bottleneck.
- "140+ providers" (N7) — three wire formats, stated honestly.
- Claim Lock Engine (N3) — worktrees already provide the isolation.
- Cold start as a pillar (B6) — keep it as a smoke assertion.
- A second mesh/presence/roster implementation (B2) — use the shipped one.
- Hardcoded model routing defaults (N4) — config-first.

---

## Suggested re-phasing

| Phase | Content | Closes |
|---|---|---|
| **0** | Eval loop + headless mode. Two-arm bench, pinned suite, local model. Nothing else merges until a number exists. | B1, missing-8 |
| **1** | Kernel: agent loop + state machine, streaming, tool dispatch, edit-apply with apply-rate metric, sandboxed bash. | B4, B5, missing-1 |
| **2** | Accuracy levers: diagnostics feedback, repo map, prompt-cache invariant, checkpoints, compaction. Each lands with a bench delta or it does not land. | B3, missing-2/4/5/6 |
| **3** | TUI — after the thing works headlessly and measurably. | — |
| **4** | Mesh as a **client** of `@megasaver/mesh` + agent-office roles; `--candidates N` verify-select mode. | B2, missing-3 |

The current Phase 1→4 ordering builds the interface (TUI) and the coordination
(mesh) before there is a measurable agent to display or coordinate. All four
stated goals — faster, lighter, fewer tokens, higher scores — are numbers. Build
the thing that produces the numbers first.

---

## Process notes

- Spec status is `DRAFT / PROPOSED`. At CRITICAL (B5), §12 requires the full HIGH
  chain plus `tracer`, `security-reviewer`, `verifier` with reproduction
  evidence, and manual user confirmation recorded in the spec before Phase 1.
- B2 requires a governance action, not just an edit: either drop the second mesh,
  or write a superseding spec that explicitly retires the "files are truth, no
  leader" and "advisory claims only" decisions and archives them.
- The pivot from ContextOps platform to agent harness is a mission-level change.
  `docs/conventions/mission.md` currently reads "Mega Saver is the ContextOps
  platform for frontier coding agents… agents connect to Mega Saver, never the
  reverse." Shipping our own agent inverts that sentence. Update the convention
  source and re-run `pnpm conventions:sync`, or the dogfood drift check will be
  correct and the docs will be wrong.
