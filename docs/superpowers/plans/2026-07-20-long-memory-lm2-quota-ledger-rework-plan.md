# LM2 Quota Ledger Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LM2's directory-wide vector quota scans and per-batch locks with a bounded quota ledger and one operation-scoped lock that preserves exact allocated quotas, cursor retry safety, and sidecar-read limits.

**Architecture:** `beginIndexOperation` acquires a fixed workspace advisory lock before every index read, loads one bounded v2 ledger, and hands a non-transferable capability to the catalog-driven indexer. The capability owns all pending allocation, sidecar publication, recovery, metadata budget, and ledger finalization. Sidecars move to a fenced `embeddings-v2` root and carry an epoch/allocation sequence so recall can admit only ledger-committed vectors without an enumeration.

**Tech Stack:** TypeScript strict/ESM, Zod, Node 22 filesystem/crypto/AbortController, `fs-ext`, Vitest.

## Global Constraints

- HIGH risk: stay on `codex/feat/long-memory-hybrid-recall`; no merge/push; use TDD and independent task plus whole-branch reviews.
- This plan supersedes the accepted-but-unapproved Task 3/4 quota, vector-store, ranker, and index implementation paths at commits `6f3688c9..0ae93e7d`; do not treat their behavior as a compatibility contract.
- Preserve LM0 `model.ts`, `rpc.ts`, `stdio.ts`, bin protocol, `createLm1Runtime`, Core, connectors, and benchmark code.
- No directory-wide quota/recovery scan. One index operation reads one <=64-KiB ledger, one catalog snapshot, and at most 1,024 named sidecar metadata records total, including recovery and collision checks.
- `embeddings-v2` and the ledger are the only Adaptive vector authority. A non-empty legacy `embeddings/` root, unledgered v2 state, malformed state, or lock identity mismatch fails indexing closed before catalog scan/egress.
- A lock loser performs no catalog/raw/evidence/approval/sidecar/embedding work. The winner retains its descriptor-bound lock and capability through final ledger commit.
- Quotas are exact allocated counters for compliant ledger-aware writers: <=2 namespaces, <=10,000 sidecars/namespace, <=128 MiB/workspace, 24 KiB worst-case reservation/sidecar, and <=16 pending entries. Corrupt/deleted committed files remain allocated.
- Each sidecar uses canonical redacted public kind+text input only; includes workspace/id/kind/source digest/model/dimension/input digest/epoch/allocation sequence/canonical Float32; never state keys, actions, evidence, paths, credentials, or query images.
- Every counter/sequence/generation is a nonnegative safe integer. No allocation advances across a canceled/unknown gap. Missing/corrupt state never self-repairs or triggers egress.
- Remote document calls require the exact configured descriptor, `document` purpose, exact canonical batch projections, current approval immediately before call, evidence recheck immediately before each visibility transition, AbortSignal/deadline, and no late capability mutation.
- `Lm2IndexReceipt` is discriminated: `complete`, `continue`, `retry`, or `expired`; retry never masquerades as completion. Hybrid receipts expose sorted/deduplicated missing, invalid, ledger-invalid, recovery-pending, read-limit, approval, port, input, and timeout reasons.

### Staging type-safety constraint

Task 1 deliberately makes `Lm2IndexReceipt` exact before Task 4 replaces the superseded indexer. Until Task 4, the old `lm2-index.ts` returns the obsolete three-field receipt and package typecheck must fail only at that boundary. Do not add a cast, union, or compatibility schema to conceal the mismatch: the Task 1–3 gates are their owned focused tests plus formatting, and Task 4 must restore a fully green package typecheck with the new exact receipt.

---

### Task 1: Add ledger, receipt, and v2 sidecar contracts

**Files:**
- Create: `packages/long-memory/src/lm2-quota-ledger.ts`
- Create: `packages/long-memory/test/lm2-quota-ledger.test.ts`
- Modify: `packages/long-memory/src/lm2-model.ts`
- Modify: `packages/long-memory/src/lm2-vector-format.ts`
- Modify: `packages/long-memory/src/lm2-vector-paths.ts`
- Modify: `packages/long-memory/test/lm2-model.test.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-validation.test.ts`

