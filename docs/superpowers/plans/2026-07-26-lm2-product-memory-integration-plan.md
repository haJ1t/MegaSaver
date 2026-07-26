# LM2 Product Memory Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LM2 hybrid ranking power the existing task-driven product-memory recall paths while preserving `MemoryEntry` as the only authoritative memory store.

**Architecture:** Add a small `@megasaver/memory-recall` adapter package above Core, Long Memory, and Embeddings. It converts already-authorized `MemoryEntry` values into bounded LM2 candidates, reads the existing memory embedding sidecar, and returns an additive receipt. MCP, daemon, and CLI call this one adapter; static connector context remains intentionally unranked.

**Tech Stack:** Node 22, TypeScript strict ESM, pnpm workspace, Zod, Vitest, `@megasaver/core`, `@megasaver/long-memory`, `@megasaver/embeddings`.

## Execution status — 2026-07-26

Tasks 1–5 are implemented in commits `ee85c5a2`, `70bd5bc8`, and `9afc6008`.
The adapter’s final safety test pins Safe fallback after a local embedding
failure, and MCP/daemon responses now carry the additive `hybrid` receipt.
`pnpm verify` passed after the implementation. Task 6 remains open only for
final independent and adversarial review plus PR/merge handoff. The reviewer
provider was restored on 2026-07-26; its first fresh pass found and the branch
now fixes task-aware candidate preselection plus bounded Safe fallback for
oversized LM2 per-candidate and aggregate-corpus inputs. A fresh re-review must
verify those P1 closures. A
concrete cross-surface fixture in the CLI suite proves identical Safe ordering
through the shared adapter, both applicable MCP calls, daemon registry recall,
and CLI search without
introducing a reverse dependency into `@megasaver/memory-recall`. Subsequent
adversarial passes closed cache-only embedding global state, bounded vector and
hash sidecar receipt provenance, and saturated lexical/indexed candidate-window
coverage. Follow-up review also added exact hash validation, complete vector-row
validation, and same-size sidecar race detection. Focused adapter coverage is
21/21 and `pnpm verify` passed at the working release candidate after commit
`d528189a`. The final fresh release-gate review approved `d528189a` with no
P0/P1/P2. PR #312's subsequent independent release review found the CLI bundle
could still carry a native `fs-ext` dependency and exceed its 12 MiB artifact
ceiling. The adapter now imports the native-free Long Memory `./ranker` public
entrypoint and the standalone bundle uses whitespace minification; its native,
size, GUI, and doctor smoke checks pass. A re-review of those PR findings and
the refreshed full verifier remain required before merge.

## Global Constraints

- `MemoryEntry` and the existing `memory/<projectId>.embeddings.jsonl` remain the only product corpus and vector store.
- The adapter never writes memory, sidecars, telemetry, or statistics during recall.
- Safe is the fallback on any adaptive failure; partial vectors must retain every lexical candidate.
- Existing approval, valid-time, tier, stale, scope, and code-truth behavior is applied before ranking.
- No remote embedding, automatic indexing, benchmark-contract change, Core import cycle, or agent-specific logic in Core.
- All tests follow red → green; no production code is added before its focused failing test.

---

### Task 1: Generalize LM2 candidates for product-memory projections

**Files:**
- Modify: `packages/long-memory/src/lm2-model.ts`
- Modify: `packages/long-memory/src/lm2-vector-format.ts`
- Modify: `packages/long-memory/src/index.ts`
- Test: `packages/long-memory/test/lm2-product-candidate.test.ts`
- Test: `packages/long-memory/test/index.test-d.ts`

**Interfaces:**
- Produces `Lm2Candidate.kind: "state_snapshot" | "state_transition" | "memory_entry"`.
- Produces public `rankLm2Candidates(input): Promise<Lm2RankResult>` and its structural input/result types.
- Existing LM1 and benchmark callers continue to construct only the first two kinds.

- [ ] **Step 1: Write the failing public-contract tests.**

```ts
import { rankLm2Candidates } from "../src/index.js";

it("accepts a memory_entry candidate without changing snapshot validation", async () => {
  await expect(rankLm2Candidates({
    candidates: [{ ...candidate, kind: "memory_entry" }],
    request: { workspaceKey: KEY, task: "auth", profile: "safe" },
    vectors: { read: async () => ({ vectors: [], diagnostics: [] }) },
    embedding: { egress: "local", embed: async () => ({ modelFingerprint: "a".repeat(64), vectors: [] }) },
    clock: { now: () => 0 },
  })).resolves.toMatchObject({ orderedCandidateIds: [candidate.id] });
});
```

