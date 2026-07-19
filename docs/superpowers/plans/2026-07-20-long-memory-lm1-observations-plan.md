# Long Memory LM1 Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build durable, evidence-bound state snapshots and transitions that survive restart, reject unsafe evidence, and recall only currently eligible state without changing LM0 or existing product memory.

**Architecture:** LM1 is additive inside @megasaver/long-memory. Strict LM1-only schemas, canonical identity, immutable no-clobber files, and an async capture service depend only on structural ports. Recall derives current state from persisted records and emits bounded, explainable results; LM0’s TypeScript exports and JSONL host remain unchanged.

**Tech Stack:** TypeScript strict/ESM, Node 22 crypto/filesystem primitives, Zod, Vitest, @megasaver/shared, and @megasaver/retrieval.

## Global Constraints

- Risk is HIGH: work only in codex/feat/long-memory-observations. Preserve the unrelated dirty root checkout; do not merge without fresh independent review.
- LM1 must not import @megasaver/core, Evidence Ledger, connector, benchmark, or LM0 model.ts/rpc.ts/stdio.ts modules.
- Keep every existing LM0 root export unchanged; add explicit LM1 exports only.
- Use strict Zod boundaries, lowercase UUIDs, 16-lowercase-hex workspace keys, explicit null canonical fields, NFC-plus-trim strings, and offset-aware dates normalized with toISOString().
- prepareCapture is the only redaction pass. It redacts { text, action } once, seals redactionVersion and canonical digest, and capturePrepared recomputes that digest without redacting.
- Limits: text 50,000 UTF-16 code units; action 5,000; state key 512; evidence ids 64; token budget 1–100,000; scan 10,000 records; rank 1,000; resolve 512 distinct evidence ids.
- Persist only append-only files under <storeRoot>/long-memory/v1/<workspaceKey>/{snapshots,transitions}/<sourceDigest>.json. Use atomic no-clobber temp-file publish plus directory fsync; never use the stale-stealable lease lock.
- Trust only a local non-adversarial store root. Reject static root/parent/record/temp symlinks, but do not claim protection from same-privilege post-check swaps.
- A record is eligible only when binding verifies and every cited evidence result is exactly once, same-workspace, available, and free of unresolved high-risk findings.
- A persisted correction permanently closes its predecessor for normal state recall. If no eligible structural leaf remains, emit omitted_correction_chain_unavailable; never fall back to stale state.
- Do not call pinEvidence, mutate MemoryEntry, add CLI/MCP, or change the public LongMemEval Python adapter.
- Before final review run pnpm verify, pnpm --filter @megasaver/long-memory test, and python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/long-memory/src/lm1-errors.ts | Closed LM1 error codes and error class. |
| packages/long-memory/src/lm1-model.ts | Strict LM1 schemas, prepared capture, port, and receipt types. |
| packages/long-memory/src/lm1-identity.ts | Canonical JSON, SHA-256, deterministic UUID, binding digest. |
| packages/long-memory/src/lm1-paths.ts | Workspace-scoped paths and static-symlink validation. |
| packages/long-memory/src/lm1-store.ts | Parse, list, read, and atomic no-clobber persistence. |
| packages/long-memory/src/lm1-capture.ts | One-pass prepare and async capture orchestration. |
| packages/long-memory/src/lm1-recall.ts | Bounded BM25 ranking, state derivation, receipts. |
| packages/long-memory/src/index.ts | Existing LM0 surface plus explicit LM1 exports. |
| packages/long-memory/test/lm1-*.test.ts | Unit, restart, boundary, and integration evidence. |

### Task 1: Pin LM1 contracts, canonical identity, and the public surface

**Files:**
- Create: packages/long-memory/src/lm1-errors.ts
- Create: packages/long-memory/src/lm1-model.ts
- Create: packages/long-memory/src/lm1-identity.ts
- Create: packages/long-memory/test/lm1-model.test.ts
- Create: packages/long-memory/test/lm1-identity.test.ts
- Modify: packages/long-memory/src/index.ts
- Modify: packages/long-memory/package.json
- Modify: packages/long-memory/test/index.test-d.ts

**Interfaces:**
- Consumes: WorkspaceKey and workspaceKeySchema from @megasaver/shared.
- Produces: Lm1Error, PrepareCaptureInput, PreparedCapture, Lm1Record, RedactionPort, EvidenceBindingPort, EvidenceEligibilityPort, prepareCapture, canonicalCaptureDigest, deriveLm1RecordId, deriveEvidenceBindingDigest.

