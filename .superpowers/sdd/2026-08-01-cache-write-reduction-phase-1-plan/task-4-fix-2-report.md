# Task 4 follow-up hardening report

Base: `fcacf805` in the isolated `fix/cli-task-kickoff-hardening` worktree.

## Result

- Replaced the mtime-based, releasable `.lock` with a durable per-session
  `.claim`, created through exclusive file creation (`open(..., "wx")`).
- A claim is never stolen based on age and is never released after a successful
  pack/event commit. An existing or malformed claim blocks emission, so the
  same workspace/session can produce at most one pack and one kickoff event.
- The claim contains the generated event ID. If event append throws, the hook
  reads the JSONL for that exact ID. A found ID treats append as committed and
  returns the original context once; later calls are blocked by the claim.
- If the event stream is readable and the exact ID is absent, the hook removes
  the uncommitted pack and claim, allowing a later retry. If the event stream
  cannot be read, it fails closed and keeps the committed pack/claim because
  recovery would not be safe.
- Claude's first-party `UserPromptSubmit` envelope fields are stripped while
  `prompt`, `cwd`, and `session_id` remain required and validated.
- Store setup, rendering, and claim creation are deadline-raced and every
  subsequent phase checks the remaining deadline before output. A detected
  deadline after a pre-event cache write removes the uncommitted state; a
  detected deadline after event append returns no context.

## Deadline boundary

The hook can abort or ignore its asynchronous setup, Git, rendering, and claim
work. It cannot forcibly interrupt a synchronous filesystem syscall already
inside Node (cache write or JSONL append), so this is not a hard wall-clock
guarantee for a blocked filesystem. The post-operation deadline checks ensure
such an operation never leads to hook output after the deadline is detected.

## Test evidence

The added focused tests cover:

1. Extra first-party hook fields with required-field validation retained.
2. An append helper that writes the event and then throws, followed by a retry
   that does not duplicate it.
3. A confirmed eventless append failure that safely recovers for a retry.
4. A real Node child process holding the exact old-looking claim path; the hook
   does not steal it, then emits only after the child releases it.
5. Slow Git work timing out without a pack or event.

The child-process test uses Node's built-in `--input-type=module` and no new
dependency. It proves the no-stale-steal behavior at the hook boundary across
processes without needing a compiled second CLI runtime.

Verification run:

```text
pnpm --filter @megasaver/cli exec vitest run test/hooks/task-kickoff.test.ts test/hooks/task-kickoff-hardening.test.ts
# 2 files passed, 13 tests passed
pnpm --filter @megasaver/cli typecheck
pnpm exec biome check apps/cli/src/hooks/task-kickoff.ts apps/cli/src/hooks/task-kickoff-store.ts apps/cli/test/hooks/task-kickoff.test.ts apps/cli/test/hooks/task-kickoff-hardening.test.ts
git diff --check
```
