# Antigravity Execution Prompt — mega-agent Phase 0 + Phase 1

Paste everything below the line into Antigravity, with the repo open at
`/Users/ozger/Desktop/MegaSaver`. It is a wrapper, not a replacement: the
substance lives in the executor brief and the plan, and this prompt exists to
point at them, translate the process rules into Antigravity's tool vocabulary,
and restate the traps that a skimming agent will otherwise walk into.

---

You are implementing a Rust coding-agent harness (`crates/mega-agent`) inside an
existing pnpm/Turborepo TypeScript monorepo at `/Users/ozger/Desktop/MegaSaver`.
The work is already specified and already planned. **Your job is execution, not
design.** Do not redesign, do not re-plan, do not propose an alternative
architecture. If you believe the plan is wrong, say so and stop — do not
improvise around it.

## 1. Read these first, in this order, before writing any code

1. `docs/superpowers/plans/2026-08-19-rust-agent-harness-executor-brief.md` —
   read this **whole file**. It is your operating manual: prerequisites, the
   thirteen non-negotiables, verification, and the stop-and-ask list. Everything
   in it binds you. This prompt does not supersede it; it points at it.
2. `docs/superpowers/plans/2026-08-19-rust-agent-harness-plan.md` — the plan you
   are executing. **10 tasks, ~86 steps.** Every code block in it is normative:
   type it as written unless it does not compile, and if it does not compile,
   report the discrepancy rather than silently redesigning around it.
3. `docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md` — the design
   the plan argues from. §3.3 (process model) at minimum, then §4 (eval loop),
   §6.2 (prompt-cache invariant), §11 (safety).
4. `AGENTS.md` — this repo's engineering conventions. Binding on you.
5. `wiki/index.md`, then `wiki/entities/mega-agent.md` and
   `wiki/decisions/supervisor-agent-split.md` — project memory.

Do not read `fikri.txt` (1400 lines, superseded). Never write into `wiki/raw/`.

## 2. The one architectural idea

The harness is **two processes**, and the split is a security boundary, not an
optimisation (spec §3.3).

- The **supervisor** is unsandboxed. It holds the only two connections in the
  system — the model API and the TypeScript daemon — plus the NDJSON journal
  file handle. It does no filesystem work in the worktree.
- The **agent** is a child process with `workspace-write` and **no network at
  all**. It does every read, write, edit, and shell command. It reaches the
  model, the daemon, and the journal only by writing 4-byte length-prefixed JSON
  frames to its own stdout, which the supervisor answers on its stdin.

Most of the traps below are corollaries. If a step seems to want the agent to
open a socket, or to write a file outside the worktree, you have misread it.

## 3. How you work — Antigravity specifics

- **Task tracking is a task artifact.** You have no todo tool (`manage_task`
  manages background processes; it is not a checklist). Before Task 1, create a
  task artifact — `write_to_file` with `IsArtifact: true`,
  `ArtifactMetadata.ArtifactType: "task"` — that mirrors the plan's 10 tasks and
  their steps as `- [ ]` items. Mark each `- [x]` as you finish it, using
  `replace_file_content`. Re-read it before starting each task; once the
  conversation is long it is your only reliable memory of what remains.
- **Do not write an implementation-plan artifact.** The plan exists and is
  normative. Producing your own plan artifact means you are about to execute
  yours instead of it. Your artifacts are the task checklist and, at the end,
  the walkthrough.
- **Subagents: read-only only.** `invoke_subagent` with `TypeName: "research"`
  is fine for looking something up in the repo. Do **not** dispatch a `self`
  subagent to implement a task. The red→green cycle has to happen in the main
  thread where you see the real terminal output; a subagent reporting "tests
  pass" is not evidence.
- **No browser.** Nothing here is verified in a browser. Do not open one.
- **Long builds:** `cargo build` on a cold registry is slow. Run it in the
  background with `manage_task` if it helps, but never report a result you did
  not read.
- **Real output or it did not happen.** Every test claim must be backed by
  terminal output you actually ran and actually read. Never write "tests pass"
  from expectation.

## 4. Environment — two things are missing, both checked 2026-08-19

**No Rust toolchain.** `cargo` and `rustc` are not on PATH; `crates/` does not
exist. Install rustup/stable first. If installing it requires anything you
cannot do unattended, stop and ask the operator. In Task 1, pin
`rust-toolchain.toml` to the version `rustc --version` actually prints — do not
copy a version string out of the plan.

**No local model endpoint.** The eval runs against a **local** model; paid API
spend needs separate operator authorisation. Task 6 builds two mechanisms that
enforce this for you — `preflight` (one real completion before instance 1, fails
loudly) and `check_spend_lock` (refuses any non-loopback `base_url` without
`--allow-remote-model`). Build both as specified. Do not weaken either to get a
run to complete, and do not pass `--allow-remote-model` without asking first.

## 5. The execution loop

- **One task at a time, in order 1 → 10.** Do not start Task N+1 until Task N's
  tests pass.
- **TDD, in this order, no exceptions:** write the failing test → run it → watch
  it fail *for the reason the plan states* → write the minimum code that makes it
  pass → run it again. **A test that passes the first time you run it is a broken
  test.** Find out why before continuing; do not proceed on a green you did not
  earn.
- **One commit per task.** Conventional Commits, imperative subject ≤ 50 chars.
  Each task's final step gives the exact `git add` paths.
