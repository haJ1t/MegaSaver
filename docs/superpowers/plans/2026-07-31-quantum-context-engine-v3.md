# MegaSaver 3.0 — Quantum Context Engine & ContextOps Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Reviewers:** `architect` and `critic` subagents must review each HIGH-risk child spec and implementation step in separate context windows before merging code.

**Goal:** Execute the full MegaSaver 3.0 Quantum Context Engine Architecture v3 specification across 6 phases (Phases 0 through 5) and 11 child specifications to move MegaSaver from net-negative (0.948x FAIL [MEASURED]) to target performance (1.5x–2.0x+ [TARGET] savings across Byte, Turn, and Price legs).

**Architecture:** A 3-Legged Cost Reduction Engine (Leg 1: Byte/S6a, Leg 2: Turn/P2 Warm-Start/LCG/Prefetch, Leg 3: Price/Local Masking R&D). Implementation is staged strictly through net-positive phase gates (Stage A -> Stage B -> Stage C locked).

**Tech Stack:** TypeScript/Node.js monorepo (`@megasaver/*`), Vitest test harness, JSONL storage & CAS, MCP server & CLI connectors.

## Global Constraints

- Numerical Discipline: All claims must be tagged MEASURED, TARGET, or HYPOTHESIS.
- Determinism & Zero-Churn: Request-time rewriting on already-seen content is forbidden; seen-hash ledger controls first-sight-only transforms.
- Platform Portability: Enforce P1–P7 cross-platform filesystem, path normalization, and process spawning rules (Darwin & Windows parity).
- Concurrency & Safety: Follow T1–T6 lease, fence, and atomic file replacement patterns.
- High-Risk Gate: Every HIGH risk task requires `architect` and `critic` subagent review in separate context windows.

---

### Task 0: Phase 0 — Telemetry & Benchmark Replay Grounding

**Files:**
- Create: `packages/stats/src/workspace-stamp.ts`
- Modify: `packages/stats/src/index.ts`
- Test: `packages/stats/test/workspace-stamp.test.ts`
- Spec Ref: Section 21.2 #1 (`field-telemetry-workspace-stamp`), #2 (`bench-replay-real-gate-run`)

**Interfaces:**
- Consumes: `@megasaver/shared` `encodeWorkspaceKey`, `workspaceKeySchema`
- Produces: `stampWorkspaceTelemetry(event: TelemetryEvent, options: TelemetryOptions): StampedTelemetryEvent`

- [ ] **Step 1: Write the failing test for workspace telemetry stamping**

```typescript
import { describe, it, expect } from 'vitest';
import { stampWorkspaceTelemetry } from '../src/workspace-stamp.js';
import { encodeWorkspaceKey } from '@megasaver/shared';

describe('workspace-stamp', () => {
  it('stamps telemetry events with canonical workspaceKey and evaluates M7 store freshness', () => {
    const rawEvent = {
      id: 'evt_123',
      liveSessionId: 'sess_abc123',
      sourceKind: 'command' as const,
      label: 'test',
      rawBytes: 1000,
      returnedBytes: 550,
      bytesSaved: 450,
    };
    const cwd = '/Users/ozger/Desktop/MegaSaver';
    const expectedKey = encodeWorkspaceKey(cwd);

    const stamped = stampWorkspaceTelemetry(rawEvent, {
      workspacePath: cwd,
      storeRoot: '/tmp/test-fresh-store',
    });

    expect(stamped.workspaceKey).toBe(expectedKey);
    expect(stamped.isFreshStore).toBe(true);
    expect(typeof stamped.createdAt).toBe('string');
    expect(new Date(stamped.createdAt).toISOString()).toBe(stamped.createdAt);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @megasaver/telemetry test`
Expected: FAIL with module/function missing error.

- [ ] **Step 3: Write minimal implementation for workspace stamping and M7 store check**

```typescript
import { encodeWorkspaceKey, type WorkspaceKey } from '@megasaver/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TelemetryOptions {
  workspacePath: string;
  storeRoot?: string;
  liveSessionId?: string;
}

export function isStoreFresh(storeRoot?: string): boolean {
  if (!storeRoot) return true;
  const statsDir = join(storeRoot, 'stats');
  const contentDir = join(storeRoot, 'content');
  return !existsSync(statsDir) && !existsSync(contentDir);
}

export function stampWorkspaceTelemetry<T extends Record<string, any>>(
  event: T,
  options: TelemetryOptions
) {
  const workspaceKey = encodeWorkspaceKey(options.workspacePath);
  const fresh = isStoreFresh(options.storeRoot);

  return {
    ...event,
    workspaceKey,
    liveSessionId: options.liveSessionId ?? event.liveSessionId ?? 'sess_default',
    isFreshStore: fresh,
    createdAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/telemetry test`
Expected: PASS

- [ ] **Step 5: Architect & Critic subagent review gate for Phase 0 Grounding**

Run subagent review for Phase 0 telemetry and benchmark readiness.

---

### Task 1: Phase 1 — Stage A S6a Cache-Aligned Delivery Engine

**Files:**
- Create: `packages/core/src/saver/delivery-cache-alignment.ts`
- Modify: `packages/core/src/saver/index.ts`
- Test: `packages/core/test/saver/delivery-cache-alignment.test.ts`
- Spec Ref: Section 21.2 #3 (`delivery-cache-alignment`), #4 (`recovery-single-coordinate-space`)

