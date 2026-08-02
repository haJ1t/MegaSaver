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

Task Kickoff uses a store-global permanent claim, a sidecar-free worker, and
owner-only POSIX state; Windows emits no response or Task Kickoff state. Its
canonical-path resolver selects only one uniquely deepest registered root and
fails closed on a tie or unresolved cwd. The event append opens the final target
with no-follow and nonblocking flags, validates a regular descriptor, and sets
owner mode through that descriptor. (sources:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`,
`docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`)

Only the supported first-party launchers are owned; repeated installation
deduplicates them while uninstall preserves foreign hook entries and metadata.
A pre-deadline `stdout.write` is irreversible and may drain later; accounting is
requested only when its callback succeeds before the same deadline, so a cost
row proves local callback success, not Claude consumption or savings. The Node
22 fully minified single-file bundle measured 11,050,961 bytes locally and CI
selects the size, self-worker, native-exclusion, GUI bridge, and platform-aware
Windows no-state checks. No savings claim exists until the pending paired
fresh-store benchmark reports task parity and total cost. (source:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`)

The final Node 22 gate also proves that nonblocking FIFO refusal returns
structured `ENXIO`/status 1 within a 1,000 ms test watchdog, normal cancellation
always forbids a delayed child marker, and the dedicated POSIX CI mode requires
the child-start marker before proving cancellation. Exact-50,000-byte
unique-code-line saver corpora preserve real compression, evidence-ledger,
daemon transport, persistence, fallback, and accounting coverage without
starving Vitest RPC under parallel load. The final `pnpm verify` passed all 60
Turbo tasks; CLI reported 1,544 passed tests and 9 skipped across 151 files.
(sources:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`,
`docs/superpowers/plans/2026-08-01-task-kickoff-final-hardening-plan.md`)