**Interfaces:** Produces strict `Lm2QuotaLedger`, `Lm2PendingAllocation`, `Lm2IndexOutcome`, `Lm2VectorReadResult`, canonical record-identity digest, and v2 sidecar metadata schemas. Later tasks consume these types only; no old sidecar schema remains writeable.

- [ ] **Step 1: Write failing strict-contract tests**

```ts
it("rejects a ledger with a sequence hole, a third namespace, or unsafe counters", () => {
  expect(() => lm2QuotaLedgerSchema.parse(withGap)).toThrow();
  expect(() => lm2QuotaLedgerSchema.parse(withThirdNamespace)).toThrow();
  expect(() => lm2QuotaLedgerSchema.parse(withUnsafeGeneration)).toThrow();
});

it("admits only a v2 sidecar whose epoch and sequence are committed", () => {
  expect(isCommittedSidecar(sidecar({ epoch, allocationSequence: 4 }), ledger({ committedThrough: 4 }))).toBe(true);
  expect(isCommittedSidecar(sidecar({ epoch, allocationSequence: 5 }), ledger({ committedThrough: 4 }))).toBe(false);
});
```

Cover canonical field ordering, nonnegative safe integers, omitted zero namespaces, exact pending range, record identity domain separation, `complete|continue|retry|expired` receipt invariants, ledger semantic reasons, and legacy-root fence.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-quota-ledger.test.ts lm2-model.test.ts lm2-vector-store-validation.test.ts`

Expected: FAIL because the ledger types, v2 provenance, and receipt fields do not exist.

- [ ] **Step 3: Implement minimal schemas and pure helpers**

```ts
export function isCommittedSidecar(input: { ledger: Lm2QuotaLedger; sidecar: Lm2V2Sidecar }): boolean {
  return input.sidecar.ledgerEpoch === input.ledger.epoch &&
    input.sidecar.allocationSequence <= input.ledger.committedThroughAllocation;
}
```

Keep filesystem behavior out of this task. Enforce the receipt discriminants at the Zod boundary rather than trusting callers.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-quota-ledger.test.ts lm2-model.test.ts lm2-vector-store-validation.test.ts && pnpm --filter @megasaver/long-memory typecheck`

Run: `git add packages/long-memory/src/lm2-{quota-ledger,model,vector-format,vector-paths}.ts packages/long-memory/test/lm2-{quota-ledger,model,vector-store-validation}.test.ts && git commit -m "feat(memory): define LM2 quota ledger"`

### Task 2: Create operation-scoped ledger-backed vector storage

**Files:**
- Create: `packages/long-memory/src/lm2-index-operation.ts`
- Create: `packages/long-memory/src/lm2-ledger-recovery.ts`
- Create: `packages/long-memory/test/lm2-index-operation.test.ts`
- Modify: `packages/long-memory/src/lm2-lock.ts`
- Modify: `packages/long-memory/src/lm2-secure-fs.ts`
- Modify: `packages/long-memory/src/lm2-secure-publish.ts`
- Modify: `packages/long-memory/src/lm2-vector-sidecars.ts`
- Modify: `packages/long-memory/src/lm2-vector-store.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-lock.test.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-quota.test.ts`
- Modify: `packages/long-memory/test/lm2-vector-store-read.test.ts`

**Interfaces:** Produces `beginIndexOperation(input): Promise<Lm2IndexOperationResult>` where the success capability has `publishBatch`, `finalize`, and an internal lock/operation fence. Only this capability may mutate v2 sidecars or the ledger.

- [ ] **Step 1: Write failing operation/crash tests**

```ts
it("returns index_busy before catalog work when another operation owns the fence", async () => {
  await holdLedgerOperation(workspaceKey);
  await expect(beginIndexOperation(request)).resolves.toMatchObject({ status: "busy" });
  expect(catalogPage).not.toHaveBeenCalled();
});

it("recovers only named pending targets and never enumerates a namespace", async () => {
  await writePendingLedger({ entries: [pendingExact, pendingAbsent] });
  await beginIndexOperation(request);
  expect(namespaceEnumeration).not.toHaveBeenCalled();
  expect(readSidecarMetadata).toHaveBeenCalledTimes(2);
});
```