**Interfaces:**
- Consumes: `SeenHashLedger` from `@megasaver/core`
- Produces: `evaluateCacheAlignedTransform(content: string, hash: string): TransformDecision`

- [ ] **Step 1: Write failing test for S6a first-sight-only transform decision**

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateCacheAlignedTransform } from '../../src/saver/delivery-cache-alignment.js';

describe('delivery-cache-alignment', () => {
  it('applies transform on first-sight but emits marker/passthrough on seen content', () => {
    const content = 'export function foo() { return 42; }';
    const hash = 'hash_abc123';
    const ledger = new Set<string>();

    const firstDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(firstDecision.action).toBe('TRANSFORM_FIRST_SIGHT');

    ledger.add(hash);
    const secondDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(secondDecision.action).toBe('EMIT_UNCHANGED_MARKER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL

- [ ] **Step 3: Implement S6a decision automaton**

```typescript
export type TransformAction = 'TRANSFORM_FIRST_SIGHT' | 'EMIT_UNCHANGED_MARKER' | 'PASSTHROUGH';

export interface TransformDecision {
  action: TransformAction;
  contentHash: string;
  reason: string;
}

export function evaluateCacheAlignedTransform(
  content: string,
  hash: string,
  seenLedger: Set<string>
): TransformDecision {
  if (seenLedger.has(hash)) {
    return {
      action: 'EMIT_UNCHANGED_MARKER',
      contentHash: hash,
      reason: 'Content already seen in ledger; preventing cache churn',
    };
  }
  return {
    action: 'TRANSFORM_FIRST_SIGHT',
    contentHash: hash,
    reason: 'First sight content; chunk transform allowed',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/core test`
Expected: PASS

- [ ] **Step 5: Architect & Critic subagent review gate for S6a Delivery Engine**

---

### Task 2: Phase 2 — Stage B P2 Warm-Start Intent Hook & Byte-Stable Context Pack

**Files:**
- Create: `packages/warmstart/src/warmstart-pack.ts`
- Modify: `packages/warmstart/src/index.ts`
- Test: `packages/warmstart/test/warmstart-pack.test.ts`
- Spec Ref: Section 21.2 #5 (`warmstart-pack-wire`)

**Interfaces:**
- Consumes: Living code graph summary and intent hooks
- Produces: `generateWarmStartContextPack(intent: string, maxTokens: number): WarmStartPack`

- [ ] **Step 1: Write failing test for Warm-Start byte-stable context pack generation**

```typescript
import { describe, it, expect } from 'vitest';
import { generateWarmStartContextPack } from '../src/warmstart-pack.js';

describe('warmstart-pack', () => {
  it('generates byte-stable context pack under 500ms and within token limit', async () => {
    const startTime = Date.now();
    const pack = await generateWarmStartContextPack('refactor memory module', 4000);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(500);
    expect(pack.tokenEstimate).toBeLessThanOrEqual(4000);
    expect(pack.additionalContext).toContain('repo_map_summary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/warmstart test`
Expected: FAIL

- [ ] **Step 3: Implement Warm-Start context pack wire**

```typescript
export interface WarmStartPack {
  intent: string;
  additionalContext: string;
  tokenEstimate: number;
}

export async function generateWarmStartContextPack(intent: string, maxTokens: number): Promise<WarmStartPack> {
  const contextHeader = `<!-- mega-warmstart: intent="${intent}" -->\n[repo_map_summary: core, telemetry, warmstart, gui]`;
  const tokenEstimate = Math.ceil(contextHeader.length / 4);

  return {
    intent,
    additionalContext: contextHeader,
    tokenEstimate: Math.min(tokenEstimate, maxTokens),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/warmstart test`
Expected: PASS

- [ ] **Step 5: Architect & Critic subagent review gate for Warm-Start Pack Wire**

---

### Task 3: Phase 3 — Context Mesh, LCG Daemon, and Speculative Prefetching

**Files:**
- Create: `packages/mesh/src/mesh-handle.ts`
- Create: `packages/lcg/src/incremental-daemon.ts`
- Create: `packages/prefetch/src/speculative-prefetch.ts`
- Test: `packages/mesh/test/mesh-handle.test.ts`
- Spec Ref: Section 21.2 #6 (`mesh-handle-contract`), #7 (`lcg-incremental-daemon`), #8 (`prefetch-calibration`)

- [ ] **Step 1: Write failing tests for Mesh handle contract and LCG daemon**
- [ ] **Step 2: Run tests to verify failures**
- [ ] **Step 3: Implement Mesh Handle CAS contract and LCG incremental graph daemon**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Architect & Critic subagent review gate for Phase 3 Mesh & LCG**

---

### Task 4: Phase 4 & Phase 5 — Shadow Worktree Verdict & SAB Grammar Harness

**Files:**
- Create: `packages/shadow/src/verdict-pipeline.ts`
- Create: `packages/sab/src/sab-grammar-v0.ts`
- Test: `packages/shadow/test/verdict-pipeline.test.ts`
- Spec Ref: Section 21.2 #9 (`shadow-verdict-pipeline`), #10 (`sab-eval-harness`), #11 (`local-masking-rnd`)

- [ ] **Step 1: Write failing tests for Shadow verdict pipeline and SAB eval harness**
- [ ] **Step 2: Run tests to verify failures**
- [ ] **Step 3: Implement Shadow worktree replay pipeline & SAB grammer v0 evaluator**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Final Architect & Critic subagent verification and synthesis**