- [ ] **Step 2: Run the test and observe schema rejection for `memory_entry`.**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-product-candidate.test.ts`

Expected: FAIL because `Lm2Candidate` rejects `memory_entry` or the ranker is not publicly exported.

- [ ] **Step 3: Make the minimal public-contract change.**

```ts
export const lm2CandidateSchema = z.object({
  // existing fields unchanged
  kind: z.enum(["state_snapshot", "state_transition", "memory_entry"]),
}).strict();

export { rankLm2Candidates, type Lm2RankResult, type RankLm2CandidatesInput } from "./lm2-ranker.js";
```

Keep LM1-only schemas restrictive where their persistence semantics require
snapshot/transition; only generic ranking/vector projection accepts the new
kind.

- [ ] **Step 4: Run focused tests and type tests.**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-product-candidate.test.ts index.test-d.ts`

Expected: PASS.

- [ ] **Step 5: Commit the isolated contract change.**

```bash
git add packages/long-memory/src packages/long-memory/test
git commit -m "feat(long-memory): admit product memory candidates"
```

### Task 2: Build the shared read-only memory-recall adapter

**Files:**
- Create: `packages/memory-recall/package.json`
- Create: `packages/memory-recall/tsconfig.json`
- Create: `packages/memory-recall/tsconfig.test.json`
- Create: `packages/memory-recall/tsconfig.test-d.json`
- Create: `packages/memory-recall/tsup.config.ts`
- Create: `packages/memory-recall/vitest.config.ts`
- Create: `packages/memory-recall/src/index.ts`
- Create: `packages/memory-recall/src/project-workspace-key.ts`
- Create: `packages/memory-recall/src/memory-candidate.ts`
- Create: `packages/memory-recall/src/rank-project-memories.ts`
- Test: `packages/memory-recall/test/project-workspace-key.test.ts`
- Test: `packages/memory-recall/test/memory-candidate.test.ts`
- Test: `packages/memory-recall/test/rank-project-memories.test.ts`
- Test: `packages/memory-recall/test/index.test-d.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

```ts
export type RankProjectMemoriesInput = {
  projectId: ProjectId;
  entries: readonly MemoryEntry[];
  task: string;
  storeRoot: string;
  query: MemorySearchQuery;
  embed?: (texts: readonly string[]) => Promise<Float32Array[]>;
  now?: () => number;
};
export type RankProjectMemoriesResult = {
  memory: readonly MemoryEntry[];
  hybrid: HybridReceipt;
};
export async function rankProjectMemories(input: RankProjectMemoriesInput): Promise<RankProjectMemoriesResult>;
```

- [ ] **Step 1: Write failing pure conversion and behavior tests.**

```ts
it("does not expose the project UUID in the derived workspace key", () => {
  expect(projectWorkspaceKey(PROJECT_ID)).toMatch(/^[0-9a-f]{16}$/);
});

it("retains an approved lexical hit with no vector in adaptive mode", async () => {
  const result = await rankProjectMemories({ ...fixture, task: "auth rotation", query: { text: "auth rotation" } });
  expect(result.memory.map((entry) => entry.id)).toContain(LEXICAL_ONLY.id);
  expect(result.hybrid.semanticStatus).toBe("used_partial_index");
});

