---
title: Cache-write reduction design source
tags: [cache, saver, warm-start, design]
sources:
  - docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md
  - docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md
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

The completed safety implementation provides an installed store override, a
store-global terminal session claim, a single-file CLI worker bridge, and
fail-closed owner-only persistence on POSIX. Windows emits nothing and creates
no task-kickoff state until a reviewed owner-ACL implementation exists. The
parent writes an envelope only before its absolute 500 ms deadline and requests
cost accounting only after the stdout callback succeeds; event loss after
delivery is allowed, but false pre-delivery accounting is not. A cost row is
therefore evidence of local stdout callback success, not proof Claude consumed
the response, and it is never a savings event. Intent capture
also runs inside the terminable worker. During a pending stdout write, every
extra Worker message is a terminal protocol failure, so it cannot authorize an
event. The parent and Worker share one absolute wall-clock deadline; a 50 ms
pre-deadline cancellation window aborts Git work before hard Worker
termination. A timeout leaves stdout and events absent, but a claim/pack that
finished persistence may remain terminal. The response is additionally bounded
to 9,000 UTF-16 code units and 2,000 measured tokens; over-limit evidence is
rejected rather than truncated. The session-global claim and winning pack are
permanent local state and remain completely outside overlay GC. (sources:
`.superpowers/sdd/2026-08-01-task-kickoff-safety-amendment-plan/task-3-report.md`,
`docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`)
