---
title: Y5 — aider sync noop + stale-block-replace coverage
date: 2026-05-10
risk: MEDIUM
status: approved
author: aa2-connector
---

# Y5: aider sync noop + stale-block-replace coverage

## Problem

PR #21 added aider as the 4th connector target (`CONVENTIONS.md`). Its critic
flagged two untested paths:

1. **noop path** — running `connector sync --target aider` twice in a row; the
   second call should emit `aider  CONVENTIONS.md  noop` (idempotent, no
   rewrite).
2. **stale-block in-place replace** — `CONVENTIONS.md` already has a Mega Saver
   block but the block content has drifted (e.g., stale session id); `connector
   sync --target aider` should REPLACE the sentinel-bounded region in-place,
   leaving content above/below intact.

The codex/claude-code precedent for both paths exists in
`apps/cli/test/connector.test.ts` (`describe("connectorSyncCommand — wrote +
noop", ...)`, lines 298 and 347).

## Goal

Add 2 new tests to `apps/cli/test/connector.test.ts` only. No production code
changes required (the connector already supports these paths correctly; tests
document existing behavior).

## Decisions

**Q1 — Describe block placement:** Share the existing
`describe("connectorSyncCommand — cursor target", ...)` block. The 3 existing
aider tests (lines 789-835) already live there and share its helpers
(`seedProject`, `seedSession`, `PROJECT_ID_CURSOR`, `SESS_CURSOR`). No
structural refactor needed.

**Q2 — Noop test scope:** `--target aider` exclusively (mirrors claude-code
noop precedent at line 361-366).

**Q3 — Stale-block fixture:** `MEGA_BLOCK_PLACEHOLDER("demo", PROJECT_ID_CURSOR,
"aider")` — directly mirrors the codex precedent at line 320-324. Pre-seeds
`CONVENTIONS.md` with a stale block (stale session id `"old-aider-id"`), then
syncs and verifies replacement.

## Test designs

### Test 1: noop

```ts
it("emits noop on idempotent aider rerun (block content unchanged)", async () => {
  await seedProject("demo", projectRoot);
  await seedSession(SESS_CURSOR, "aider", "2026-05-09T00:00:00.000Z");
  // First sync seeds CONVENTIONS.md.
  await runSync({ projectName: "demo", target: "aider" });
  logSpy.mockClear();
  errSpy.mockClear();

  await runSync({ projectName: "demo", target: "aider" });

  expect(process.exitCode).toBe(0);
  expect(
    logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+noop$/.test(c[0] as string)),
  ).toBe(true);
});
```

### Test 2: stale-block in-place replace

```ts
it("replaces stale aider block in-place (CONVENTIONS.md already exists)", async () => {
  await seedProject("demo", projectRoot);
  await seedSession(SESS_CURSOR, "aider", "2026-05-09T00:00:00.000Z");
  await writeFile(
    join(projectRoot, "CONVENTIONS.md"),
    MEGA_BLOCK_PLACEHOLDER("demo", "old-aider-id", "aider"),
  );

  await runSync({ projectName: "demo", target: "aider" });

  expect(process.exitCode).toBe(0);
  const written = await readFile(join(projectRoot, "CONVENTIONS.md"), "utf8");
  expect(written).toContain(`Project: demo (${PROJECT_ID_CURSOR})`);
  expect(written).not.toContain("old-aider-id");
  expect(
    logSpy.mock.calls.some((c) => /^aider\s+CONVENTIONS\.md\s+wrote$/.test(c[0] as string)),
  ).toBe(true);
});
```

## Files changed

- `apps/cli/test/connector.test.ts` — +2 `it` blocks inside existing
  `describe("connectorSyncCommand — cursor target", ...)`

## Behavior contract

- Second sync of an unchanged aider block emits `noop` status word.
- Pre-existing stale block is replaced in-place; stale id is gone; status word
  is `wrote`.
- Both behaviors are already implemented; these tests document and lock them.
