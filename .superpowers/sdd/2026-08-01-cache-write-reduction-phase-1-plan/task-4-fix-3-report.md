# Task 4 deadline and claim-retention follow-up

Base: `97c0630d` on `fix/cli-task-kickoff-hardening`.

## Deadline after event append

The kickoff event stream is append-only, so synchronously rewriting it after an
expired append could lose another session's concurrent event. The follow-up
instead appends a strict, exact-ID retraction record. `readTaskKickoffEvents`
omits retracted IDs, so all consumers see no TaskKickoff cost event after a
successful deadline cleanup while the raw JSONL retains only an audit trail of
the retraction.

The expired path writes that retraction first, removes the cached pack second,
and removes the session claim last. Therefore a successful cleanup leaves no
active event, pack, or emission guard and the next prompt can emit once with a
new UUID. If any retraction or cleanup write fails, the claim remains and the
hook returns no output: it fails closed rather than risking duplicate emission.

Synchronous Node filesystem calls cannot be preempted once entered. The hook
does not claim to cancel a slow append; it detects the elapsed deadline after
that call and reconciles its durable state before returning no context.

## Claim retention

The established daily 30-day task-pack sweep now includes `*.json.claim` files
beside `*.json` packs. This is retention housekeeping only; a claim's age is
never interpreted by the hook as permission to reclaim or steal a live
session's emission guard.

## Test evidence

New RED cases failed before the implementation:

1. A real synchronous 600 ms delay after event append returned no output but
   retained the pack/event/claim.
2. A 40-day-old `.json.claim` survived the task-pack GC.

Green coverage now proves:

- slow post-append expiry produces no active event, pack, or claim, and a new
  UUID retry emits exactly one active event;
- failed retraction retains the pack/claim/event and suppresses retry;
- an old claim is pruned, a fresh claim is retained, and an unrelated old file
  is untouched;
- retraction hides only its matching event, preserving a concurrent-style
  sibling event.

Verification:

```text
pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts test/hooks/gc.test.ts
# 3 files passed, 26 tests passed
pnpm --filter @megasaver/stats exec vitest run test/task-kickoff-event.test.ts
# 1 file passed, 6 tests passed
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/stats typecheck
pnpm exec biome check apps/cli/src/hooks/task-kickoff.ts apps/cli/src/hooks/gc.ts apps/cli/test/hooks/task-kickoff-hardening.test.ts apps/cli/test/hooks/gc.test.ts packages/stats/src/task-kickoff-event.ts packages/stats/test/task-kickoff-event.test.ts
git diff --check
```