- [x] **Step 1: Write failing strict-schema, one-pass redaction, and export tests**

~~~ts
const redactor: RedactionPort = {
  version: "r1",
  redact: ({ text, action }) => ({ text: "safe:" + text, action, unresolvedHighRisk: false }),
};

it("prepares a canonical snapshot with one redaction call", () => {
  const prepared = prepareCapture({
    workspaceKey: "0123456789abcdef",
    kind: "state_snapshot",
    observedAt: "2026-07-20T00:00:00.000Z",
    text: " billing paid ",
    action: null,
    evidenceIds: [
      "22222222-2222-4222-8222-222222222222",
      "11111111-1111-4111-8111-111111111111",
    ],
    stateKey: "billing.status",
    representation: "value",
    supersedesSnapshotId: null,
  }, redactor);

  expect(prepared.text).toBe("safe: billing paid");
  expect(prepared.evidenceIds).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
  expect(() => preparedCaptureSchema.parse({ ...prepared, extra: true })).toThrow();
});
~~~

Extend index.test-d.ts to type-import each existing LM0 root export from the current index.ts: LONG_MEMORY_PACKAGE, createInMemoryLongMemoryStore, LongMemoryStore, dispatchRpcLine, all LM0 schemas, and all LM0 public types. It must also type-import prepareCapture and the Task 1 LM1 public types. Task 3 extends this fixture with createLm1CaptureService. Add a fixed golden vector for NFC text, explicit null, SHA-256 digest, and lowercase UUID version 5.

- [x] **Step 2: Run tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-model.test.ts lm1-identity.test.ts index.test-d.ts

Expected: FAIL because LM1 files and root exports do not exist.

- [x] **Step 3: Implement contracts and identity**

~~~ts
export const LM1_SCHEMA_VERSION = 1 as const;
export const MAX_LM1_TEXT_CODE_UNITS = 50_000;
export const MAX_LM1_ACTION_CODE_UNITS = 5_000;
export const MAX_LM1_EVIDENCE_IDS = 64;

export type RedactionPort = {
  version: string;
  redact(input: { text: string; action: string | null }): {
    text: string;
    action: string | null;
    unresolvedHighRisk: boolean;
  };
};
~~~

Implement strict discriminated snapshot/transition schemas. Require explicit null for supersedesSnapshotId and action where not applicable. Make prepareCapture call RedactionPort once, reject unresolved high risk, normalize all strings, sort/de-duplicate evidence IDs, and seal redactionVersion plus canonicalCaptureDigest. Use UTF-8 SHA-256 over recursively key-sorted JSON; set RFC version and variant bits on the first 16 SHA-256 bytes of the LM1 ID domain input. Append only Task 1 LM1 exports to index.ts without removing/reordering LM0 exports. Add @megasaver/shared workspace dependency and update pnpm-lock.yaml only if pnpm changes it.

- [x] **Step 4: Run contracts green**

Run: pnpm --filter @megasaver/long-memory test -- lm1-model.test.ts lm1-identity.test.ts index.test-d.ts && pnpm --filter @megasaver/long-memory typecheck && pnpm lint

Expected: focused tests, type tests, and formatting pass; old LM0 root imports still compile.

- [x] **Step 5: Commit the contract boundary**

Run:
~~~bash
git add packages/long-memory/package.json packages/long-memory/src/index.ts \
  packages/long-memory/src/lm1-errors.ts packages/long-memory/src/lm1-model.ts \
  packages/long-memory/src/lm1-identity.ts packages/long-memory/test/lm1-model.test.ts \
  packages/long-memory/test/lm1-identity.test.ts packages/long-memory/test/index.test-d.ts pnpm-lock.yaml
git commit -m "feat(memory): add LM1 contracts"
~~~

### Task 2: Persist immutable records beneath a trusted root

**Files:**
- Create: packages/long-memory/src/lm1-paths.ts
- Create: packages/long-memory/src/lm1-store.ts
- Create: packages/long-memory/test/lm1-store.test.ts
- Modify: packages/long-memory/src/index.ts

