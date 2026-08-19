---
title: mega-agent — the Rust agent harness (proposed)
tags: [entity, agent-harness, rust, critical, proposed]
sources:
  - docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md
  - docs/superpowers/reviews/2026-08-19-rust-agent-harness-review.md
  - docs/superpowers/plans/2026-08-19-rust-agent-harness-plan.md (rev.3, 10 tasks, Phase 0+1)
  - docs/superpowers/plans/2026-08-19-rust-agent-harness-executor-brief.md
status: active
created: 2026-08-19
updated: 2026-08-19
---

# mega-agent

**Proposed `crates/mega-agent` — not on disk yet.** The product pivot (user
directive 2026-08-19): Mega Saver stops being only a ContextOps platform and
ships **its own coding agent harness**, blending the best of jcode / opencode /
pi / herdr.

The north-star goal is a **number, not a feature list**: a model's coding
benchmark resolve rate must rise measurably when driven through this harness
versus the same model on a baseline harness.

## Status — spec rev. 2, risk CRITICAL

Spec v1 was reviewed (`.../reviews/2026-08-19-...`, verdict
`revise-before-phase-1`) and rewritten. Risk was raised HIGH → **CRITICAL**:
the harness edits user repos, spawns processes, and runs `bash` — and
[[entities/agent-office]] already grades agent spawning CRITICAL, so HIGH was
an inconsistency, not a judgement call. Blocking chain: `architect`, `critic`,
`security-reviewer`, `verifier`, `tracer`.

The plan was regenerated from rev. 2 on 2026-08-19, then revised again the same
day when the sandbox turned out to be in the wrong place — see
[[decisions/supervisor-agent-split]]. It now runs to **10 tasks / 83 steps**,
covering **Phase 0 + Phase 1 only** (containment, instrument, then kernel).
Phases 2–4 get their own plans once the eval loop can price them.

## Shape

- **Rust/TS boundary is cut by call frequency**, not by package: per-token and
  per-tool work is Rust; per-turn work (ranking, redaction, memory, fence
  compile) calls the existing TypeScript over the [[entities/daemon]] UDS seam.
  No 30-package rewrite.
- **Accuracy levers** (each measured, each cuttable): edit-apply ladder,
  post-edit diagnostics feedback, N-candidate select-by-verify, repo map with
  graph ranking, failed-attempt recall ([[concepts/failed-run-learning]]).
- **Multi-terminal** reuses [[entities/mesh]] + [[entities/agent-office]] —
  see [[decisions/conductor-is-a-role]].
- **Prompt-cache invariant**: never rewrite a cached prefix. The measured
  0.96×/0.93× defect in [[syntheses/saver-cache-churn]] is the thing not to
  re-enter.
- **Two processes** — an unsandboxed supervisor holding the model and daemon
  connections plus the journal, and a sandboxed agent with **no network at all**
  that reaches everything through an inherited pipe. See
  [[decisions/supervisor-agent-split]]; this is the load-bearing structural fact
  and most implementation traps are corollaries of it.
- **Sandbox** default `workspace-write`, network none; entered by the *process*
  (irreversibly), never wrapped around a child `Command`. `fence.yaml` compiles
  to an OS sandbox (seatbelt / Landlock) because a tool-level check is bypassable
  by `bash` in one line — and an in-process `fs::write` bypasses it without even
  needing `bash`.

## Operator confirmations — all closed 2026-08-19

All seven spec §13 items confirmed, including the mission inversion; see
[[decisions/first-party-agent-mission-change]]. `docs/conventions/mission.md`
and its three generated mirrors were updated the same day.

## Closed 2026-08-19 — the two items that were blocking

1. **§11.1 sandbox/daemon loopback conflict — closed by deletion.** The earlier
   recommendation (narrow the carve-out to spawned workers) was built on the
   `Profile::wrap` defect and is void. Under
   [[decisions/supervisor-agent-split]] no sandboxed process ever needs a socket,
   so `workspace-write` means network: none with no exception at all.
2. **No local model endpoint — resolved architecturally, not by installing
   anything.** Three mechanisms in spec §4.4 make the absence loud instead of
   quiet: `preflight` makes one real completion before instance 1 and fails with
   the endpoint named; `compare` refuses a delta when endpoint / model /
   suite_hash differ across journals; `check_spend_lock` rejects a non-loopback
   `base_url` without `--allow-remote-model`. The endpoint lives in a separate
   `[eval]` config block, so any OpenAI-compatible server satisfies it. Probed
   2026-08-19 and still true: nothing is listening on this machine, but that now
   produces an error rather than an empty measurement.

## Open — still blocks Phase 1

1. **The §3.3 trust boundary review.** A new privilege split with the supervisor
   on the privileged side. Assigned to `architect` + `security-reviewer`.
2. The rest of the CRITICAL review chain: `critic`, `verifier`, `tracer`.

Execution is handed to an external Gemini agent via
`plans/2026-08-19-rust-agent-harness-executor-brief.md` (regenerated for the
10-task plan). Nothing is on disk yet — `crates/` does not exist and there is no
Rust toolchain installed.
