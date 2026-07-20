# Long Memory LM2 Hybrid Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build an evidence-preserving hybrid-recall runtime whose Safe profile is exactly LM1 and whose opt-in Adaptive profile uses bounded, approval-gated semantic fusion.

**Architecture:** LM2 composes LM1 internally; it does not change LM0 JSONL, Core, or connector surfaces. A bounded capture catalog and verified vector sidecars feed deterministic BM25/cosine RRF. LM1 remains the correction/evidence/token selector. A separate public-data benchmark transport and Python backend reuse the ranker.

**Tech Stack:** TypeScript strict/ESM, Node 22 filesystem/crypto/AbortController, Zod, Vitest, @megasaver/retrieval, fs-ext, Python 3.11, official LongMemEval-V2.

> **Supersession note (2026-07-20):** The accepted quota-ledger amendment and
> [rework plan](2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md)
> supersede Tasks 3–4's vector quota, operation-lock, ranker, and index steps.
> Commits through `0ae93e7d` are implementation evidence, not accepted behavior.

## Global Constraints

- HIGH risk: stay in codex/feat/long-memory-hybrid-recall; no merge/push; require independent architecture and adversarial implementation reviews.
- Preserve LM0 model.ts, rpc.ts, stdio.ts, its bin/root imports, and megasaver_memory.py behavior. LM2 is explicit runtime and benchmark surface only.
- No Core, connector, CLI/MCP, MemoryEntry, generated claims, images/OCR, automatic model download, legacy directory scan, or query-time vector writes.
- Safe delegates to LM1. Adaptive uses only records captured through the 10,000-entry/4-MiB LM2 catalog and declares that limited scope in receipts.
- Remote calls require matching config egress and current workspace/model/purpose approval immediately before each call. No approval means no egress.
- Embed only canonical redacted text plus public kind; never state keys, actions, evidence, corrections, paths, workspace keys, credentials, or query images.
- Enforce: candidate text 50,000 units; candidate corpus 64 MiB; 1,024 catalog/raw/sidecar reads and 16 MiB raw text/index call; 256 index records; 16 docs/65,536 units batch; 8,192 semantic input units; query <=1,500 ms; index batch <=15,000 ms; 24-KiB sidecar; 64-MiB decoded query vectors; 128-MiB workspace vectors; two namespaces; 10,000 sidecars/namespace; 1,000 per rank lane/fusion.
- Use trusted-root static-symlink defense, canonical base64 Float32 data, full directory fsync, mandatory OS advisory index lock, and no local-lock fallback.
- A score claim needs official Small web+enterprise outputs, combined metrics, leaderboard package, and submission_overview.json.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/long-memory/src/lm2-errors.ts, lm2-model.ts, lm2-identity.ts | Closed errors, strict ports/limits/receipts, canonical descriptor and Float32 helpers. |
| packages/long-memory/src/lm2-paths.ts, lm2-catalog.ts | Trusted catalog, cursor, approval and vector paths. |
| packages/long-memory/src/lm2-lock.ts, lm2-vector-store.ts | OS lock, quota reservation, verified sidecars. |
| packages/long-memory/src/lm2-ranker.ts, lm2-index.ts, lm2-runtime.ts | RRF, explicit indexing, LM1 composition. |
| packages/long-memory/src/lm2-benchmark.ts | Separate public open|insert|index|query|close transport. |
| packages/long-memory/test/lm2-*.test.ts | Contract, storage, ranker, runtime, integration and boundary proof. |
| benchmarks/longmemeval-v2/megasaver_lm2_memory.py | Public official-harness backend. |

### Task 1: Add LM2 contracts and canonical identities

**Files:**
- Create: packages/long-memory/src/lm2-errors.ts
- Create: packages/long-memory/src/lm2-model.ts
- Create: packages/long-memory/src/lm2-identity.ts
- Create: packages/long-memory/test/lm2-model.test.ts
- Create: packages/long-memory/test/lm2-identity.test.ts
- Modify: packages/long-memory/src/index.ts
- Modify: packages/long-memory/test/index.test-d.ts

**Interfaces:** Produces Lm2Error, ModelDescriptor, Lm2RuntimeConfig, EmbeddingPort, RemoteEmbeddingApprovalPort, candidate/index/rank schemas, HybridReceipt, modelDescriptorFingerprint, embeddingInputDigest, canonicalFloat32.

- [ ] **Step 1: Write the failing strict-boundary tests**

