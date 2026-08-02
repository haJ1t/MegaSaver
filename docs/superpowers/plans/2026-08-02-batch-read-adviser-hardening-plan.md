# Batch-Read Adviser Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Phase 2 batch-read advice concurrent-safe, private, bounded, retained, and proven through the published CLI artifact.

**Architecture:** Replace the unlocked JSON snapshot with one POSIX-only, per-session exclusive-create lock transaction. A secure store module owns filesystem preparation, bounded descriptor reads, durable replacement, and cleanup; the runner owns bounded ingress and canonical tool classification; GC owns expiry; bundle/pack smoke owns distribution evidence.

**Tech Stack:** TypeScript strict ESM, Node 22 `fs` descriptors, Zod, Vitest, tsup, pnpm pack, GitHub Actions.

## Global Constraints

- Advice remains optional and permission-neutral: no `permissionDecision`, no `updatedInput`, and no mutation of the current native tool call.
- POSIX only: Windows installs no cache-advice hook and runtime returns empty/no-state.
- Preserve 60,000 ms inclusive window, 64 offered keys, 128 recent calls, safe session segment, and fail-open empty output.
- Bound stdin at 65,536 bytes; cwd/path/canonical directory at 4,096 UTF-8 bytes; state read/write at 32,768 bytes.
- Persist only version-2 SHA-256 directory keys, tool, and timestamp; never raw paths, command text, file contents, prompts, patterns, or request bodies.
- Apply at-most-once state per canonical workspace plus safe session; canonical realpaths serve filesystem operations and only NFC-normalized copies enter directory-key hashing.
- Contention/crash/unsafe state may suppress advice but must never duplicate it, block the hook, escape the owner-only store, or reset legacy state.
- Retain regular state/lock and strictly transaction-shaped temporary files for 30 days; never prune Task Kickoff claims/packs or arbitrary temporary names.
- The public bundle and packed npm bin must execute real cache-advice smoke coverage.

---

### Task 1: Apply the final hardening fix wave

**Files:**
- Create: `apps/cli/src/hooks/cache-advice-store.ts`
- Create: `apps/cli/test/hooks/cache-advice-store.test.ts`
- Modify: `apps/cli/src/hooks/cache-advice-state.ts`
- Modify: `apps/cli/src/hooks/cache-advice-run.ts`
- Modify: `apps/cli/src/hooks/task-kickoff-store-fs.ts`
- Modify: `apps/cli/src/hooks/gc.ts`
- Modify: `apps/cli/src/commands/hooks/install.ts`
- Modify: `apps/cli/src/commands/hooks/status.ts`
- Modify: `packages/connectors/claude-code/src/hook-settings.ts`
- Modify: `apps/cli/test/hooks/cache-advice-state.test.ts`
- Modify: `apps/cli/test/hooks/cache-advice-run.test.ts`
- Modify: `apps/cli/test/hooks/gc.test.ts`
- Modify: `apps/cli/test/hooks/install.test.ts`
- Modify: `apps/cli/test/bundle-smoke.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `wiki/entities/cli.md`, `wiki/log.md`, `.changeset/batch-read-adviser.md`

**Interfaces:**

```ts
export type CacheAdviceCall = { tool: "Read" | "Grep" | "Glob"; directoryKey: string; at: number };
export type CacheAdviceState = { version: 2; offeredDirectoryKeys: string[]; recent: CacheAdviceCall[] };
export async function transactCacheAdvice(input: {
  storeRoot: string; workspaceKey: string; sessionId: string; call: CacheAdviceCall; platform?: NodeJS.Platform;
}): Promise<"advise" | "recorded" | "suppressed">;
export const MAX_CACHE_ADVICE_HOOK_STDIN_BYTES = 65_536;
```

- [ ] **Step 1: Write failing security and concurrency regressions**

Add real subprocess tests that seed one version-2 state then run eight parallel
same-directory calls and expect exactly one advice. Add contention/crash-lock
tests, directory/state symlink tests, FIFO with a one-second watchdog,
directory/device/hard-link rejection, byte-boundary stdin/path/state tests,
legacy state suppression, canonical Read/Grep/Glob file-parent and symlink
alias tests, Windows no-state/no-install tests, and status visibility tests.
Add GC tests for 29-day preservation, `>30`-day regular state/lock/strict-temp
deletion, nonregular and arbitrary-temp skip, and unchanged Task Kickoff state. Add a freshly built
`dist-bundle/mega.mjs` two-call smoke and packed-bin two-call smoke.

- [ ] **Step 2: Run the regressions before implementation**

Run, with Node 22 first on `PATH`:

```bash
pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts test/hooks/cache-advice-store.test.ts test/hooks/cache-advice-run.test.ts test/hooks/gc.test.ts test/hooks/install.test.ts test/bundle-smoke.test.ts
```

Expected: FAIL because the current unlocked raw-path state does not serialize,
does not reject special nodes, has no v2/bounds/GC behavior, and bundle smoke
does not exercise cache advice.

- [ ] **Step 3: Implement one secure transaction boundary**

Use the Task Kickoff component-by-component owner-only root preflight to
prepare `cache-advice`. On POSIX create an owner-only `wx` session lock before
reading state; contention returns `suppressed` without waiting. Use no-follow,
nonblocking descriptor opens and `fstat` regular/single-link checks for state;
write bounded v2 JSON to a unique owner-only temporary descriptor, complete the
write, fsync it, rename, fsync the parent, then unlink the lock. Do not use a
PID/mtime lock or `fs-ext`: the public bundle must work without a native sidecar.
Return `suppressed` for Windows, unsafe/legacy/oversized state, or any I/O
failure. Canonicalize existing filesystem targets, map files to parents, retain
that exact realpath for filesystem work, NFC-normalize only a copied string,
and hash it with a fixed domain prefix before state use. Keep advice state
independent for distinct canonical workspaces sharing one safe session.
Run cache-advice GC independently on its daily throttle. Register status and
installation behavior so Windows omits/removes advice while preserving all
foreign, log, and guard hooks.

- [ ] **Step 4: Verify red tests turn green and exercise distribution**

```bash
pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-state.test.ts test/hooks/cache-advice-store.test.ts test/hooks/cache-advice-run.test.ts test/hooks/gc.test.ts test/hooks/install.test.ts
pnpm --filter @megasaver/cli bundle
pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t 'cache advice'
pnpm --filter @megasaver/cli pack
pnpm --filter @megasaver/cli typecheck
pnpm --filter @megasaver/connector-claude-code typecheck
pnpm exec biome check apps/cli/src/hooks/cache-advice-state.ts apps/cli/src/hooks/cache-advice-store.ts apps/cli/src/hooks/cache-advice-run.ts apps/cli/src/hooks/gc.ts apps/cli/src/commands/hooks/install.ts apps/cli/src/commands/hooks/status.ts packages/connectors/claude-code/src/hook-settings.ts
```

Expected: all pass under Node 22; the fresh bundle and packed bin execute the
two-call contract; no command emits permission decision or mutates input.

- [ ] **Step 5: Document and commit the fix wave**

Update the changeset/wiki with POSIX-only safe false-negative behavior, v2
hashed state, retention, bundle evidence, and the still-unmeasured behavioral
benchmark. Commit only the hardening code/tests/CI/docs in logical commits.