it("falls back to Safe ranking when sidecar reading or embedding fails", async () => {
  await expect(rankProjectMemories({ ...fixture, embed: async () => { throw new Error("offline"); } })).resolves.toMatchObject({ hybrid: { profile: "safe" } });
});
```

- [ ] **Step 2: Run the adapter suite and observe missing-package failure.**

Run: `pnpm --filter @megasaver/memory-recall test`

Expected: FAIL because the workspace package and exported adapter do not exist.

- [ ] **Step 3: Create package boundaries and implementation.**

Use an exact dependency direction:

```json
"dependencies": {
  "@megasaver/core": "workspace:*",
  "@megasaver/embeddings": "workspace:*",
  "@megasaver/long-memory": "workspace:*",
  "@megasaver/shared": "workspace:*"
}
```

`rankProjectMemories` must use `searchMemoryEntries(input.entries, { ...input.query,
text: input.task, limit: 1000 })` for deterministic preselection, map only
that returned corpus to candidates, and map LM2 ordered ids back to those same
entries. Its vector reader must read the existing Core sidecar and classify
missing rows individually. Construct a local-only embedding port around the
injected/default `embed`; wrap all adaptive exceptions and return the Safe
ordering plus a valid degraded/safe receipt. Never call a write API.

- [ ] **Step 4: Add edge and regression tests before extending code.**

Cover: suggested/rejected, stale, expired, archival, scope/type/confidence
filters; zero vectors selects Safe without embedding; one semantic vector plus
one lexical-only candidate keeps both; malformed vector falls back safely;
same projection gives stable ids/order; changed text cannot use an old vector;
1,001 candidates report exactly one omission.

- [ ] **Step 5: Run focused package verification.**

Run: `pnpm --filter @megasaver/memory-recall test && pnpm --filter @megasaver/memory-recall typecheck && pnpm --filter @megasaver/memory-recall build`

Expected: PASS.

- [ ] **Step 6: Commit the shared adapter.**

```bash
git add packages/memory-recall pnpm-lock.yaml
git commit -m "feat(memory): add LM2 hybrid recall adapter"
```

### Task 3: Wire MCP task retrieval and memory search through the adapter

**Files:**
- Modify: `packages/mcp-bridge/package.json`
- Modify: `packages/mcp-bridge/src/tools/get-relevant-memories.ts`
- Modify: `packages/mcp-bridge/src/tools/recall.ts`
- Modify: `packages/mcp-bridge/src/tools/search-memory.ts`
- Test: `packages/mcp-bridge/test/tools/get-relevant-memories.test.ts`
- Test: `packages/mcp-bridge/test/tools/memory-tools.test.ts`
- Test: `packages/mcp-bridge/test/tools/recall.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:** Existing response fields are unchanged. These result objects gain
an optional `hybrid: HybridReceipt` only when a non-empty task/text was ranked.

- [ ] **Step 1: Write failing boundary tests.**

```ts
it("returns the shared LM2 receipt and keeps a partial-sidecar lexical hit", async () => {
  const result = await handleGetRelevantMemories(env, { projectId: PROJECT, task: "auth rotation" });
  expect(result.memory.map((memory) => memory.id)).toEqual([SEMANTIC.id, LEXICAL_ONLY.id]);
  expect(result.hybrid?.semanticStatus).toBe("used_partial_index");
});

it("ranks mega_recall by intent before code-truth filtering", async () => {
  const result = await handleRecall(env, { sessionId: SESSION, intent: "deploy rollback" });
  expect(result.memory[0]?.id).toBe(ROLLBACK.id);
});
```

- [ ] **Step 2: Run each focused test and observe current fallback/unranked behavior.**

Run: `pnpm --filter @megasaver/mcp-bridge test -- get-relevant-memories.test.ts recall.test.ts memory-tools.test.ts`

Expected: FAIL because no response has a hybrid receipt and `mega_recall` is
currently unranked.

- [ ] **Step 3: Wire the adapter at the MCP boundary.**

For task/text input, pass registry entries, store root, and existing filters to
`rankProjectMemories`; run existing `spotCheckHits` only on its returned order.
For absent text, preserve `registry.searchMemoryEntries` exactly. Do not add an
MCP tool, setting, network call, or memory mutation.

- [ ] **Step 4: Run focused MCP tests and the package build.**

Run: `pnpm --filter @megasaver/mcp-bridge test -- get-relevant-memories.test.ts recall.test.ts memory-tools.test.ts && pnpm --filter @megasaver/mcp-bridge typecheck`

Expected: PASS.

- [ ] **Step 5: Commit MCP integration.**

```bash
git add packages/mcp-bridge pnpm-lock.yaml
git commit -m "feat(mcp): use LM2 hybrid memory recall"
```

### Task 4: Wire daemon proxy recall without creating a behavior fork

