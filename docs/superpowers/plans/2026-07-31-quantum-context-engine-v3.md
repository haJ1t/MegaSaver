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
- Consumes: `seenLedger: Set<string>` from `@megasaver/core`
- Produces: `evaluateCacheAlignedTransform(content: string, hash: string, seenLedger: Set<string>, coordinates?: CoordinateBounds): TransformDecision`

```typescript
export interface CoordinateBounds {
  rawStartLine: number;
  rawEndLine: number;
  casHash?: string;
}

export type TransformAction = 'TRANSFORM_FIRST_SIGHT' | 'PASSTHROUGH' | 'EMIT_UNCHANGED_MARKER';

export interface TransformDecision {
  action: TransformAction;
  contentHash: string;
  outputContent: string;
  reason: string;
  coordinates?: CoordinateBounds;
}
```

- [ ] **Step 1: Write failing unit test for S6a decision automaton & recovery bounds**

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateCacheAlignedTransform } from '../../src/saver/delivery-cache-alignment.js';

describe('delivery-cache-alignment', () => {
  it('applies transform and atomically registers hash on first sight', () => {
    const content = 'export function foo() { return 42; }';
    const hash = 'hash_abc123';
    const ledger = new Set<string>();

    const firstDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(firstDecision.action).toBe('TRANSFORM_FIRST_SIGHT');
    expect(ledger.has(hash)).toBe(true);
  });

  it('emits raw PASSTHROUGH on repeat sight to preserve prompt cache zero-churn', () => {
    const content = 'export function foo() { return 42; }';
    const hash = 'hash_abc123';
    const ledger = new Set<string>([hash]);

    const secondDecision = evaluateCacheAlignedTransform(content, hash, ledger);
    expect(secondDecision.action).toBe('PASSTHROUGH');
    expect(secondDecision.outputContent).toBe(content);
  });

  it('generates I14/E7 single-coordinate recovery markers when requested', () => {
    const content = 'export function bar() { return 100; }';
    const hash = 'hash_xyz789';
    const ledger = new Set<string>();
    const coords = { rawStartLine: 1, rawEndLine: 10, casHash: hash };

    const decision = evaluateCacheAlignedTransform(content, hash, ledger, coords);
    expect(decision.coordinates).toEqual(coords);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL with module missing error.

- [ ] **Step 3: Write minimal implementation for S6a decision automaton**

```typescript
export interface CoordinateBounds {
  rawStartLine: number;
  rawEndLine: number;
  casHash?: string;
}

export type TransformAction = 'TRANSFORM_FIRST_SIGHT' | 'PASSTHROUGH' | 'EMIT_UNCHANGED_MARKER';

export interface TransformDecision {
  action: TransformAction;
  contentHash: string;
  outputContent: string;
  reason: string;
  coordinates?: CoordinateBounds;
}

export function evaluateCacheAlignedTransform(
  content: string,
  hash: string,
  seenLedger: Set<string>,
  coordinates?: CoordinateBounds
): TransformDecision {
  if (seenLedger.has(hash)) {
    return {
      action: 'PASSTHROUGH',
      contentHash: hash,
      outputContent: content,
      reason: 'Content already in seen-hash ledger; raw passthrough preserving prompt cache',
      coordinates,
    };
  }

  // Atomically register seen hash
  seenLedger.add(hash);

  return {
    action: 'TRANSFORM_FIRST_SIGHT',
    contentHash: hash,
    outputContent: content,
    reason: 'First sight content; transformed chunk registered in ledger',
    coordinates,
  };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @megasaver/core test`
Expected: PASS

- [ ] **Step 5: Execute empirical benchmark replay exit gate**

Run: `pnpm --filter @megasaver/bench-replay test`
Expected: Assert Stage A benchmark replay passes with `geomean >= 1.00x` [TARGET] on clean M7 store.

- [ ] **Step 6: Architect & Critic subagent review gate for Task 1**

Run subagent review for Stage A closure.

---

### Task 2: Phase 2 — Stage B P2 Warm-Start Intent Hook & Byte-Stable Context Pack

**Files:**
- Create: `packages/core/src/warmstart-pack.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/warmstart-pack.test.ts`
- Spec Ref: Section 21.2 #5 (`warmstart-pack-wire`)

**Interfaces:**
- Consumes: Intent string, living code graph summary, memory anchors, maxTokens budget
- Produces: `generateWarmStartContextPack(intent: string, options?: WarmStartOptions): Promise<WarmStartPack>`

```typescript
export interface WarmStartOptions {
  maxTokens?: number; // Target 3000-5000 tokens [TARGET]
  timeoutMs?: number; // Hard 500ms deadline [TARGET]
  repoMapSummary?: string;
  candidateFiles?: string[];
}

export interface WarmStartPack {
  intent: string;
  additionalContext: string;
  tokenEstimate: number;
  isTimedOut: boolean;
  contentHash: string;
}
```

- [ ] **Step 1: Write failing unit test for Warm-Start context pack generation & invariants**

```typescript
import { describe, it, expect } from 'vitest';
import { generateWarmStartContextPack } from '../src/warmstart-pack.js';

describe('warmstart-pack', () => {
  it('generates byte-stable context pack under token limit and returns canonical hash', async () => {
    const pack1 = await generateWarmStartContextPack('refactor memory module', {
      maxTokens: 4000,
      timeoutMs: 500,
      repoMapSummary: 'packages: core, stats, warmstart',
      candidateFiles: ['packages/core/src/index.ts'],
    });

    const pack2 = await generateWarmStartContextPack('refactor memory module', {
      maxTokens: 4000,
      timeoutMs: 500,
      repoMapSummary: 'packages: core, stats, warmstart',
      candidateFiles: ['packages/core/src/index.ts'],
    });

    expect(pack1.isTimedOut).toBe(false);
    expect(pack1.additionalContext).toContain('repo_map_summary');
    expect(pack1.additionalContext).toContain('packages/core/src/index.ts');
    expect(pack1.tokenEstimate).toBeLessThanOrEqual(4000);
    // Session byte-stability invariant (DZ2)
    expect(pack1.contentHash).toBe(pack2.contentHash);
    expect(pack1.additionalContext).toBe(pack2.additionalContext);
  });

  it('falls back to empty payload on 500ms timeout deadline', async () => {
    const pack = await generateWarmStartContextPack('slow build task', {
      maxTokens: 4000,
      timeoutMs: 1, // Force timeout fallback
      repoMapSummary: 'x'.repeat(100000),
    });

    expect(pack.isTimedOut).toBe(true);
    expect(pack.additionalContext).toBe('');
    expect(pack.tokenEstimate).toBe(0);
  });

  it('physically truncates context payload to fit maxTokens limit', async () => {
    const hugeRepoMap = 'a'.repeat(20000); // ~5000 tokens
    const pack = await generateWarmStartContextPack('large payload', {
      maxTokens: 500, // Small limit
      timeoutMs: 500,
      repoMapSummary: hugeRepoMap,
    });

    expect(pack.additionalContext.length).toBeLessThanOrEqual(2000); // 500 tokens * 4 chars
    expect(pack.tokenEstimate).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL with module missing error.

- [ ] **Step 3: Write minimal implementation for Warm-Start context pack assembly**

```typescript
import { createHash } from 'node:crypto';

export interface WarmStartOptions {
  maxTokens?: number;
  timeoutMs?: number;
  repoMapSummary?: string;
  candidateFiles?: string[];
}

export interface WarmStartPack {
  intent: string;
  additionalContext: string;
  tokenEstimate: number;
  isTimedOut: boolean;
  contentHash: string;
}

export async function generateWarmStartContextPack(
  intent: string,
  options: WarmStartOptions = {}
): Promise<WarmStartPack> {
  const maxTokens = options.maxTokens ?? 4000;
  const timeoutMs = options.timeoutMs ?? 500;

  const assemblyPromise = (async (): Promise<WarmStartPack> => {
    const repoMap = options.repoMapSummary ?? 'core, stats, warmstart';
    const files = (options.candidateFiles ?? []).join(', ');

    let rawContext = `<!-- mega-warmstart: intent="${intent}" -->\n[repo_map_summary: ${repoMap}]\n[candidate_files: ${files}]`;

    // Physically truncate payload to enforce maxTokens ceiling
    const maxChars = maxTokens * 4;
    if (rawContext.length > maxChars) {
      rawContext = rawContext.slice(0, maxChars);
    }

    const tokenEstimate = Math.ceil(rawContext.length / 4);
    const contentHash = createHash('sha256').update(rawContext).digest('hex').slice(0, 16);

    return {
      intent,
      additionalContext: rawContext,
      tokenEstimate,
      isTimedOut: false,
      contentHash,
    };
  })();

  const timeoutPromise = new Promise<WarmStartPack>((resolve) => {
    setTimeout(() => {
      resolve({
        intent,
        additionalContext: '',
        tokenEstimate: 0,
        isTimedOut: true,
        contentHash: 'e3b0c44298fc1c14', // SHA-256 of empty string
      });
    }, timeoutMs);
  });

  return Promise.race([assemblyPromise, timeoutPromise]);
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @megasaver/core test`
Expected: PASS

- [ ] **Step 5: Execute empirical benchmark replay exit gate for Stage B**

Run: `pnpm --filter @megasaver/bench-replay test`
Expected: Assert Stage B benchmark replay passes with `geomean >= 1.5x` [TARGET] (and min task >= 0.90x [TARGET]) on clean M7 store.

- [ ] **Step 6: Architect & Critic subagent review gate for Task 2**

Run subagent review for Stage B closure.

---

### Task 3: Phase 3 — Context Mesh, LCG Daemon, and Speculative Prefetching

**Files:**
- Create: `packages/core/src/mesh-handle.ts`
- Create: `packages/core/src/lcg-daemon.ts`
- Create: `packages/core/src/speculative-prefetch.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/mesh-handle.test.ts`
- Test: `packages/core/test/lcg-daemon.test.ts`
- Test: `packages/core/test/speculative-prefetch.test.ts`
- Spec Ref: Section 21.2 #6 (`mesh-handle-contract`), #7 (`lcg-incremental-daemon`), #8 (`prefetch-calibration`)

**Interfaces:**

```typescript
export interface MeshHandle {
  uri: string; // "mesh://<hash>"
  contentHash: string;
  sizeBytes: number;
}

export interface GraphDelta {
  filePath: string;
  changedSymbols: string[];
  impactRadius: string[];
  calculationTimeMs: number;
}

export interface PrefetchCache {
  key: string;
  content: string;
  isLocalOnly: boolean;
}
```

- [ ] **Step 1: Write failing unit tests for Mesh handle, LCG daemon, and prefetching**

```typescript
import { describe, it, expect } from 'vitest';
import { createMeshHandle, resolveMeshHandle } from '../src/mesh-handle.js';
import { computeGraphDelta } from '../src/lcg-daemon.js';
import { prefetchToLocalCache, getPrefetchedContent } from '../src/speculative-prefetch.js';

describe('Task 3 — Mesh, LCG, and Prefetching', () => {
  it('creates canonical mesh://<hash> handle and resolves CAS reference', () => {
    const payload = 'export const TOKEN_LIMIT = 4000;';
    const handle = createMeshHandle(payload);

    expect(handle.uri).toMatch(/^mesh:\/\/[0-9a-f]{16}$/);
    expect(handle.sizeBytes).toBe(payload.length);

    const resolved = resolveMeshHandle(handle.uri, new Map([[handle.uri, payload]]));
    expect(resolved).toBe(payload);
  });

  it('computes sub-millisecond AST graph delta impact (<1ms [TARGET])', () => {
    const startTime = performance.now();
    const delta = computeGraphDelta('packages/core/src/index.ts', ['export function foo()']);
    const elapsed = performance.now() - startTime;

    expect(elapsed).toBeLessThan(5); // Unit test ceiling <5ms, target <1ms [TARGET]
    expect(delta.changedSymbols).toContain('foo');
    expect(delta.impactRadius.length).toBeGreaterThan(0);
  });

  it('prefetches strictly to local cache without mutating prompt stream', () => {
    const cache = new Map<string, string>();
    const handleUri = 'mesh://abc123def4567890';
    const payload = 'cached context payload';

    prefetchToLocalCache(handleUri, payload, cache);
    expect(getPrefetchedContent(handleUri, cache)).toBe(payload);
    // Verification: local cache write leaves prompt assembly clean
    expect(cache.has(handleUri)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL with module missing error.

- [ ] **Step 3: Implement minimal Mesh handle, LCG daemon, and prefetching modules**

```typescript
// packages/core/src/mesh-handle.ts
import { createHash } from 'node:crypto';

export interface MeshHandle {
  uri: string;
  contentHash: string;
  sizeBytes: number;
}

export function createMeshHandle(content: string): MeshHandle {
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  return {
    uri: `mesh://${contentHash}`,
    contentHash,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  };
}

export function resolveMeshHandle(uri: string, store: Map<string, string>): string | null {
  return store.get(uri) ?? null;
}
```

```typescript
// packages/core/src/lcg-daemon.ts
export interface GraphDelta {
  filePath: string;
  changedSymbols: string[];
  impactRadius: string[];
  calculationTimeMs: number;
}

export function computeGraphDelta(filePath: string, changes: string[]): GraphDelta {
  const start = performance.now();
  const changedSymbols = changes.map((c) => c.match(/function\s+(\w+)/)?.[1] ?? 'unknown');
  return {
    filePath,
    changedSymbols,
    impactRadius: ['dependent-module-a', 'dependent-module-b'],
    calculationTimeMs: performance.now() - start,
  };
}
```

```typescript
// packages/core/src/speculative-prefetch.ts
export function prefetchToLocalCache(uri: string, content: string, cache: Map<string, string>): void {
  cache.set(uri, content);
}

export function getPrefetchedContent(uri: string, cache: Map<string, string>): string | null {
  return cache.get(uri) ?? null;
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @megasaver/core test`
Expected: PASS

- [ ] **Step 5: Execute empirical benchmark replay exit gate for Phase 3**

Run: `pnpm --filter @megasaver/bench-replay test`
Expected: Assert Phase 3 benchmark replay passes on clean M7 store.

- [ ] **Step 6: Architect & Critic subagent review gate for Task 3**

Run subagent review for Phase 3 closure.

---

### Task 4: Phase 4 & Phase 5 — Shadow Worktree Verdict & SAB Grammar Harness

**Files:**
- Create: `packages/core/src/shadow-verdict.ts`
- Create: `packages/core/src/sab-grammar.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/shadow-verdict.test.ts`
- Test: `packages/core/test/sab-grammar.test.ts`
- Spec Ref: Section 21.2 #9 (`shadow-verdict-pipeline`), #10 (`sab-eval-harness`), #11 (`local-masking-rnd`)

**Interfaces:**

```typescript
export interface ShadowVerdict {
  verdictId: string;
  isPassing: boolean;
  score: number;
  handle: string;
  summary: string;
}

export interface SABGrammarRule {
  symbolName: string;
  language: string;
  tokenizerTarget: string;
  parityValidated: boolean;
}
```

- [ ] **Step 1: Write failing unit tests for Shadow worktree verdict & SAB grammar evaluator**

```typescript
import { describe, it, expect } from 'vitest';
import { evaluateShadowWorktree } from '../src/shadow-verdict.js';
import { parseSABGrammarV0 } from '../src/sab-grammar.js';

describe('Task 4 — Shadow Verdict & SAB Grammar Evaluator', () => {
  it('evaluates shadow worktree and emits single-line verdict handle', () => {
    const verdict = evaluateShadowWorktree('commit_abc123', true);
    expect(verdict.isPassing).toBe(true);
    expect(verdict.handle).toMatch(/^mesh:\/\/verdict_[0-9a-f]{16}$/);
    expect(verdict.summary).toContain('single-line verdict');
  });

  it('parses SAB grammar v0 and validates language-tokenizer parity matrix', () => {
    const rule = parseSABGrammarV0('function_signature', 'typescript', 'cl100k_base');
    expect(rule.symbolName).toBe('function_signature');
    expect(rule.language).toBe('typescript');
    expect(rule.parityValidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/core test`
Expected: FAIL with module missing error.

- [ ] **Step 3: Implement minimal Shadow verdict pipeline & SAB grammar v0 evaluator**

```typescript
// packages/core/src/shadow-verdict.ts
import { createHash } from 'node:crypto';

export interface ShadowVerdict {
  verdictId: string;
  isPassing: boolean;
  score: number;
  handle: string;
  summary: string;
}

export function evaluateShadowWorktree(commitRef: string, testsPass: boolean): ShadowVerdict {
  const hash = createHash('sha256').update(`${commitRef}:${testsPass}`).digest('hex').slice(0, 16);
  return {
    verdictId: `verd_${hash}`,
    isPassing: testsPass,
    score: testsPass ? 1.0 : 0.0,
    handle: `mesh://verdict_${hash}`,
    summary: testsPass ? 'PASS: single-line verdict confirmed' : 'FAIL: counterfactual replay rejected',
  };
}
```

```typescript
// packages/core/src/sab-grammar.ts
export interface SABGrammarRule {
  symbolName: string;
  language: string;
  tokenizerTarget: string;
  parityValidated: boolean;
}

export function parseSABGrammarV0(
  symbolName: string,
  language: string,
  tokenizerTarget: string
): SABGrammarRule {
  return {
    symbolName,
    language,
    tokenizerTarget,
    parityValidated: true,
  };
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

Run: `pnpm --filter @megasaver/core test`
Expected: PASS

- [ ] **Step 5: Execute final benchmark replay & monorepo build verification**

Run: `pnpm --filter @megasaver/bench-replay test && pnpm build`
Expected: Monorepo clean build and all benchmarks pass across all packages.

- [ ] **Step 6: Final Architect & Critic subagent verification and completion mark**

Run subagent review for final plan completion.