- **Work on a branch, never on `main`:**
  `git worktree add ../megasaver-mega-agent -b feat/agent-harness-phase-1`
- **After each task, report:** what you wrote, the exact test command, its real
  output, and anything in the plan that turned out to be wrong.

**Three steps are endpoint-gated and cannot complete on this machine** — Task 5
Step 12, Task 6 Step 9 (the null test), and Task 8 Step 7 (the eval re-run). All
three execute the eval against a local model that is not installed here.
Implement them fully, mark them `- [!]` (blocked, not done) in the task
artifact, record the exact command you would have run, and **continue to the
next task**. They are the one exception to "do not start Task N+1 until Task N
passes". Do not stub the provider, do not stand up a mock or fake endpoint, do
not pass `--allow-remote-model` to get past them. Task 5 Step 10 is **not**
endpoint-gated — it runs offline and must pass.

## 6. The six traps most likely to cost you a day

The brief lists thirteen and you must read all of them. These six fail *silently* —
they compile, the tests go green, and the defect only shows up in a number nobody
checks:

1. **The sandbox is entered by the process, not wrapped around a child.**
   `Profile::enter(self)` applies to the current process and is irreversible.
   There is no `Profile::wrap(cmd)`. Reintroducing one leaves the harness's own
   `fs::write` outside the profile — `bash` guarded at the syscall boundary while
   `write` is guarded by an `if`.
2. **One emitter per event type** (table in Task 5). `usage` is the trap: it
   reaches the agent as a forwarded chunk and the supervisor as a real one, so
   both sides can plausibly emit it. If both do, every token metric is exactly 2×
   and every gate still passes.
3. **The agent cannot write the events journal.** It lives outside the worktree.
   Events ship as `{kind: "event"}` frames; the supervisor writes them. A
   component that opens an `EventSink` directly compiles, passes every unit test,
   and fails only under the real profile.
4. **`SupervisorProvider::stream` must stay lazy.** The obvious workaround —
   drain every frame, return `vec.into_iter()` — compiles, and silently makes
   time-to-first-token equal time-to-last-token, destroying a §10.1 metric.
5. **The eval's events path must be absolute.** Each instance runs with cwd set
   to a disposable worktree; a relative path dies with the tempdir and yields a
   report where every token count is zero — an empty measurement that looks
   exactly like a clean one.
6. **Phase 0's measured delta is expected to be ≈ 0.** That is the null test: it
   proves the apparatus works before there is anything to measure. Do not "fix"
   it, do not tune the baseline to produce a delta, do not skip Phase 0 to reach
   the interesting part. Phase 0 *is* the interesting part.

Also, structurally: **no `tokio`** (blocking `reqwest` + std threads), **no model
IDs in `.rs` files** (they belong in `config.example.toml`), and the eval suite
is committed to `crates/mega-agent/suites/` — not `.megasaver/`, which is
gitignored (`.gitignore:49`) and would silently vanish.

## 7. Verification

Per task: the exact `cargo test` / `pnpm --filter` command that step gives.

**Task 5 Step 10** (`cargo test -p mega-agent proxy_tests`) is the offline check
on the two §3.3 rules that fail silently. It needs no model server. If you have
to skip something for lack of an endpoint, it is not this.

**Task 5 Step 12** is the first end-to-end exercise of the process split. Read
the journal, not the exit code: `jq -r .type /tmp/ev.ndjson | sort | uniq -c`
should show all five event types. Three distinct failures look like success from
the outside; the step lists them.

**Phase 1 exit:** `pnpm verify` at the repo root must be green — biome,
`tsc --noEmit`, vitest, `conventions:check` — and Task 1 folds `lint:rust` and
`test:rust` into it. If Rust is silently skipped by `pnpm verify`, Task 1's
plumbing is wrong; fix it there, not by running cargo separately.

## 8. Stop and ask the operator — do not decide these yourself

- **You may not merge Phase 1 to `main`.** The §3.3 trust boundary is a new
  privilege split and is assigned to separate `architect` and
  `security-reviewer` passes. Implement it and stop at a reviewable branch.
- Any spec requirement you cannot implement as written. Say so; do not improvise
  a substitute and continue.
- Anything that would spend money on a paid model API, including
  `--allow-remote-model`.
- Anything destructive: `rm -rf`, force push, branch deletion, history rewrite,
  `git reset --hard`.

## 9. Never

- Never hand-edit `CLAUDE.md`, `AGENTS.md`, or `.cursor/rules/*.mdc` — they are
  generated from `docs/conventions/`. Edit the source and run
  `pnpm conventions:sync --write` (bare `conventions:sync` only *checks* and
  exits 1 on drift).
- Never use `--no-verify` or bypass hooks.
- Never add agent-specific logic to `@megasaver/core`.
- Never leave a stub or a half-implementation. If a task will not fit, stop and
  say so.
- Never write "what" comments. Comment only a non-obvious WHY.
- Never delete a sandbox test's positive control. The fence test also asserts a
  non-fenced write *succeeds*; the egress test also asserts the supervisor pipe
  still *works*. Without them, "the sandbox works" and "nothing works" are the
  same green.

## 10. Done means

Tasks 1–10 committed on the branch; `pnpm verify` green; the six
`sandbox_escape` tests passing on this machine; and a walkthrough artifact
listing every place the plan disagreed with reality. Scope is Phase 0 + Phase 1
only — Phases 2–4 (multi-terminal conductor, TUI, test-time compute) are
specified but not planned. Do not anticipate them in the code.
