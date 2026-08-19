# Executor Brief — mega-agent Phase 0 + Phase 1

Hand this **whole file** to the external agent that will implement the plan. It
exists because the implementing agent does not share this repo's session history
and will not read `CLAUDE.md` by default. Do not excerpt a section — the
prerequisites and the traps are what stop it wasting a day.

Regenerated 2026-08-19 against plan rev. 3 (10 tasks). An earlier version of this
brief described an 8-task plan and a sandbox that wrapped child processes; both
are superseded. If the agent quotes either, it is reading the wrong file.

---

## Prompt

You are implementing a Rust coding-agent harness inside an existing pnpm/Turborepo
TypeScript monorepo at `/Users/ozger/Desktop/MegaSaver`.

### Read these first, in this order, before writing any code

1. `docs/superpowers/plans/2026-08-19-rust-agent-harness-plan.md` — the plan you
   are executing. **10 tasks, ~86 steps.** Every code block in it is normative.
2. `docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md` — the design
   the plan argues from. Read §3.3 (the process model — this is the one that
   shapes everything else), §4 (eval loop), §6.2 (prompt-cache invariant), and
   §11 (safety) at minimum.
3. `AGENTS.md` — this repo's engineering conventions. Binding on you.
4. `wiki/index.md`, then `wiki/entities/mega-agent.md` and
   `wiki/decisions/conductor-is-a-role.md` — project memory.

Do not read `fikri.txt`. Do not write anything into `wiki/raw/`.

### The one architectural idea, stated up front

The harness is **two processes**, and the split is a security boundary rather
than an optimisation (spec §3.3).

- The **supervisor** is unsandboxed. It holds the only two connections in the
  system — the model API and the TypeScript daemon — plus the NDJSON journal
  file handle. It does no filesystem work in the worktree.
- The **agent** is a child process with `workspace-write` and **no network at
  all**. It does every read, write, edit, and shell command. It reaches the model,
  the daemon, and the journal only by writing length-prefixed JSON frames to its
  own stdout, which the supervisor answers on its stdin.

Almost every trap below is a corollary of this. If a step seems to want the agent
to open a socket or a file outside the worktree, you have misread it.

### Prerequisites — both checked on 2026-08-19, both still missing

**1. No Rust toolchain.** `cargo` and `rustc` are not on PATH, and `crates/` does
not exist yet. Install rustup/stable first. Then, in Task 1, pin
`rust-toolchain.toml` to the version `rustc --version` actually prints — do not
copy a version string out of the plan.

**2. No local model endpoint.** Spec §13 item 5 is confirmed: the eval runs
against a **local** model, and paid API spend requires separate operator
authorisation. Probed on this machine: no `ollama`, no LM Studio, nothing
OpenAI-compatible listening. (Port 5000 is open but it is macOS AirPlay Receiver,
not a model server.)

Unlike the previous revision of this brief, this is **no longer a hard stop you
have to remember** — Task 6 builds two mechanisms that enforce it for you:

- `preflight` makes one real completion before instance 1 and fails loudly with
  the endpoint in the message. Without it, a missing endpoint yields a green
  build and an empty measurement, because `ArmReport`'s ratios return `Option`
  and correctly refuse to compute on missing data.
- `check_spend_lock` refuses any non-loopback `base_url` unless
  `--allow-remote-model` is passed on the command line.

Build both as specified. Do not weaken either to get a run to complete, and do
not pass `--allow-remote-model` without asking the operator first.

Three steps consequently cannot complete here: Task 5 Step 12, Task 6 Step 9 (the
null test), and Task 8 Step 7 (the eval re-run). Implement them fully, mark them
blocked rather than done, record the command you would have run, and continue to
the next task — they are the one exception to "do not start Task N+1 until Task N
passes". Do not stub the provider or stand up a fake endpoint to get past them.
Task 5 Step 10 is not endpoint-gated; it runs offline and must pass.

### How to execute

- **One task at a time, in order 1 → 10.** Do not start Task N+1 before Task N's
  tests pass.
- **TDD is mandatory and the order is not negotiable:** write the failing test,
  run it, watch it fail for the stated reason, then write the minimum code that
  makes it pass, then run it again. A test that passes the first time you run it
  is a broken test — find out why before continuing.
