# Doctor Saver-Liveness Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `mega doctor`'s `saver-liveness` check failing forever on dead historical workspaces, without touching the user's ledger and without losing the genuine crash/timeout signal.

**Architecture:** One new constant and two filters in `apps/cli/src/commands/doctor-saver.ts`. The heartbeat ledger's 30-day `TTL_MS` retention in `packages/context-gate/src/saver-heartbeat.ts` is deliberately **not** changed — retention and liveness are different questions, and conflating them is the bug.

**Tech Stack:** TypeScript strict ESM, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-doctor-liveness-window-design.md`

**Worktree:** `.worktrees/doctor-liveness`, branch `fix/doctor-liveness-scope`.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `apps/cli/src/commands/doctor-saver.ts` | modify | add `LIVENESS_WINDOW_MS`; filter gap scan and failure scan; fix stale comment |
| `apps/cli/test/doctor-saver.test.ts` | modify | add regression + boundary + mixed-ledger cases |
| `.changeset/doctor-liveness-window.md` | create | release note |

---

### Task 1: Scope both liveness scans to a recency window

**Files:**
- Modify: `apps/cli/src/commands/doctor-saver.ts` (constant near `LIVENESS_GAP_GRACE_MS` line ~29; gap scan ~line 241; failure scan ~line 226)
- Test: `apps/cli/test/doctor-saver.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the existing liveness `describe` block, matching the file's established
helpers (`fakeBinary`, `writeHookSettings`, `runSaverChecks`, `find`, `iso`,
`NOW`, `recordInvocationHeartbeat`, `recordCompletionHeartbeat`,
`recordFailureHeartbeat`):

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

it("PASSes liveness when the only gap is a workspace older than the window", () => {
  const bin = fakeBinary();
  const settingsPath = writeHookSettings(`${bin} hooks saver`);
  // A dead worktree from six days ago: invoked, never completed. This is the
  // reported bug — it used to fail the check forever.
  const stale = NOW - 6 * DAY_MS;
  recordInvocationHeartbeat(storeRoot, "wk-dead", iso(stale), stale);
  const checks = runSaverChecks({
    settingsPath,
    storeRoot,
    spawn: advancingSpawn,
    now: () => NOW,
  });
  expect(find(checks, "saver-liveness")?.pass).toBe(true);
});

it("still FAILs liveness for a gap inside the window", () => {
  const bin = fakeBinary();
  const settingsPath = writeHookSettings(`${bin} hooks saver`);
  const recent = NOW - 60_000;
  recordInvocationHeartbeat(storeRoot, "wk-live", iso(recent), recent);
  const checks = runSaverChecks({
    settingsPath,
    storeRoot,
    spawn: () => ({ status: 0 }),
    now: () => NOW,
  });
  const liveness = find(checks, "saver-liveness");
  expect(liveness?.pass).toBe(false);
  expect(liveness?.value).toContain("wk-live");
});

it("ignores a stale gap even when a healthy recent workspace exists", () => {
  const bin = fakeBinary();
  const settingsPath = writeHookSettings(`${bin} hooks saver`);
  const stale = NOW - 6 * DAY_MS;
  recordInvocationHeartbeat(storeRoot, "wk-dead", iso(stale), stale);
  recordInvocationHeartbeat(storeRoot, "wk-ok", iso(NOW - 1000), NOW - 1000);
  recordCompletionHeartbeat(storeRoot, "wk-ok", iso(NOW - 900), NOW - 900);
  const checks = runSaverChecks({
    settingsPath,
    storeRoot,
    spawn: advancingSpawn,
    now: () => NOW,
  });
  expect(find(checks, "saver-liveness")?.pass).toBe(true);
});

it("PASSes liveness for a failure older than the window", () => {
  const bin = fakeBinary();
  const settingsPath = writeHookSettings(`${bin} hooks saver`);
  const stale = NOW - 6 * DAY_MS;
  recordInvocationHeartbeat(storeRoot, "wk-old", iso(stale), stale);
  recordFailureHeartbeat(storeRoot, "wk-old", "record", iso(stale), stale);
  const checks = runSaverChecks({
    settingsPath,
    storeRoot,
    spawn: advancingSpawn,
    now: () => NOW,
  });
  expect(find(checks, "saver-liveness")?.pass).toBe(true);
});