~~~ts
it("rejects noncanonical descriptors and Float32 overflow", () => {
  const model = {
    provider: "local", modelId: "mini", revision: "r1",
    dimensions: 3, embeddingInputVersion: "lm2-v1" as const,
  };
  expect(modelDescriptorSchema.parse(model)).toEqual(model);
  expect(modelDescriptorFingerprint(model)).toMatch(/^[0-9a-f]{64}$/);
  expect(() => canonicalFloat32([1e39, 0, 1])).toThrowObject({ code: "invalid_vectors" });
});
~~~

Add unknown-key, field-bound, timeout, two-model, receipt-reason, canonical input, and old LM0/LM1 root import fixtures.

- [ ] **Step 2: Run test red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-model.test.ts lm2-identity.test.ts index.test-d.ts

Expected: FAIL because LM2 modules and exports do not exist.

- [ ] **Step 3: Implement minimal contracts**

~~~ts
export type EmbeddingPort = {
  egress: "local" | "remote";
  embed(input: {
    model: ModelDescriptor;
    purpose: "document" | "query";
    texts: readonly string[];
    signal: AbortSignal;
  }): Promise<{ modelFingerprint: string; vectors: readonly (readonly number[])[] }>;
};

export function canonicalFloat32(values: readonly number[]): Float32Array {
  const vector = Float32Array.from(values);
  if (vector.some((value) => !Number.isFinite(value)) || vector.every((value) => value === 0)) {
    throw new Lm2Error("invalid_vectors", "Invalid embedding vector.");
  }
  return vector;
}
~~~

Use key-sorted SHA-256 and scaled non-zero norm validation. Append LM2 exports only.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-model.test.ts lm2-identity.test.ts index.test-d.ts && pnpm --filter @megasaver/long-memory typecheck

Run: git add packages/long-memory/src/lm2-{errors,model,identity}.ts packages/long-memory/src/index.ts packages/long-memory/test/lm2-{model,identity}.test.ts packages/long-memory/test/index.test-d.ts && git commit -m "feat(memory): add LM2 contracts"

### Task 2: Add bounded catalog and direct-ID reads

**Files:**
- Create: packages/long-memory/src/lm2-paths.ts
- Create: packages/long-memory/src/lm2-catalog.ts
- Create: packages/long-memory/test/lm2-catalog.test.ts
- Modify: packages/long-memory/src/lm1-store.ts
- Modify: packages/long-memory/src/lm1-paths.ts

**Interfaces:** Extends private FileLm1Store with getByIds(workspaceKey, entries, limit). Produces appendPublished(record) and page(workspaceKey, cursor, limit).

- [ ] **Step 1: Write failing catalog/cursor tests**

~~~ts
it("returns a published LM1 record when catalog persistence fails", async () => {
  injectCatalogWriteFailureOnce();
  await expect(runtime.capture.capturePrepared({ prepared, authorization: "ok" }))
    .resolves.toMatchObject({ published: { inserted: true }, adaptiveCataloged: false });
});

it("uses bounded direct-ID reads rather than raw-directory enumeration", () => {
  expect(catalog.page({ workspaceKey, cursor: null, limit: 1024 }).entries).toHaveLength(1024);
  expect(rawDirectoryEnumeration).not.toHaveBeenCalled();
});
~~~

Cover static symlink, corrupt/conflicting duplicate, 10,001 entry eviction, 4-MiB cap, generation resume/expired cursor, and id/source/kind/workspace mismatch.

- [ ] **Step 2: Run red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-catalog.test.ts

Expected: FAIL because catalog/direct-ID paging are absent.

- [ ] **Step 3: Implement post-publication catalog**

~~~ts
function appendPublished(record: Lm1Record): boolean {
  return withCatalogLock(record.workspaceKey, () => {
    const catalog = readCatalog(record.workspaceKey);
    const prior = catalog.entries.find((entry) => entry.id === record.id);
    if (prior !== undefined) return sameCatalogTuple(prior, record);
    writeCatalog(record.workspaceKey, {
      schemaVersion: 1, generation: catalog.generation + 1,
      entries: [...catalog.entries, toCatalogEntry(record)].slice(-10_000),
    });
    return true;
  });
}
~~~

Store metadata only. Implement getByIds through exact LM1 locators, validating every expected tuple and never calling list.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-catalog.test.ts lm1-store.test.ts lm1-capture.test.ts

Run: git add packages/long-memory/src/lm2-{paths,catalog}.ts packages/long-memory/src/lm1-{paths,store}.ts packages/long-memory/test/lm2-catalog.test.ts && git commit -m "feat(memory): catalog LM2 captures"

### Task 3: Persist verified vector sidecars