Cover absent/malformed/oversize ledger, non-empty legacy/v2 unledgered roots, fixed lock token mismatch, timeout late result, sequence gap after partial publish, temporary-file crash cuts, real multi-process lock loser, 1,024 shared metadata budget, and v2 read-only committed/pending diagnostics.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-index-operation.test.ts lm2-vector-store-lock.test.ts lm2-vector-store-quota.test.ts lm2-vector-store-read.test.ts`

Expected: FAIL because current per-batch reservation and directory scan behavior cannot satisfy the operation contract.

- [ ] **Step 3: Implement one fenced operation and recoverable publication**

```ts
const operation = await beginIndexOperation({ workspaceKey, model, deadline });
if (operation.status !== "ready") return operation;
try {
  return await operation.publishBatch(batch);
} finally {
  await operation.finalize();
}
```

Persist the active lock identity/token and pending allocation before egress. Publish strictly ascending allocations; recheck evidence and the capability immediately before each sidecar visibility/ledger commit. Reconcile only the bounded pending names. Reject stale/late capabilities before every durable mutation.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-index-operation.test.ts lm2-vector-store-lock.test.ts lm2-vector-store-quota.test.ts lm2-vector-store-read.test.ts && pnpm --filter @megasaver/long-memory typecheck`

Run: `git add packages/long-memory/src/lm2-{index-operation,ledger-recovery,lock,secure-fs,secure-publish,vector-sidecars,vector-store}.ts packages/long-memory/test/lm2-{index-operation,vector-store-lock,vector-store-quota,vector-store-read}.test.ts && git commit -m "feat(memory): fence LM2 vector operations"`

### Task 3: Rework bounded semantic reads and deterministic fusion

**Files:**
- Create: `packages/long-memory/src/lm2-ranking-core.ts`
- Create: `packages/long-memory/src/lm2-semantic-lane.ts`
- Modify: `packages/long-memory/src/lm2-ranker.ts`
- Modify: `packages/long-memory/test/lm2-ranker.test.ts`

**Interfaces:** Produces bounded `Lm2VectorReadResult` consumption and `rankLm2Candidates`; each source file stays below 300 LOC.

- [ ] **Step 1: Write failing diagnostics/deadline tests**

```ts
it("reports ledger-invalid and invalid vectors separately without scoring either", async () => {
  const result = await rankLm2Candidates(inputWithDiagnostics);
  expect(result.hybrid.semanticReasons).toEqual(["invalid_vectors", "quota_ledger_invalid"]);
});

it("ends semantic reads at the monotonic deadline while preserving lexical rank", async () => {
  await expect(rankLm2Candidates(slowReadInput)).resolves.toMatchObject({ hybrid: { semanticStatus: "degraded", semanticReasons: ["timeout"] } });
});
```

Cover returned-id/dimension/byte/duplicate validation, 64-MiB bound before decode, Safe no-call, query input cap, approval, deterministic lane/fused ties, 1,000 caps, and sorted de-duplicated reasons.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-ranker.test.ts`

Expected: FAIL because current ranker cannot consume ledger diagnostics or interrupt bounded reads by monotonic deadline.

- [ ] **Step 3: Split and implement the semantic boundary**

```ts
const vectorRead = await vectors.read({ ...request, deadlineAtMs, now, signal });
const semantic = scoreSemanticCandidates({ candidates, vectors: vectorRead.vectors, queryVector });
const hybrid = mergeHybridReceipt({ lexical, semantic, diagnostics: vectorRead.diagnostics });
```

Reject malformed port/vector results before scoring. Never synthesize a reason from an absent vector when the read diagnostics already classify it.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-ranker.test.ts lm2-vector-store-read.test.ts && pnpm --filter @megasaver/long-memory typecheck`

Run: `git add packages/long-memory/src/lm2-{ranking-core,semantic-lane,ranker}.ts packages/long-memory/test/lm2-ranker.test.ts && git commit -m "refactor(memory): bound LM2 semantic recall"`

### Task 4: Rework explicit index pagination and egress binding

**Files:**
- Create: `packages/long-memory/src/lm2-index-admission.ts`
- Create: `packages/long-memory/src/lm2-index-batches.ts`
- Modify: `packages/long-memory/src/lm2-index.ts`
- Modify: `packages/long-memory/test/lm2-index.test.ts`

