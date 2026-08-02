# Cache-Advice Fair GC and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace starvable flat-directory cache-advice cleanup with a bounded,
fair, crash-recoverable v3 capsule FIFO and migrate existing state outside the
PreToolUse response path.

**Architecture:** A domain-separated opaque record ID maps each
workspace/session pair to a private capsule. A fixed-frame journal and durable
cursor give GC a finite eight-record batch without readdir; a frozen tail keeps
continuous writers from starving older state. A separate internal maintainer
exhaustively and securely converts old flat state before v3 advice starts.

**Tech Stack:** TypeScript strict ESM, Node 22 descriptor APIs and fsync, Zod,
Vitest subprocesses, tsup, pnpm pack, GitHub Actions.

## Global Constraints

- HIGH risk: TDD, a fresh implementer and reviewer per task, then independent
  code-reviewer and critic before close.
- POSIX only; Windows has no cache-advice hook, queue, migration worker, state,
  or output.
- No wait on contention; no permissionDecision, updatedInput, current-tool
  mutation, raw path/session/command/pattern/content/prompt/secret/URL/error.
- Batch-read JSON remains exact v2, with 64 keys, 128 calls, and 32,768 bytes.
  Storage topology is v3.
- Enforce 65,536-byte stdin, 4,096-byte filesystem inputs, secure private
  descriptor handling, durable write/fsync/rename/parent-fsync ordering.
- GC processes at most eight frames per hook and does no unbounded directory
  scan, queue read, or queue rewrite on that path. The opaque work log is
  capped at 1,048,576 bytes; a full queue suppresses new enrollment and asks
  off-hook maintenance to compact it.
- Keep 30-day retention with no early deletion; only assert liveness when later
  successful hooks reach a private writable local store.
- Do not change packages/policy, Task Kickoff paths, or make a savings claim.

---

### Task 1: Queue protocol and crash ordering

**Files:**
- Create: apps/cli/src/hooks/cache-advice-queue.ts
- Create: apps/cli/test/hooks/cache-advice-queue.test.ts
- Modify: apps/cli/src/hooks/cache-advice-store.ts
- Modify: apps/cli/test/hooks/cache-advice-store.test.ts

**Interfaces:**

    export type CacheAdviceRecordId = string;
    export type CacheAdviceQueueControl = {
      version: 1;
      headOffset: number;
      sweepStopOffset: number | null;
      inflightOffset: number | null;
      lastCompletedAt: number | null;
      clockCutAt: number | null;
    };
    export async function enqueueCacheAdviceRecord(input: {
      root: string;
      recordId: CacheAdviceRecordId;
    }): Promise<"enqueued" | "suppressed">;

- [ ] **Step 1: Write failing tests**

Test domain-separated IDs, fixed opaque frames, queue contention, unsafe
queue/control nodes, an orphan frame before capsule creation, and simulated
crash cuts after append, control, claim, requeue, delete, and cursor advance.
Every cut must leave a reachable work frame or no live advice state.

- [ ] **Step 2: Demonstrate RED**

Run:

    NODE22_DIR=/Users/ozger/Library/pnpm/store/v11/links/@/node/22.23.2/74ef9ef8bf5182d0f819a3bbbea51f1eae8fe34883a67ed71a8aedb03e2c6b0a/node_modules/node/bin
    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-queue.test.ts test/hooks/cache-advice-store.test.ts

Expected: FAIL because the flat store has no queue/cursor protocol.

- [ ] **Step 3: Implement minimal secure queue**

Implement private fixed-frame work.log, bounded control/transition records, and
no-wait queue lock. Enforce the 1,048,576-byte cap. Fsync an opaque frame before a new capsule is reachable,
record inflight before head claim, requeue before cursor advance, and replay a
bounded transition at startup. Corruption and contention return suppressed.

- [ ] **Step 4: Demonstrate GREEN**

Run the Step 2 command. Expected: PASS and all serialized queue data remains
opaque.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-queue.ts apps/cli/src/hooks/cache-advice-store.ts apps/cli/test/hooks/cache-advice-queue.test.ts apps/cli/test/hooks/cache-advice-store.test.ts
    git commit -m "fix(cli): queue cache advice cleanup"

### Task 2: Capsule transaction boundary

**Files:**
- Modify: apps/cli/src/hooks/cache-advice-store.ts
- Modify: apps/cli/src/hooks/cache-advice-state.ts
- Modify: apps/cli/src/hooks/cache-advice-run.ts
- Modify: apps/cli/test/hooks/cache-advice-store.test.ts
- Modify: apps/cli/test/hooks/cache-advice-state.test.ts
- Modify: apps/cli/test/hooks/cache-advice-run.test.ts