**Files:**
- Create: packages/long-memory/src/lm2-lock.ts
- Create: packages/long-memory/src/lm2-vector-store.ts
- Create: packages/long-memory/test/lm2-vector-store.test.ts
- Modify: packages/long-memory/package.json
- Modify: pnpm-lock.yaml

**Interfaces:** Produces withWorkspaceIndexLock, createLm2VectorStore, readVerified, reserveAndPublish.

- [ ] **Step 1: Write failing quota/lock tests**

~~~ts
it("does not egress when quota reservation fails", async () => {
  await expect(store.reserveAndPublish({ workspaceKey, model, records: [record], embed }))
    .resolves.toMatchObject({ published: [], reason: "storage_limit" });
  expect(embed).not.toHaveBeenCalled();
});

it("returns index_busy to a second process without scan or egress", async () => {
  await holdWorkspaceLock(workspaceKey);
  await expect(runSecondIndex()).resolves.toMatchObject({ reason: "index_busy" });
});
~~~

Cover malformed JSON/base64, wrong tuple/digest/model, 1e39, decoded zero norm, 24-KiB, two namespaces, 10,000 sidecars, 128 MiB, symlinks, crash partials, unsupported lock, and cross-process race.

- [ ] **Step 2: Run red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-vector-store.test.ts

Expected: FAIL because sidecars/lock are absent.

- [ ] **Step 3: Implement locked sidecars**

Run: pnpm --filter @megasaver/long-memory add fs-ext && pnpm --filter @megasaver/long-memory add -D @types/fs-ext

~~~ts
export async function withWorkspaceIndexLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const descriptor = openSync(path, "a+");
  try {
    await flockExclusiveNonBlocking(descriptor);
    return await work();
  } finally {
    closeSync(descriptor);
  }
}
~~~

Hold the lock from worst-case 24-KiB reservation through egress/no-clobber publish. Validate Float32 before write and after decode; convert lock unsupported/contended to declared non-egress outcomes.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-vector-store.test.ts && pnpm --filter @megasaver/long-memory typecheck

Run: git add packages/long-memory/package.json pnpm-lock.yaml packages/long-memory/src/lm2-{lock,vector-store}.ts packages/long-memory/test/lm2-vector-store.test.ts && git commit -m "feat(memory): persist LM2 vectors"

### Task 4: Implement ranker and explicit indexer

**Files:**
- Create: packages/long-memory/src/lm2-ranker.ts
- Create: packages/long-memory/src/lm2-index.ts
- Create: packages/long-memory/test/lm2-ranker.test.ts
- Create: packages/long-memory/test/lm2-index.test.ts

**Interfaces:** Produces rankLm2Candidates and createLm2IndexService(...).index(request).

- [ ] **Step 1: Write failing RRF/admission tests**

~~~ts
it("assigns lane-local ties before one-based RRF", async () => {
  const result = await rankLm2Candidates({
    candidates: [candidate("a", "same", "2026-01-02"), candidate("b", "same", "2026-01-01")],
    request, vectors, embedding, clock,
  });
  expect(result.orderedCandidateIds).toEqual(["a", "b"]);
});

it("does not embed revoked document text", async () => {
  await index.index({ workspaceKey, modelFingerprint, maxRecords: 256, cursor: null });
  expect(embed.mock.calls.flatMap(([call]) => call.texts)).not.toContain(revoked.text);
});
~~~

Cover BM25/cosine ordering, RRF 60, 1,000 caps, Safe no-call, semantic input limit, partial reasons, current approval, transition endpoint evidence, evidence cap, abort/no late publish, 1,024/16-MiB bound, terminal/transient cursor and >256 eligible records.

- [ ] **Step 2: Run red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-ranker.test.ts lm2-index.test.ts

Expected: FAIL because ranker/index are absent.

- [ ] **Step 3: Implement deterministic RRF and explicit index**

~~~ts
function compareHit(left: LaneHit, right: LaneHit): number {
  return right.score - left.score ||
    right.candidate.observedAt.localeCompare(left.candidate.observedAt) ||
    left.candidate.id.localeCompare(right.candidate.id);
}

for (const entry of page.entries) {
  if (eligible.length === request.maxRecords) break;
  const record = store.getById(request.workspaceKey, entry.id);
  const admission = await admitForIndex(record, evidenceBudget);
  if (admission === "transient") break;
  if (admission === "eligible") eligible.push(record);
}
~~~

Apply lane rank before fusion. Embed only explicit index batches after approval and recheck eligibility before publish. Preserve first unprocessed cursor on capacity/evidence/approval/lock/port/timeout.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-ranker.test.ts lm2-index.test.ts lm2-vector-store.test.ts