it("treats an invocation exactly at the window edge as inside it", () => {
  const bin = fakeBinary();
  const settingsPath = writeHookSettings(`${bin} hooks saver`);
  const edge = NOW - DAY_MS;
  recordInvocationHeartbeat(storeRoot, "wk-edge", iso(edge), edge);
  const checks = runSaverChecks({
    settingsPath,
    storeRoot,
    spawn: () => ({ status: 0 }),
    now: () => NOW,
  });
  expect(find(checks, "saver-liveness")?.pass).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @megasaver/cli exec vitest run test/doctor-saver.test.ts`
Expected: the three "PASSes / ignores" cases FAIL (they currently return
`pass: false`, because the unbounded scan finds the stale workspace). The two
"still FAILs" / boundary cases should already pass — confirm that, so you know
they are guarding preserved behaviour rather than silently vacuous.

- [ ] **Step 3: Add the constant**

In `apps/cli/src/commands/doctor-saver.ts`, beside `LIVENESS_GAP_GRACE_MS`:

```ts
// Liveness asks a "right now" question, so it needs its own recency bound.
// The ledger's retention TTL (30d) is NOT that bound: a workspace that died
// mid-invocation stays in the view for a month, and an unbounded scan then
// reports it as a live crash signal forever. Anything invoked longer ago than
// this is historical wreckage, not a signal to act on.
const LIVENESS_WINDOW_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 4: Filter the gap scan**

Replace the stale comment and add the recency predicate:

```ts
    // Per-workspace invocation-vs-completion gap: a RECENT invocation with no
    // (or a far-older) completion is a crash/timeout signal — the hook fired
    // but never finished. Scoped to LIVENESS_WINDOW_MS because the view's
    // retention window is 30 days, which says nothing about recency.
    const livenessFloor = now() - LIVENESS_WINDOW_MS;
    const gap = Object.entries(view.workspaces)
      .map(([wk, invIso]) => {
        const comp = view.completions?.[wk];
        return { wk, inv: Date.parse(invIso), comp: comp !== undefined ? Date.parse(comp) : null };
      })
      .filter(({ inv }) => inv >= livenessFloor)
      .find(({ inv, comp }) => comp === null || inv - comp > LIVENESS_GAP_GRACE_MS);
```

Note `now()` is already the injected clock used earlier in this function — reuse
it, do not call `Date.now()` directly.

- [ ] **Step 5: Filter the failure scan**

The `failing` filter above it has the same defect. Add the same floor:

```ts
    const failing = Object.entries(failures).filter(([wk, f]) => {
      const completion = view.completions?.[wk];
      return (
        f.count > 0 &&
        Date.parse(f.lastAt) >= livenessFloor &&
        (completion === undefined || Date.parse(completion) <= Date.parse(f.lastAt))
      );
    });
```

`livenessFloor` must be declared before this block — hoist its declaration above
the `failing` filter rather than leaving it next to the gap scan.

Leave `totalFailures` computed over ALL failures: the "since recovered" warning
line is a history statement, and narrowing it would hide real past failures.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @megasaver/cli exec vitest run test/doctor-saver.test.ts`
Expected: all pass, including every pre-existing case (they stamp `NOW - 1000`,
comfortably inside the window).

Then `pnpm --filter @megasaver/cli typecheck` clean and
`pnpm biome check --write apps/cli/src/commands/doctor-saver.ts apps/cli/test/doctor-saver.test.ts`.

- [ ] **Step 7: Verify against the real ledger**

Build and run doctor against the user's actual store, which currently has 37
gap-having workspaces:

```bash
pnpm --filter @megasaver/cli build
node apps/cli/dist/cli.js doctor
```

Expected: `saver-liveness` PASSes and the summary reads `10 PASS / 0 FAIL`.
**Do not modify the ledger to achieve this** — the point is that the check now
ignores stale entries, not that the entries were cleaned up. Confirm the ledger
is byte-identical before and after (hash it).

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/commands/doctor-saver.ts apps/cli/test/doctor-saver.test.ts
git commit -m "fix(cli): scope saver liveness to a recency window"
```

---

### Task 2: Changeset and full verify

- [ ] **Step 1: Write `.changeset/doctor-liveness-window.md`**

```markdown
---
"@megasaver/cli": patch
---

Fix `mega doctor`'s `saver-liveness` check failing permanently. It scanned every
workspace retained in the heartbeat ledger (30 days) and flagged any with an
invocation and no completion — so a single killed hook in a temp dir, test
fixture, or deleted worktree failed the check until it aged out, with no way to
clear it. Liveness now uses its own 24h recency window, separate from ledger
retention. Genuine current crash/timeout signals still fail; historical
wreckage is ignored.
```

- [ ] **Step 2: Run full verify**

```bash
pnpm build && pnpm --filter @megasaver/gui build && pnpm verify
```

`bundle-smoke` is the case that motivated this — it shells out to `mega doctor`
and asserts exit 0, so it should now pass. If the bundle is missing its GUI
assets, run `node apps/cli/scripts/copy-gui-dist.mjs` from `apps/cli` (the copy
step lives in `prepack`, not `bundle` — a known infra gap).

- [ ] **Step 3: Commit**

```bash
git add .changeset/doctor-liveness-window.md
git commit -m "chore: changeset for doctor liveness window"
```

---

## Self-review notes

- **Spec coverage:** window constant (T1 S3), gap scan (S4), failure scan (S5),
  stale comment corrected (S4), retention untouched (no edit to
  `saver-heartbeat.ts`), all six spec test cases present in T1 S1, real-ledger
  verification (S7), DoD in T2.
- **Deliberately unchanged:** `TTL_MS`, `MAX_WORKSPACES`, `totalFailures`, and
  the "never fired" branch. Each is a different question from liveness recency.
- **Type consistency:** `livenessFloor` is a `number` (epoch ms) compared
  against `Date.parse` results throughout; `now()` is the already-injected clock
  used elsewhere in the function.