- **One commit per task**, Conventional Commits, imperative subject ≤ 50 chars.
  Each task's final step gives the exact `git add` paths.
- **Work on a branch, never on `main`.** Suggested:
  `git worktree add ../megasaver-mega-agent -b feat/agent-harness-phase-1`.
- After each task, report: what you wrote, the test command you ran, its real
  output, and anything in the plan that turned out to be wrong.

### Non-negotiables — the traps in this particular plan

1. **The sandbox is entered by the process, not wrapped around a child.**
   `Profile::enter(self)` applies to the current process and is irreversible.
   There is no `Profile::wrap(cmd)`, and reintroducing one is the specific defect
   this revision exists to fix: it leaves the harness's own `fs::write` and
   edit-apply outside the profile, so `bash` is guarded at the syscall boundary
   while `write` is guarded by an `if`.

2. **The agent has no network. There is no carve-out, no pinned port, no loopback
   exception.** If a task appears to need one, it belongs on the supervisor's side
   of the boundary. On Linux, `landlock_restrict_self` must report
   `FullyEnforced` or the process refuses to run — do not downgrade that to a
   warning to get it working on an older kernel.

3. **The agent cannot write the events journal.** It lives outside the worktree.
   Events are shipped as `{kind: "event"}` frames and the supervisor writes them.
   Anything holding a `Box<dyn Events>` must keep holding one; a component that
   opens an `EventSink` directly will compile, pass every unit test, and fail only
   under the real profile.

4. **One emitter per event type.** The table is in Task 5. `usage` is the trap:
   it reaches the agent as a forwarded chunk and the supervisor as a real one, so
   both sides can plausibly emit it. If both do, every token metric is exactly 2×
   and every gate still passes. `ttft` is the supervisor's for a stronger reason —
   measured agent-side it would include the pipe round-trip.

5. **`SupervisorProvider::stream` must stay lazy.** `Provider::stream` returns a
   box with no lifetime parameter, so the iterator is `'static` and cannot borrow
   `self`; capture cloned `Arc` handles. The obvious workaround — drain every
   frame and return `vec.into_iter()` — compiles, and silently makes
   time-to-first-token equal time-to-last-token, destroying a §10.1 metric.

6. **The eval's events path must be absolute.** Each instance runs with its cwd
   set to a disposable worktree. A relative path resolves inside it, the journal
   dies with the tempdir, and you get a report where every token count is zero —
   an empty measurement that looks exactly like a clean one.

7. **No `tokio`, no async runtime.** Blocking `reqwest` + std threads. The harness
   waits on one model call at a time. Dependencies are limited to those the plan
   names.

8. **No model IDs compiled into Rust.** `claude-opus-5`, `claude-sonnet-5`,
   `claude-haiku-4-5-20251001` and any other model name belong in
   `config.example.toml` only. A model id in a `.rs` file is a review failure.

9. **Bash is deliberately absent until Task 10.** Not for safety — the sandbox
   exists from Task 4, so shell would already be contained in Task 8. It is
   deferred so that "can run any command" and "knows which paths are off limits"
   land in the same commit and the same review. Do not add a shell tool to Task 8
   "since the kernel needs one".

10. **The eval suite is committed to `crates/mega-agent/suites/`.** Not
    `.megasaver/` — that path is gitignored (`.gitignore:49`) and the suite would
    silently vanish.

11. **Phase 0's measured delta is expected to be ≈ 0.** That is the null test: it
    proves the measuring apparatus works before there is anything to measure. Do
    not "fix" it, do not tune the baseline to produce a delta, do not skip Phase 0
    to get to the interesting part. Phase 0 is the interesting part.

12. **The prompt-cache invariant (§6.2) is enforced by absence.** `History` has no
    indexed mutation — no `set(i, …)`, no `remove(i)`, no `iter_mut`. If you find
    yourself wanting one, you are about to break the cache prefix. Compaction
    produces a *new* generation instead.

13. **Every sandbox test carries a positive control, on purpose.** The fence test
    also asserts a non-fenced write *succeeds*; the egress test also asserts the
    supervisor pipe still *works*. Without them, "the sandbox works" and "nothing
    works" are the same green. Do not delete them to make a test simpler.