Run: git add packages/long-memory/src/lm2-{ranker,index}.ts packages/long-memory/test/lm2-{ranker,index}.test.ts && git commit -m "feat(memory): index hybrid candidates"

### Task 5: Compose Safe equivalence and Adaptive LM1 selection

**Files:**
- Create: packages/long-memory/src/lm2-runtime.ts
- Create: packages/long-memory/test/lm2-runtime.test.ts
- Modify: packages/long-memory/src/lm1-recall.ts
- Modify: packages/long-memory/src/lm1-runtime.ts
- Modify: packages/long-memory/src/index.ts

**Interfaces:** Produces createLm2Runtime with capture, recall, index and exact LM1 composition inputs.

- [ ] **Step 1: Write failing Safe/Adaptive tests**

~~~ts
it("is exactly LM1 in Safe mode", async () => {
  const lm1 = createLm1Runtime(lm1Input);
  const lm2 = createLm2Runtime({ ...lm1Input, embedding: failIfCalled, config, remoteApproval });
  const expected = await lm1.recall.recall(request);
  await expect(lm2.recall({ ...request, profile: "safe" }))
    .resolves.toMatchObject({ ...expected, receipt: { hybrid: { semanticStatus: "not_requested" } } });
  expect(failIfCalled).not.toHaveBeenCalled();
});
~~~

Cover capture invokes LM1 evidence/redaction before catalog, receipt scope, no query document write, deadline/approval, correction safety, transition eligibility, evidence/token caps, and old LM1/LM0 type surfaces.

- [ ] **Step 2: Run red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-runtime.test.ts

Expected: FAIL because LM2 runtime is absent.

- [ ] **Step 3: Compose LM1 selector**

~~~ts
if (request.profile === "safe") {
  const result = await lm1.recall.recall(request);
  return { ...result, receipt: { ...result.receipt, hybrid: safeReceipt(clock) } };
}
const ranked = await rankLm2Candidates(adaptiveInput);
return lm1FusedSelector.select(ranked.orderedCandidateIds, ranked.scores, request);
~~~

Extract LM1 state expansion, closure, evidence, token fitting, and raw output into an internal fused selector. Adaptive passes only ranked IDs/scores.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-runtime.test.ts lm1-recall.test.ts lm1-runtime.test.ts index.test-d.ts

Run: git add packages/long-memory/src/lm2-runtime.ts packages/long-memory/src/lm1-{recall,runtime}.ts packages/long-memory/src/index.ts packages/long-memory/test/lm2-runtime.test.ts && git commit -m "feat(memory): compose LM2 recall"

### Task 6: Build public benchmark transport and Python backend

**Files:**
- Create: packages/long-memory/src/lm2-benchmark.ts
- Create: packages/long-memory/test/lm2-benchmark.test.ts
- Modify: packages/long-memory/tsup.config.ts
- Modify: packages/long-memory/package.json
- Create: benchmarks/longmemeval-v2/megasaver_lm2_memory.py
- Create: benchmarks/longmemeval-v2/test_megasaver_lm2_memory.py
- Modify: benchmarks/longmemeval-v2/README.md

**Interfaces:** Produces megasaver-long-memory-lm2-benchmark open|insert|index|query|close transport and MegaSaverLm2HybridMemory memory type.

- [ ] **Step 1: Write failing public lifecycle tests**

~~~ts
it("keeps public cache separate from telemetry", async () => {
  await transport.open({ dataRoot: publicRoot, outputRoot, profile: "safe", model });
  await transport.insert({ trajectory: publicTrajectory });
  expect(await transport.query({ query: "billing", tokenBudget: 2000 }))
    .toMatchObject({ items: [{ type: "text" }] });
});
~~~

~~~python
def test_reuses_one_transport_and_ignores_query_image(self) -> None:
    memory = self.make_memory()
    memory.insert(self.public_trajectory())
    memory.query("billing", "/public/question.png")
    self.assertFalse(memory.post_query_hook()["query_image_used"])
    self.assertEqual(self.fake_process_start_count(), 1)
~~~

Cover root containment, symlinks, lifecycle order, cache/telemetry segregation, no telemetry text/path/evidence, pre-question index, correlated timeout/close, and unchanged LM0 adapter.

- [ ] **Step 2: Run red**

Run: pnpm --filter @megasaver/long-memory test -- lm2-benchmark.test.ts && python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_lm2_memory.py

Expected: FAIL because LM2 transport/backend are absent.

- [ ] **Step 3: Implement transport/backend**

