# Y5: aider sync noop + stale-block-replace coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 2 tests to `connector.test.ts` covering the aider noop and stale-block-replace paths, mirroring the codex/claude-code precedent.

**Architecture:** Both tests are appended inside the existing `describe("connectorSyncCommand — cursor target", ...)` block (before the closing `}`), reusing its `seedProject`, `seedSession`, `PROJECT_ID_CURSOR`, `SESS_CURSOR`, `runSync`, `logSpy`, `errSpy`, and `writeFile` helpers already in scope.

**Tech Stack:** TypeScript strict ESM, Vitest

---

## File Map

| File | Change |
|------|--------|
| `apps/cli/test/connector.test.ts` | +2 `it` blocks inside existing describe (before line 836 `}`) |

---

### Task 1: Add noop test

**Files:**
- Modify: `apps/cli/test/connector.test.ts` — insert before the closing `});` of `describe("connectorSyncCommand — cursor target", ...)` at line 836

- [ ] **Step 1: Locate the insertion point**

The existing `describe("connectorSyncCommand — cursor target", ...)` block ends at line 836 with `});`. The last test in the block ends at line 835. Insert the new `it` block between line 835 and 836.

Current lines 833-836:
```ts
    await expect(readFile(join(projectRoot, "CONVENTIONS.md"), "utf8")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Insert noop test before the closing `});`**

Replace:
```ts
    await expect(readFile(join(projectRoot, "CONVENTIONS.md"), "utf8")).rejects.toThrow();
  });
});
```

With:
```ts
    await expect(readFile(join(projectRoot, "CONVENTIONS.md"), "utf8")).rejects.toThrow();
  });

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
});
```

- [ ] **Step 3: Run the new test in isolation**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
pnpm --filter @megasaver/cli test -- --reporter=verbose 2>&1 | grep -A 3 "noop.*aider\|aider.*noop"
```

Expected: test passes (or fails if connector doesn't support this — investigate if so).

---

### Task 2: Add stale-block-replace test

**Files:**
- Modify: `apps/cli/test/connector.test.ts` — insert after the noop test, before the closing `});`

- [ ] **Step 1: Insert stale-block-replace test**

Replace the closing `});` added in Task 1 with:
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
});
```

- [ ] **Step 2: Run all connector tests**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
pnpm --filter @megasaver/cli test 2>&1 | grep -E "FAIL|PASS|✓|✗|×|passed|failed" | head -20
```

Expected: all tests pass including both new ones.

---

### Task 3: pnpm verify + commit

- [ ] **Step 1: Run full verify**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
pnpm verify 2>&1 | tail -15
```

Expected: lint + typecheck + tests all GREEN.

- [ ] **Step 2: Commit**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
git add apps/cli/test/connector.test.ts
git commit -m "test: aider sync noop + stale-block-replace coverage"
```

---

### Task 4: Push + PR

- [ ] **Step 1: Push**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
git push -u origin feat/y5-aider-sync-coverage
```

- [ ] **Step 2: Open PR**

```bash
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/y5-aider-sync-coverage
gh pr create \
  --title "test(cli): aider sync noop + stale-block-replace coverage (Y5)" \
  --body "..."
```

- [ ] **Step 3: SendMessage team-lead with PR URL**
