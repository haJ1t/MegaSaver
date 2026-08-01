---
title: Cache-write reduction design source
tags: [cache, saver, warm-start, design]
sources:
  - docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md
  - docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md
status: active
created: 2026-08-01
updated: 2026-08-01
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

The first three safety tasks now provide an installed store override, a
store-global terminal session claim, and a single-file CLI worker bridge. The
parent writes an envelope only before its absolute 500 ms deadline and requests
cost accounting only after the stdout callback succeeds; event loss after
delivery is allowed, but false pre-delivery accounting is not. Intent capture
also runs inside the terminable worker. (source:
`.superpowers/sdd/2026-08-01-task-kickoff-safety-amendment-plan/task-3-report.md`)