~~~ts
const handlers = { open, insert, index, query, close } as const;
for await (const line of lines) process.stdout.write(dispatchLm2BenchmarkLine(line, handlers) + "\n");
~~~

~~~python
@register_memory
class MegaSaverLm2HybridMemory(Memory):
    memory_type = "megasaver_lm2_hybrid"
    def query(self, query: str, query_image: str | None = None) -> list[MemoryContextItem]:
        self._query_image_present = query_image is not None
        return self._text_items(self._rpc({"op": "query", "query": query, "tokenBudget": self.token_budget}))
~~~

Add one new tsup entry/bin only. Reuse one Python child process, expose present-but-unused image metadata, and document official reproducibility inputs/artifacts.

- [ ] **Step 4: Run green and commit**

Run: pnpm --filter @megasaver/long-memory test -- lm2-benchmark.test.ts && pnpm --filter @megasaver/long-memory build && python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py benchmarks/longmemeval-v2/test_megasaver_lm2_memory.py

Run: git add packages/long-memory/src/lm2-benchmark.ts packages/long-memory/test/lm2-benchmark.test.ts packages/long-memory/{tsup.config.ts,package.json} benchmarks/longmemeval-v2/megasaver_lm2_memory.py benchmarks/longmemeval-v2/test_megasaver_lm2_memory.py benchmarks/longmemeval-v2/README.md && git commit -m "feat(memory): add LM2 benchmark backend"

### Task 7: Prove boundaries, review, and collect official evidence

**Files:**
- Create: packages/long-memory/test/lm2-integration.test.ts
- Create: packages/long-memory/test/lm2-dependency-boundary.test.ts
- Modify: wiki/concepts/long-memory-runtime.md
- Modify: wiki/log.md
- Modify: wiki/agent-channel.md

- [ ] **Step 1: Write failing end-to-end/boundary proof**

~~~ts
it("keeps LM2 out of Core, connectors, LM0 RPC, and production benchmark imports", () => {
  for (const file of ["lm2-runtime.ts", "lm2-ranker.ts", "lm2-index.ts", "lm2-vector-store.ts"]) {
    expect(readFileSync(new URL("../src/" + file, import.meta.url), "utf8"))
      .not.toMatch(/@megasaver\/(core|connector-|mcp-bridge)|\.\/(model|rpc|stdio)\.js/);
  }
});
~~~

Add local/remote approval E2E, correction safety, catalog/legacy receipt honesty, concurrent quota proof, telemetry redaction, and old LM0 root-import fixtures.

- [ ] **Step 2: Run release verification**

Run:
~~~bash
pnpm --filter @megasaver/long-memory test
pnpm --filter @megasaver/long-memory build
python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py benchmarks/longmemeval-v2/test_megasaver_lm2_memory.py
pnpm verify
git diff --check
git status --short
~~~

Expected: all internal gates pass with only intended LM2 changes.

- [ ] **Step 3: Obtain two fresh independent HIGH-risk implementation reviews**

Supply the spec, plan, commits, exact test output, and boundary proof. Architecture review covers durability/backward compatibility; adversarial review covers egress/revocation/locks/cursors/Float32/score claims. Every P0/P1 requires a red regression, smallest fix, focused rerun, pnpm verify, and re-approval.

- [ ] **Step 4: Execute the official Small evidence gate**

Record non-sensitive revisions, data-prep mode, reader/judge/embedding config, hardware, commands, output paths, and latency samples. Run official Small web and enterprise domains, combine metrics, run the checked-out leaderboard builder, and retain public reproducibility metadata, ability metrics, combined metrics, and submission_overview.json only.

If external data/models/harness are unavailable or fail, record the exact condition. Never describe local fixtures, one-domain output, or aggregated metrics alone as a score or world-best result.

- [ ] **Step 5: Commit measured handoff**

Run: git add packages/long-memory/test/lm2-{integration,dependency-boundary}.test.ts wiki/concepts/long-memory-runtime.md wiki/log.md wiki/agent-channel.md && git commit -m "test(memory): verify LM2 hybrid recall"

## Plan self-review

- Tasks 1-5 establish strict contracts, bounded catalog, durable vectors, explicit index, and literal Safe/LM1 equivalence before public benchmark work.
- Task 6 isolates public benchmark integration from product storage and LM0 behavior.
- Task 7 requires fresh independent implementation review and official multi-domain evidence before any benchmark claim.
- No task adds Core/connector/CLI/MCP coupling, generated claims, media retrieval, automatic egress, deletion, hidden retry, or benchmark-only architecture.