**Interfaces:**

    export function cacheAdviceRecordId(input: {
      workspaceKey: string;
      sessionStorageKey: string;
    }): CacheAdviceRecordId;
    export async function transactCacheAdvice(input: {
      storeRoot: string;
      workspaceKey: string;
      sessionId: string;
      call: CacheAdviceCall;
      platform?: NodeJS.Platform;
    }): Promise<"advise" | "recorded" | "suppressed">;

- [ ] **Step 1: Write failing tests**

Prove CaseA and casea cannot alias on a case-folding filesystem; a capsule
cannot appear before enrollment; v2 preserves 64/128/32,768-byte boundaries;
and descriptor hazards suppress. Fresh bundle calls must use only v3 on POSIX
and zero state on Windows.

- [ ] **Step 2: Demonstrate RED**

Run:

    NODE22_DIR=/Users/ozger/Library/pnpm/store/v11/links/@/node/22.23.2/74ef9ef8bf5182d0f819a3bbbea51f1eae8fe34883a67ed71a8aedb03e2c6b0a/node_modules/node/bin
    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-store.test.ts test/hooks/cache-advice-state.test.ts test/hooks/cache-advice-run.test.ts

Expected: FAIL until transactions use v3 record IDs and admission.

- [ ] **Step 3: Implement capsule transactions**

Derive record ID from canonical workspace key and hashed safe-session key,
enqueue before capsule creation, then use the existing no-wait state lock and
durable v2 state replacement inside that capsule. Remove flat-path reads from
the hook path. Unsafe preflight returns suppressed.

- [ ] **Step 4: Demonstrate GREEN**

Run the Step 2 command plus:

    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t "cache advice"

Expected: PASS; first call empty and second qualified call advice-only.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-store.ts apps/cli/src/hooks/cache-advice-state.ts apps/cli/src/hooks/cache-advice-run.ts apps/cli/test/hooks/cache-advice-store.test.ts apps/cli/test/hooks/cache-advice-state.test.ts apps/cli/test/hooks/cache-advice-run.test.ts
    git commit -m "fix(cli): isolate cache advice capsules"

### Task 3: Fair eight-frame GC

**Files:**
- Modify: apps/cli/src/hooks/gc.ts
- Modify: apps/cli/src/hooks/cache-advice-queue.ts
- Modify: apps/cli/test/hooks/gc.test.ts
- Modify: apps/cli/test/hooks/cache-advice-queue.test.ts

**Interfaces:**

    export const CACHE_ADVICE_GC_BATCH_SIZE = 8;
    export async function pruneCacheAdviceQueue(input: {
      storeRoot: string;
      now: number;
    }): Promise<"completed" | "incomplete" | "suppressed">;

- [ ] **Step 1: Write failing fairness tests**

Seed more than 64 fresh/unsafe early capsules and a late expired one. Drive
eight-frame batches and prove deletion in finite passes. Cover continuous
producers/frozen-tail completion, active-lock requeue, 29-day/exact-30-day/
older-than-30-day boundaries, missing/backwards/large-forward/future clocks,
and no daily marker before sentinel completion.

- [ ] **Step 2: Demonstrate RED**

Run:

    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/hooks/gc.test.ts test/hooks/cache-advice-queue.test.ts

Expected: FAIL because old opendir scanning has neither FIFO fairness nor a
durable cursor.

- [ ] **Step 3: Implement bounded sweep**

Freeze a tail under no-wait GC/queue coordination, claim at most eight frames,
check exact capsules securely, then delete or requeue before cursor advance.
Apply clock cuts before deletion and finish a daily marker only at the frozen
sentinel. Task Kickoff cleanup remains independent.

- [ ] **Step 4: Demonstrate GREEN**

Run the Step 2 command and a static guard proving cache-advice GC does not call
readdir or compact an unbounded queue from cache-advice-run.ts.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/gc.ts apps/cli/src/hooks/cache-advice-queue.ts apps/cli/test/hooks/gc.test.ts apps/cli/test/hooks/cache-advice-queue.test.ts
    git commit -m "fix(cli): make cache advice GC fair"

### Task 4: Off-hook legacy migration