**Files:**
- Modify: `packages/daemon/package.json`
- Modify: `packages/daemon/src/handlers-registry.ts`
- Test: `packages/daemon/test/handlers-registry.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:** `POST /recall-registry` keeps its `memory` and `chunkSets`
fields and adds optional `hybrid`. Its order must equal MCP `mega_recall` for
the same registry fixtures and intent.

- [ ] **Step 1: Add a failing parity test.**

```ts
it("returns LM2-ranked memory and its receipt for a registry recall", async () => {
  const response = await recallRegistryHandler(ROOT, { sessionId: SESSION, intent: "rollback deploy" });
  expect(response.json.memory.map((entry) => entry.id)).toEqual([ROLLBACK.id, OTHER.id]);
  expect(response.json.hybrid.profile).toMatch(/safe|adaptive/);
});
```

- [ ] **Step 2: Run it and observe the unranked registry list.**

Run: `pnpm --filter @megasaver/daemon test -- handlers-registry.test.ts`

Expected: FAIL because the handler filters but does not rank or emit `hybrid`.

- [ ] **Step 3: Call the shared adapter after the existing session/scope gate.**

Pass the same task intent and store root. Retain 404/400 behavior and chunk-set
logic exactly. Adapter failure must return Safe results, not a daemon error.

- [ ] **Step 4: Run daemon focused tests and typecheck.**

Run: `pnpm --filter @megasaver/daemon test -- handlers-registry.test.ts && pnpm --filter @megasaver/daemon typecheck`

Expected: PASS.

- [ ] **Step 5: Commit daemon parity.**

```bash
git add packages/daemon pnpm-lock.yaml
git commit -m "feat(daemon): rank proxy recall with LM2"
```

### Task 5: Wire CLI memory search and retain non-query semantics

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/src/commands/memory/search.ts`
- Test: `apps/cli/test/commands/memory/search.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:** `mega memory search <project> <query>` uses the shared adapter.
No-query and field-only searches still use the Core registry directly. Plain
output remains one entry per line; `--json` changes to an additive object only
if the established CLI JSON contract permits it, otherwise receipt stays out of
CLI output and is asserted through the adapter test.

- [ ] **Step 1: Write a failing command test for hybrid order.**

```ts
it("uses hybrid ranking only when the search has text", async () => {
  await runMemorySearch({ ...env, projectName: "demo", queryFlag: "rollback" });
  expect(lines[0]).toContain("rollback decision");
});
```

- [ ] **Step 2: Run it and observe registry-only ordering.**

Run: `pnpm --filter @megasaver/cli test -- commands/memory/search.test.ts`

Expected: FAIL because the CLI invokes `registry.searchMemoryEntries` directly.

- [ ] **Step 3: Add the adapter only to the text-query branch.**

The command already owns the resolved store root and project id; pass those
values plus the parsed `MemorySearchQuery`. Keep validation, entitlement,
errors, line formatting, and exit codes unchanged.

- [ ] **Step 4: Run CLI focused tests and typecheck.**

Run: `pnpm --filter @megasaver/cli test -- commands/memory/search.test.ts && pnpm --filter @megasaver/cli typecheck`

Expected: PASS.

- [ ] **Step 5: Commit CLI integration.**

```bash
git add apps/cli pnpm-lock.yaml
git commit -m "feat(cli): use LM2 for memory text search"
```

### Task 6: End-to-end regression proof, documentation, and review gate

**Files:**
- Create: `apps/cli/test/memory/hybrid-recall-surfaces.test.ts`
- Modify: `wiki/syntheses/longmemeval-v2-status.md`
- Modify: `wiki/log.md`
- Modify: `docs/superpowers/specs/2026-07-26-lm2-product-memory-integration-design.md`

**Interfaces:** One fixture store must prove identical ordered ids across the
shared adapter, MCP relevant-memory, MCP recall, daemon proxy recall, and CLI
search for their applicable input shape.

- [x] **Step 1: Write a cross-surface parity test.**

```ts
it("preserves the same Safe fallback order across all task recall boundaries", async () => {
  expect(await adapterIds()).toEqual(await mcpIds());
  expect(await adapterIds()).toEqual(await daemonIds());
  expect(await adapterIds()).toEqual(await cliIds());
});
```

- [x] **Step 2: Run it and observe any boundary drift.**

Run: `pnpm --filter @megasaver/memory-recall test -- product-recall.e2e.test.ts`

Observed: PASS; all applicable boundaries used the shared adapter with the
same Safe ordering and excluded an unapproved proposed memory.

- [x] **Step 3: Fix only the discovered parity differences.**

Keep the adapter as the authority; do not duplicate ranking or add per-surface
fallback policies. No ranking-policy difference was observed; the test instead
exposed a package-boundary issue, resolved by exporting the existing MCP
handlers from the package’s public entry point.

- [x] **Step 4: Run the complete verification matrix.**

Run: `pnpm --filter @megasaver/long-memory test && pnpm --filter @megasaver/memory-recall test && pnpm --filter @megasaver/mcp-bridge test && pnpm --filter @megasaver/daemon test && pnpm --filter @megasaver/cli test && pnpm verify`

Expected: every command exits 0. Also run one local smoke path that creates a
project, saves approved entries, builds `mega_index_memory`, and confirms an
MCP `get_relevant_memories` response has an Adaptive or partial-index receipt
without network egress.

- [ ] **Step 5: Obtain independent code and adversarial review.**

Give each reviewer the final base/head SHAs, this spec, this plan, and the
verification evidence. Resolve every P0/P1 before merge; record the reviewer
outputs and any P2 decision in the wiki.

- [x] **Step 6: Commit docs and evidence.**

```bash
git add docs/superpowers wiki packages/memory-recall/test
git commit -m "docs(memory): record LM2 product integration evidence"
```
