---
title: Cache-write reduction design source
tags: [cache, saver, warm-start, design]
sources:
  - docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md
  - docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md
  - docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md
status: active
created: 2026-08-01
updated: 2026-08-02
---

## Summary

The user approved the recommended cache-write reduction sequence: stable task
kickoff context, batch-read advice, `mega cache` suffix audit, then a safe
PreToolUse output-route adviser. The kickoff pack emits once per session rather
than re-injecting a new suffix for every prompt. It corrects the retracted
cache-mutation theory and treats total cost plus task parity—not a cache-write
percentage—as the acceptance metric. (source: `docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md`)

## Boundaries

No arbitrary Bash mutation, proxy request rewriting, automatic keep-alive, or
unattributed dollar claim is in scope. Each phase remains separately gated and
evidence-preserving. (source: `docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md`)

## Task Kickoff safety implementation

Task Kickoff uses a store-global permanent claim and owner-only POSIX state;
the published single-file `mega.mjs` bundle is sidecar-free, while the ordinary
`dist` CLI uses its Task Kickoff worker sidecar. Windows emits no response or
Task Kickoff state. Its canonical-path resolver selects only one uniquely
deepest registered root and fails closed on a tie or unresolved cwd. (sources:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`,
`docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`)

Only the supported first-party launchers are owned; repeated installation
deduplicates them while uninstall preserves foreign hook entries and metadata.
A pre-deadline `stdout.write` is irreversible and may drain later; accounting is
requested only when its callback succeeds before the same deadline, so a cost
row proves local callback success, not Claude consumption or savings. The
parent records that event only within the entry-inclusive remaining deadline;
the worker never loads the native lock binding. Installed runtimes append a
descriptor-locked JSONL row, while bare bundles with no `fs-ext` atomically
publish a validated immutable event part. No savings claim exists until the
pending paired fresh-store benchmark reports task parity and total cost.
(sources: `docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`,
`docs/superpowers/plans/2026-08-01-task-kickoff-final-hardening-plan.md`)

Node 22 verification after the final fallback/deadline changes passed
`pnpm verify` (60/60 Turbo tasks; CLI 1,597 passed, 1 skipped across 153 files)
and stats 331 tests. Fresh review found no Critical or Important code-path
finding after commits `6649ccb3`, `2c63ca91`, `61f22ced`, `fc5ca2a3`, and
`4a5ffe53`. The load-sensitive strict real-bundle-delivery assertion was
replaced with an honest artifact smoke plus deterministic parent/worker,
native-free fallback, held-lock, and real process-group cancellation proofs.
Phase 1 is complete; no savings claim is made before the paired benchmark.
(source:
`.superpowers/sdd/2026-08-01-task-kickoff-final-hardening-plan/progress.md`)