**Interfaces:**
- Consumes: Task 1 Lm1Record, canonical identity helpers, and Lm1Error.
- Produces: createFileLm1Store({ storeRoot }) with publish(record), getById(workspaceKey, id), getByDigest(workspaceKey, kind, sourceDigest), and list(workspaceKey, limit).

- [x] **Step 1: Write failing restart, corrupt-path, symlink, and concurrency tests**

~~~ts
it("adopts first durable content while ignoring retry recordedAt", () => {
  const first = createFileLm1Store({ storeRoot: tempDir });
  expect(first.publish(record)).toMatchObject({ inserted: true, record });

  const restarted = createFileLm1Store({ storeRoot: tempDir });
  expect(restarted.publish({ ...record, recordedAt: "2026-07-20T00:01:00.000Z" }))
    .toMatchObject({ inserted: false, record });
});

it("rejects a static snapshot-directory symlink", () => {
  // Build <root>/long-memory/v1/<workspace>/snapshots as a symlink before publish.
  expect(() => createFileLm1Store({ storeRoot: tempDir }).publish(record))
    .toThrow(/store_corrupt/);
});
~~~

Add tests for JSON corruption, filename/sourceDigest mismatch, derived-ID mismatch, pre-publish injected failure, valid restarted list ordering, and two child Node processes publishing the same record. The child test must prove one inserted true, one inserted false, and one parseable final record.

- [x] **Step 2: Run storage tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-store.test.ts

Expected: FAIL because createFileLm1Store is absent.

- [x] **Step 3: Implement paths and atomic no-clobber publishing**

~~~ts
function publishNoClobber(path: string, serialized: string): "created" | "exists" {
  const tempPath = join(dirname(path), "." + randomUUID() + ".tmp");
  writeFileSync(tempPath, serialized, { flag: "wx" });
  fsyncFile(tempPath);
  try {
    linkSync(tempPath, path);
    fsyncDirectory(dirname(path));
    return "created";
  } catch (error) {
    if (isEexist(error)) return "exists";
    throw error;
  } finally {
    rmSync(tempPath, { force: true });
  }
}
~~~

Validate the workspace path segment with the shared schema. Reject a pre-existing symlink at root, v1 directory, workspace directory, kind directory, record, and temp path using lstatSync. On existing target, parse with lm1RecordSchema, verify workspace/kind/digest/derived ID, compare identity, payload, and binding fields but deliberately ignore incoming recordedAt, then return the first persisted record unchanged. Sort list output by kind then source digest and stop at the explicit limit.

- [x] **Step 4: Run storage tests green**

Run: pnpm --filter @megasaver/long-memory test -- lm1-store.test.ts && pnpm --filter @megasaver/long-memory typecheck

Expected: restart adoption, symlink rejection, corrupted-file rejection, concurrent equal publish, and pre-publish retry tests pass.

- [x] **Step 5: Commit persistence**

Run:
~~~bash
git add packages/long-memory/src/lm1-paths.ts packages/long-memory/src/lm1-store.ts \
  packages/long-memory/src/index.ts packages/long-memory/test/lm1-store.test.ts
git commit -m "feat(memory): persist immutable LM1 records"
~~~

### Task 3: Capture evidence-bound snapshots with structural async ports

**Files:**
- Create: packages/long-memory/src/lm1-capture.ts
- Create: packages/long-memory/test/lm1-capture.test.ts
- Modify: packages/long-memory/src/index.ts

**Interfaces:**
- Consumes: Task 1 PreparedCapture/port types and Task 2 FileLm1Store.
- Produces: createLm1CaptureService({ store, redaction, evidenceBinding, evidenceEligibility, clock }) with prepare(input) and capturePrepared({ prepared, authorization }).

- [x] **Step 1: Write failing capture tests with complete fake ports**

~~~ts
const service = createLm1CaptureService({
  store,
  redaction: { version: "r1", redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }) },
  evidenceBinding: {
    verify: async ({ evidenceIds }) => ({
      evidence: evidenceIds.map((evidenceId) => ({ evidenceId, evidenceDigest: "a".repeat(64) })),
    }),
  },
  evidenceEligibility: {
    resolve: async ({ workspaceKey, evidenceIds }) => evidenceIds.map((evidenceId) => ({
      evidenceId, workspaceKey, status: "available" as const, unresolvedHighRisk: false,
    })),
  },
  clock: { now: () => "2026-07-20T00:00:01.000Z" },
});