### Verification

Per task: the exact `cargo test` / `pnpm --filter` command the plan's step gives.

Phase 1 exit: `pnpm verify` at the repo root must be green — it runs biome,
`tsc --noEmit`, vitest, and `conventions:check`, and Task 1 folds `lint:rust` and
`test:rust` into it. If Rust is silently skipped by `pnpm verify`, Task 1's
plumbing is wrong; fix it there, not by running cargo separately.

Task 5 Step 10 (`cargo test -p mega-agent proxy_tests`) is the offline check on
the two §3.3 rules that fail silently — one emitter per event type, and the
agent never opening the journal. It needs no model server; if you have to skip
something for lack of an endpoint, it is not this.

Task 5 Step 12 is the first end-to-end exercise of the process split. Read the
journal rather than checking the exit code — `jq -r .type /tmp/ev.ndjson | sort |
uniq -c` should show all five event types. Three distinct failures look like
success from the outside; the step lists them.

### Stop and ask the operator — do not decide these yourself

- **You may not merge Phase 1 to `main`.** The §3.3 supervisor/agent trust
  boundary is a new privilege split with the supervisor on the privileged side,
  and it is assigned to separate `architect` and `security-reviewer` passes.
  Implement it as specified and stop at a reviewable branch. (The §11.1 loopback
  question that blocked the previous revision is closed — resolved 2026-08-19 by
  removing the carve-out entirely, not by pinning a port.)
- Any spec requirement you cannot implement as written. Say so; do not improvise
  a substitute and continue.
- Any step that would spend money on a paid model API, including passing
  `--allow-remote-model`. See Prerequisite 2.
- Anything destructive: `rm -rf`, force push, branch deletion, history rewrite,
  `git reset --hard`.

### Do not

- Do not hand-edit `CLAUDE.md`, `AGENTS.md`, or `.cursor/rules/*.mdc`. They are
  generated from `docs/conventions/`; edit the source there and run
  `pnpm conventions:sync --write` (bare `conventions:sync` only *checks* and
  exits 1 on drift).
- Do not use `--no-verify` or otherwise bypass hooks.
- Do not add agent-specific logic to `@megasaver/core`.
- Do not leave stub functions or half-implementations. If a task will not fit,
  stop and say so rather than merging a stub.
- Do not write "what" comments. Comment only a non-obvious WHY.

### Two debugging shortcuts, so you do not lose an hour each

**macOS re-exec.** `Profile::enter` on macOS re-execs the binary under
`sandbox-exec`, because `exec` replaces the process image and therefore preserves
the inherited pipes. Two details are load-bearing: argv is forwarded via
`std::env::args().skip(1)` so the `--agent` flag survives, and `MEGA_AGENT_SANDBOXED`
is set in the exec'd *environment*, not merely read. Break either and the
re-exec'd process restarts in supervisor mode and spawns a third process — while
`the_supervisor_channel_survives_the_sandbox` still passes, because the pipes do
survive. It is the mode that flips, silently.

**`/dev/tcp` in the egress test.** If a connect attempt fails in a way you did not
expect, check that `/bin/sh` supports `/dev/tcp` **before** you touch the seatbelt
profile. On this machine it does (verified: a connect to a closed port returns
"Connection refused", not "no such file"), but that is a shell build feature, not
a guarantee.

### Definition of done for this handoff

Tasks 1–10 committed on the branch, `pnpm verify` green, the six
`sandbox_escape` tests passing on this machine, and a written report listing
every place the plan disagreed with reality.

### Context you do not otherwise get

- **Operator confirmations.** All seven CRITICAL items in spec §13 are confirmed
  as of 2026-08-19, including item 6 (Mega Saver now ships a first-party agent;
  `docs/conventions/mission.md` and its three mirrors were updated together).
  Item 5 is no longer only a promise — the §4.4 spend lock enforces it in code.
- **Still open.** The §3.3 trust boundary review. It is a review question, not an
  operator question, and it is the reason Phase 1 stops at a branch.
- **Scope.** The plan is Phase 0 + Phase 1 only. Phases 2–4 (multi-terminal
  conductor, TUI, test-time compute) are specified but not planned; do not
  anticipate them in the code.
