# LM2 Darwin Anchor Alias Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Allow LM2's secure directory anchor to support verified macOS system aliases without allowing arbitrary symlink traversal.

**Architecture:** Normalize only a root-owned Darwin `/tmp` or `/var` system alias to its fixed `/private/...` target before the existing descriptor-chain algorithm. Keep the existing no-follow open and identity checks unchanged for every other segment.

**Tech Stack:** TypeScript strict/ESM, Node filesystem descriptors, Vitest.

## Global Constraints

- HIGH risk: preserve trusted-root, static-symlink, no-follow, identity, and directory-fsync guarantees.
- Do not canonicalize arbitrary configured paths or relax `O_NOFOLLOW`.
- Do not change Core, CLI/MCP, connector, model, scoring, or official-evidence behavior.
- Keep Windows behavior byte-compatible.

---

### Task 1: Prove the real Darwin alias failure at the transport boundary

**Files:**

- Modify: `packages/long-memory/test/lm2-benchmark-transport.test.ts`

**Interfaces:** Consumes `dispatchLm2BenchmarkLine` and `benchmarkFixture`; proves the existing JSON transport contract rather than an implementation detail.

- [ ] **Step 1: Write the failing Darwin regression test**

```ts
it.skipIf(process.platform !== "darwin")(
  "indexes a cache rooted through the protected /tmp system alias",
  async () => {
    const fixture = benchmarkFixture();
    const cacheParent = mkdtempSync("/tmp/megasaver-lm2-anchor-");
    chmodSync(cacheParent, 0o700);
    const opened = await request({
      id: "open", op: "open",
      config: { ...fixture.config, cacheParent },
      instanceToken: fixture.instanceToken,
    });
    const identity = opened.result as Record<string, string>;
    const inserted = await request({
      id: "insert", op: "insert",
      config: { ...fixture.config, cacheParent },
      instanceToken: fixture.instanceToken,
      sentinelToken: identity.sentinelToken,
      expectedChainDigest: identity.chainDigest,
      trajectory: fixture.trajectories[0],
    });
    expect(inserted).toMatchObject({ ok: true, result: { indexingComplete: true } });
  },
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-benchmark-transport.test.ts`

Expected on Darwin: the new test fails with transport `operation_failed`; the
existing tests pass. On non-Darwin, it is skipped.

### Task 2: Normalize only protected Darwin aliases in the secure anchor

**Files:**

- Modify: `packages/long-memory/src/lm2-secure-fs.ts`
- Create: `packages/long-memory/src/lm2-directory-anchor-path.ts`
- Modify: `packages/long-memory/test/lm2-secure-fs.test.ts` (create if absent)

**Interfaces:** `openDirectoryAnchor(path, allowMissing)` continues to return an anchored physical directory or existing `Lm2Error` failures.

- [ ] **Step 1: Write a failing arbitrary-symlink guard test**

```ts
it("does not canonicalize an arbitrary directory symlink", () => {
  const root = createRoot();
  const target = join(root, "target");
  const alias = join(root, "alias");
  mkdirSync(target, { mode: 0o700 });
  symlinkSync(target, alias);
  expect(() => openDirectoryAnchor(join(alias, "child"), true)).toThrowObject({
    code: "store_corrupt",
  });
});
```

- [ ] **Step 2: Implement the minimal protected-alias resolver**

```ts
function canonicalDirectoryAnchorPath(path: string): string {
  const absolute = resolve(path);
  if (process.platform !== "darwin") return absolute;
  const [first, ...rest] = relative(parse(absolute).root, absolute).split(sep);
  const alias = first === "tmp" ? "/tmp" : first === "var" ? "/var" : null;
  if (alias === null || !isRootOwnedSystemAlias(alias)) return absolute;
  return join(realpathSync(alias), ...rest);
}
```

Implement the resolver in `lm2-directory-anchor-path.ts` with `lstatSync`, the
root parent mode/owner checks, and exact `realpathSync` target matching.
`openDirectoryAnchor` uses this helper before forming its descriptor chain. It
must never call `realpathSync` for another alias; splitting it keeps each
production source at or below 300 lines.

- [ ] **Step 3: Run focused tests and verify GREEN**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-benchmark-transport.test.ts lm2-secure-fs.test.ts lm2-benchmark-safe-path.test.ts source-size.test.ts`

Expected: Darwin alias insert passes, arbitrary aliases remain rejected, and
all existing focused tests pass.

### Task 3: Verify the actual official-data transport route and release gates

**Files:**

- Modify: `wiki/syntheses/longmemeval-v2-status.md`
- Modify: `wiki/log.md`

- [ ] **Step 1: Re-run a manifest-admitted LongMemEval-V2 first insert**

Run the installed official backend's `open` plus first `insert` with the
pinned web manifest and its literal `/tmp` cache parent.

Expected: first insert succeeds, creates the verified vector sidecar, and
preserves `indexingComplete: true`.

- [ ] **Step 2: Run package and repository evidence**

Run: `pnpm --filter @megasaver/long-memory test && pnpm verify`

Expected: green exit status.

- [ ] **Step 3: Update durable status and commit atomically**

Run: `git add packages/long-memory/src/lm2-secure-fs.ts packages/long-memory/src/lm2-directory-anchor-path.ts packages/long-memory/test/lm2-benchmark-transport.test.ts packages/long-memory/test/lm2-secure-fs.test.ts docs/superpowers/specs/2026-07-27-lm2-darwin-anchor-design.md docs/superpowers/plans/2026-07-27-lm2-darwin-anchor-plan.md wiki/syntheses/longmemeval-v2-status.md wiki/log.md && git commit -m "fix(memory): support Darwin system aliases"`

Expected: one focused high-risk bug-fix commit, ready for an independent reviewer and PR gates.