await expect(service.capturePrepared({ prepared, authorization: "signed" }))
  .resolves.toMatchObject({ inserted: true });
await expect(service.capturePrepared({
  prepared: { ...prepared, text: "tampered" },
  authorization: "signed",
})).rejects.toMatchObject({ code: "evidence_binding_invalid" });
~~~

Cover null, missing, duplicate, extra, and out-of-order binding id/digest entries; exact eligibility result matching; foreign workspace; metadata-only/revoked/unresolved statuses; thrown known and unknown port errors; and a changed redaction version that cannot reuse prior authorization. Assert capturePrepared never calls the redactor. Add a public-data fixture port that validates the same canonical digest without a user store.

- [x] **Step 2: Run capture tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-capture.test.ts

Expected: FAIL because createLm1CaptureService is absent.

- [x] **Step 3: Implement fail-closed capture**

~~~ts
const prepared = preparedCaptureSchema.parse(input.prepared);
if (canonicalCaptureDigest(prepared) !== prepared.canonicalCaptureDigest) {
  throw new Lm1Error("evidence_binding_invalid", "Prepared capture digest mismatch.");
}
const binding = await ports.evidenceBinding.verify({
  workspaceKey: prepared.workspaceKey,
  canonicalCaptureDigest: prepared.canonicalCaptureDigest,
  evidenceIds: prepared.evidenceIds,
  authorization: input.authorization,
});
const evidenceDigests = assertOrderedEvidenceBindings(prepared.evidenceIds, binding);
const eligibility = await ports.evidenceEligibility.resolve({
  workspaceKey: prepared.workspaceKey,
  evidenceIds: prepared.evidenceIds,
});
assertExactEligibleEvidence(prepared, eligibility);
return store.publish(buildRecord(prepared, evidenceDigests, clock.now()));
~~~

Map known port errors to their closed codes and unknown failures to store_corrupt. Derive evidenceBindingDigest from the domain-separated canonical object with workspace, canonical capture digest, ordered IDs, and ordered evidence digests. For snapshots, require any superseded record to be a same-workspace/same-stateKey snapshot with a strictly earlier observedAt.

- [x] **Step 4: Run capture tests green**

Run: pnpm --filter @megasaver/long-memory test -- lm1-capture.test.ts lm1-model.test.ts lm1-identity.test.ts lm1-store.test.ts

Expected: all prepared-digest, binding, eligibility, public-data-port, and snapshot tests pass.

- [x] **Step 5: Commit snapshot capture**

Run:
~~~bash
git add packages/long-memory/src/lm1-capture.ts packages/long-memory/src/index.ts \
  packages/long-memory/test/lm1-capture.test.ts
git commit -m "feat(memory): capture bound LM1 snapshots"
~~~

### Task 4: Validate transitions and correction-chain state

**Files:**
- Modify: packages/long-memory/src/lm1-capture.ts
- Modify: packages/long-memory/src/lm1-store.ts
- Create: packages/long-memory/test/lm1-transition.test.ts

**Interfaces:**
- Consumes: Task 3 capture service and persisted snapshots.
- Produces: valid state_transition capture and structural-leaf helpers for Task 5.

- [x] **Step 1: Write failing transition and correction tests**

~~~ts
await capture(snapshotA);
await capture(snapshotBThatSupersedesA);
await expect(capture({
  kind: "state_transition",
  preSnapshotId: snapshotA.id,
  postSnapshotId: snapshotB.id,
  action: "set paid",
  outcome: "applied",
})).resolves.toMatchObject({ record: { kind: "state_transition" } });

await expect(capture(crossWorkspaceTransition))
  .rejects.toMatchObject({ code: "invalid_transition" });
expect(currentStateAfterRevokingB("billing.status")).toMatchObject({
  records: [],
  omitted: [{ id: snapshotB.id, reason: "omitted_correction_chain_unavailable" }],
});
~~~

Cover missing/non-snapshot endpoint, self-reference, mismatched state keys, invalid pre ≤ transition ≤ post chronology, correction older/equal time, branch ties by observedAt/recordedAt/UUID, and revoked or metadata-only correction that must never reactivate its predecessor.

- [x] **Step 2: Run transition tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-transition.test.ts

Expected: FAIL because transition and structural-leaf behavior is absent.

- [x] **Step 3: Implement endpoint checks and leaves before eligibility**