**Files:**
- Create: apps/cli/src/hooks/cache-advice-maintenance.ts
- Modify: apps/cli/src/commands/hooks.ts
- Modify: apps/cli/src/commands/hooks/install.ts
- Modify: apps/cli/src/hooks/cache-advice-run.ts
- Modify: apps/cli/src/hooks/cache-advice-store.ts
- Create: apps/cli/test/hooks/cache-advice-maintenance.test.ts
- Modify: apps/cli/test/hooks/install.test.ts
- Modify: apps/cli/test/hooks/cache-advice-run.test.ts

**Interfaces:**

    export async function maintainCacheAdviceStore(input: {
      storeRoot: string;
      now: number;
    }): Promise<"complete" | "incomplete" | "suppressed">;
    export async function triggerCacheAdviceMaintenance(input: {
      storeRoot: string;
    }): Promise<void>;

- [ ] **Step 1: Write failing migration tests**

Seed a trusted flat tree with more than 64 v2 states, a v1 raw-path state,
malformed/oversized state, old locks/strict temps, arbitrary temps, and unsafe
nodes. Add restart cuts after move/tombstone/final-rescan. Assert v2 preservation,
opaque suppression, no raw legacy data in v3, empty hook output until complete,
and Windows no-worker/no-state.

- [ ] **Step 2: Demonstrate RED**

Run:

    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/hooks/cache-advice-maintenance.test.ts test/hooks/cache-advice-store.test.ts test/hooks/cache-advice-run.test.ts test/hooks/install.test.ts

Expected: FAIL because no maintainer or migration fence exists.

- [ ] **Step 3: Implement maintainer and fence**

Add a no-wait migration lock and exhaustive descriptor-safe walk outside
PreToolUse. Enroll valid v2 before moving it; write opaque expiry suppression
before deleting unparseable legacy state; write migration-complete only after a
final clean rescan. Installation runs maintenance outside the hook path; an
incomplete hook triggers one detached maintenance process and emits nothing.
Windows does neither.

- [ ] **Step 4: Demonstrate GREEN**

Run the Step 2 command. Expected: PASS across restart, unsafe-node, and
no-raw-data assertions.

- [ ] **Step 5: Commit**

    git add apps/cli/src/hooks/cache-advice-maintenance.ts apps/cli/src/commands/hooks.ts apps/cli/src/commands/hooks/install.ts apps/cli/src/hooks/cache-advice-run.ts apps/cli/src/hooks/cache-advice-store.ts apps/cli/test/hooks/cache-advice-maintenance.test.ts apps/cli/test/hooks/install.test.ts apps/cli/test/hooks/cache-advice-run.test.ts
    git commit -m "fix(cli): migrate cache advice state safely"

### Task 5: Artifact evidence and closure

**Files:**
- Modify: apps/cli/test/bundle-smoke.test.ts
- Modify: .github/workflows/ci.yml
- Modify: wiki/entities/cli.md
- Modify: wiki/sources/cache-write-reduction-design.md
- Modify: wiki/log.md
- Modify: wiki/agent-channel.md
- Modify: .changeset/batch-read-adviser.md

- [ ] **Step 1: Write failing public-artifact tests**

Add built-bundle and packed-bin cases for completed v3 migration, incomplete
empty output, Windows zero state/no worker, and a serialized store scan rejecting
raw legacy path/session/command/URL/secret fixtures. Add CI selectors for
POSIX artifacts and Windows defaults.

- [ ] **Step 2: Demonstrate RED**

Run:

    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli bundle
    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli exec vitest run test/bundle-smoke.test.ts -t "cache advice"
    PATH="$NODE22_DIR:$PATH" pnpm --filter @megasaver/cli pack

Expected: FAIL until public artifacts exercise v3/migration behavior.

- [ ] **Step 3: Add artifact coverage and evidence docs**

Update CI, bundle/packed tests, changeset, and wiki with opaque FIFO,
finite-liveness condition, off-hook migration, Windows absence, and the
unchanged no-claim A/B boundary.

- [ ] **Step 4: Verify**

Run:

    PATH="$NODE22_DIR:$PATH" pnpm verify

Expected: PASS. Then obtain fresh independent code-reviewer and critic reviews
over the complete hardening range.

- [ ] **Step 5: Commit**

    git add apps/cli/test/bundle-smoke.test.ts .github/workflows/ci.yml wiki/entities/cli.md wiki/sources/cache-write-reduction-design.md wiki/log.md wiki/agent-channel.md .changeset/batch-read-adviser.md
    git commit -m "docs(cli): record fair cache advice GC"