**Interfaces:** Produces `createLm2IndexService(...).index(request)` returning the discriminated `Lm2IndexReceipt`; all index mutations route through `Lm2IndexOperation`.

- [ ] **Step 1: Write failing operation/cursor tests**

```ts
it("returns retry at page origin rather than completion on first-record approval denial", async () => {
  const receipt = await index.index({ ...request, cursor: null });
  expect(receipt).toMatchObject({ outcome: "retry", nextCursor: null, retryCursor: null, transientReason: "remote_approval_denied" });
});

it("binds remote egress to the exact canonical public batch", async () => {
  await index.index(request);
  expect(embed).toHaveBeenCalledWith(expect.objectContaining({ purpose: "document", texts: admittedCanonicalTexts }));
});
```

Cover one catalog snapshot, lock loser zero scan, >256 continuation, `expired` outcome, terminal omission advance, transient retry cursor, first committed/second transient batch, approval immediately before egress, evidence immediately before per-entry visibility, returned fingerprint/count/dimension/vector validation, timeout/no late publish, and 1,024 total sidecar metadata calls.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-index.test.ts lm2-index-operation.test.ts`

Expected: FAIL because current indexer scans before locking, permits ambiguous null cursors, and delegates unconstrained embed arguments.

- [ ] **Step 3: Implement one snapshot under one operation capability**

```ts
const operation = await vectors.beginIndexOperation({ workspaceKey, model, deadline });
if (operation.status !== "ready") return retryReceipt(operation, request.cursor ?? null);
const page = await catalog.page({ workspaceKey, cursor: request.cursor ?? null, limit: 1024 });
```

Admit records in page order, preserve the first eligible retry sequence, and give `publishBatch` only its validated configured-model canonical projections. Finalize the capability exactly once and map catalog expiry to `outcome: "expired"`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-index.test.ts lm2-index-operation.test.ts lm2-ranker.test.ts lm2-vector-store-read.test.ts && pnpm --filter @megasaver/long-memory typecheck`

Run: `git add packages/long-memory/src/lm2-{index-admission,index-batches,index}.ts packages/long-memory/test/lm2-index.test.ts && git commit -m "feat(memory): bound LM2 indexing"`

### Task 5: Integration evidence, review, and project memory

**Files:**
- Modify: `packages/long-memory/test/lm2-catalog.test.ts`
- Modify: `packages/long-memory/test/index.test-d.ts`
- Modify: `packages/long-memory/test/lm2-vector-store.test.ts`
- Modify: `wiki/concepts/long-memory-runtime.md`
- Modify: `wiki/log.md`
- Modify: `wiki/agent-channel.md`

- [ ] **Step 1: Write failing end-to-end ledger integration tests**

```ts
it("serializes a multi-batch index and recovers a published pending prefix without a namespace scan", async () => {
  await interruptAfterFirstSidecar();
  const recovered = await runIndexAgain();
  expect(recovered.receipt.quotaRecovery).toBe("recovered_pending");
  expect(namespaceEnumeration).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @megasaver/long-memory test -- lm2-catalog.test.ts lm2-vector-store.test.ts index.test-d.ts`

Expected: FAIL until the reworked contracts are wired through all integration fixtures and root type expectations.

- [ ] **Step 3: Add only integration wiring and durable project notes**

Keep LM2 exports additive and LM0/LM1 behavior unchanged. Update the wiki with the accepted ledger limitation: guarantees cover compliant writers; external well-formed trusted-root rollback is outside Node's static-symlink defense.

- [ ] **Step 4: Verify, review, and commit**

Run: `pnpm --filter @megasaver/long-memory test && pnpm --filter @megasaver/long-memory typecheck && pnpm lint && pnpm verify`

Run: `git add packages/long-memory/test/lm2-catalog.test.ts packages/long-memory/test/index.test-d.ts wiki/concepts/long-memory-runtime.md wiki/log.md wiki/agent-channel.md && git commit -m "test(memory): verify LM2 ledger recovery"`

Run an independent architecture review and adversarial code review over `git merge-base main HEAD..HEAD`; resolve every Critical/Important finding before considering Task 5 runtime composition.