~~~ts
function assertTransition(pre: Lm1Snapshot, post: Lm1Snapshot, transition: PreparedTransition): void {
  if (pre.workspaceKey !== post.workspaceKey || pre.stateKey !== post.stateKey) {
    throw new Lm1Error("invalid_transition", "Transition endpoints disagree.");
  }
  if (!(pre.observedAt <= transition.observedAt && transition.observedAt <= post.observedAt)) {
    throw new Lm1Error("invalid_transition", "Transition timestamps are invalid.");
  }
}

function structuralLeaves(records: readonly Lm1Snapshot[]): readonly Lm1Snapshot[] {
  const closed = new Set(records.flatMap((record) =>
    record.supersedesSnapshotId === null ? [] : [record.supersedesSnapshotId],
  ));
  return records.filter((record) => !closed.has(record.id));
}
~~~

Validate references before publish. Determine structural leaves from all durable snapshots before evidence eligibility. Rank eligible leaves by observedAt descending, recordedAt descending, then id ascending. If a closed chain has no eligible leaf, report its correction-chain omission without exposing its predecessor as current state.

- [x] **Step 4: Run transition tests green**

Run: pnpm --filter @megasaver/long-memory test -- lm1-transition.test.ts lm1-capture.test.ts

Expected: all endpoint, ordering, branch, and revocation-chain tests pass.

- [x] **Step 5: Commit transition semantics**

Run:
~~~bash
git add packages/long-memory/src/lm1-capture.ts packages/long-memory/src/lm1-store.ts \
  packages/long-memory/test/lm1-transition.test.ts
git commit -m "feat(memory): validate LM1 transitions"
~~~

### Task 5: Recall bounded eligible state with receipts

**Files:**
- Create: packages/long-memory/src/lm1-recall.ts
- Create: packages/long-memory/test/lm1-recall.test.ts
- Modify: packages/long-memory/src/index.ts

**Interfaces:**
- Consumes: Task 1 recall schemas/port types, Task 2 store, Task 4 structural leaves.
- Produces: createLm1RecallService({ store, evidenceEligibility }) with recall(request): Promise<Lm1RecallBundle>.

- [x] **Step 1: Write failing ranking, budget, and revocation tests**

~~~ts
const result = await recall.recall({
  workspaceKey: "0123456789abcdef",
  task: "billing state",
  tokenBudget: 20,
});

expect(result.items.map((item) => item.observationId)).toEqual([paid.id]);
expect(result.receipt).toMatchObject({
  selected: [{ id: paid.id, tokenCount: expect.any(Number) }],
  omitted: [{ id: revoked.id, reason: "omitted_evidence_unavailable" }],
  scannedRecordCount: 3,
});
~~~

Prove enumeration by kind then source digest before the 10,000 cap; score/observedAt/UUID tie ordering; zero-score suppression; full-item token-budget omission; 512-distinct-evidence omission; live status recheck after capture; transition endpoint eligibility; correction-chain omission; and stable receipt ordering.

- [x] **Step 2: Run recall tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-recall.test.ts

Expected: FAIL because the recall service is absent.

- [x] **Step 3: Implement deterministic recall**

~~~ts
const records = store.list(request.workspaceKey, MAX_LM1_RECORDS_SCANNED);
const ranked = rankBm25({
  query: request.task,
  documents: records.map((record) => ({ id: record.id, text: record.text })),
  topN: Math.min(records.length || 1, MAX_LM1_CANDIDATES),
}).filter((hit) => hit.score > 0);
~~~

Re-sort hits by score descending, observedAt descending, and id ascending. Before resolving each candidate, count new evidence IDs; omit it as omitted_evidence_limit if doing so exceeds 512. Require exact eligible evidence replies using the same helper as capture. Select only whole items whose Math.ceil(text.length / 4) fits the token budget. Emit exactly selected, omitted, scannedRecordCount, candidateCount, and evidenceLookupCount; permitted reasons are omitted_evidence_unavailable, omitted_evidence_limit, omitted_budget, and omitted_correction_chain_unavailable.

- [x] **Step 4: Run package tests green**

Run: pnpm --filter @megasaver/long-memory test && pnpm --filter @megasaver/long-memory typecheck

Expected: all LM0 and LM1 tests pass and LM1 recall is deterministic and revocation-aware.

- [x] **Step 5: Commit recall**

Run:
~~~bash
git add packages/long-memory/src/lm1-recall.ts packages/long-memory/src/index.ts \
  packages/long-memory/test/lm1-recall.test.ts
git commit -m "feat(memory): recall eligible LM1 state"
~~~

### Task 6: Prove integration, preserved LM0 boundaries, and release evidence

**Files:**
- Create: packages/long-memory/test/lm1-integration.test.ts
- Create: packages/long-memory/test/lm1-dependency-boundary.test.ts
- Modify: packages/long-memory/test/index.test-d.ts
- Modify: wiki/concepts/long-memory-runtime.md
- Modify: wiki/log.md
- Modify: wiki/agent-channel.md

**Interfaces:**
- Consumes: Tasks 1–5 and the unchanged benchmarks/longmemeval-v2/test_megasaver_memory.py.
- Produces: reproducible LM1 restart/boundary proof and verified project-memory handoff.

- [ ] **Step 1: Write failing integration and dependency tests**

~~~ts
it("keeps LM1 isolated from LM0 protocol and product packages", () => {
  for (const file of ["lm1-model.ts", "lm1-capture.ts", "lm1-recall.ts", "lm1-store.ts"]) {
    const source = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
    expect(source).not.toMatch(/@megasaver\/(core|evidence-ledger|connector-|mcp-bridge)|\.\/(model|rpc|stdio)\.js/);
  }
});

it("adopts a durable record after a restarted public-data port", async () => {
  await first.capturePrepared({ prepared, authorization });
  await expect(restarted.capturePrepared({ prepared, authorization }))
    .resolves.toMatchObject({ inserted: false, record: firstRecord });
});
~~~

Add the evidence-durable/no-authorization crash fixture: restart must load existing deterministic evidence through a fake public-data adapter, verify the stored digest commitment, reconstruct the same PreparedCapture, and adopt one LM1 record. Type tests must continue asserting every original LM0 export.

- [ ] **Step 2: Run integration tests red**

Run: pnpm --filter @megasaver/long-memory test -- lm1-integration.test.ts lm1-dependency-boundary.test.ts

Expected: FAIL because integration and dependency tests are absent.

- [ ] **Step 3: Add integration fixtures and verified wiki evidence**

Implement only test fixtures and the dependency-boundary assertion. Keep Python adapter source unchanged. Update wiki pages only after facts are measured: focused test totals, pnpm verify result, Python result, external reviewer verdict, branch, and the absence of an official benchmark score.

- [ ] **Step 4: Run the release gate**

Run:
~~~bash
pnpm --filter @megasaver/long-memory test
pnpm --filter @megasaver/long-memory build
python3 -m unittest benchmarks/longmemeval-v2/test_megasaver_memory.py
pnpm verify
git diff --check
git status --short
~~~

Expected: package tests/build, Python adapter suite, and repository verification pass; status shows only intended LM1 changes.

- [ ] **Step 5: Request fresh independent HIGH-risk implementation review**

Give the reviewer the approved spec, this plan, task commits, test summary, pnpm verify result, Python result, and dependency-boundary evidence. For every P0/P1 finding, write a failing regression test, make the smallest fix, rerun the affected suite plus pnpm verify, and obtain a re-review approval.

- [ ] **Step 6: Commit release evidence**

Run:
~~~bash
git add packages/long-memory/test/lm1-integration.test.ts \
  packages/long-memory/test/lm1-dependency-boundary.test.ts \
  packages/long-memory/test/index.test-d.ts wiki/concepts/long-memory-runtime.md \
  wiki/log.md wiki/agent-channel.md
git commit -m "test(memory): verify LM1 observations"
~~~

## Plan self-review

- Task 1 defines all names, types, limits, and public exports before any later task consumes them.
- Task 2 proves immutable no-clobber persistence, restart adoption, corruption handling, static-symlink rejection, and concurrent equal writers without unsafe locking.
- Tasks 3–4 enforce one-pass redaction, exact async evidence binding/eligibility, snapshots, transitions, and permanent correction closure.
- Task 5 covers scan/candidate/evidence/token limits, deterministic ranking, live revocation, transition eligibility, and all receipt reasons.
- Task 6 proves public-data ports, preserved LM0 TypeScript/JSONL boundaries, crash adoption, external review, full verification, and wiki handoff.
- No task introduces CLI, MCP, Core, connector, or direct Evidence Ledger integration.
