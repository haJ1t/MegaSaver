# Long-Memory GA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote eligible LM1 current-state observations into suggested, approval-gated `MemoryEntry` facts that flow into session kickoff and context-gate ranking as fill-gap inputs, with candidate-side expiry, contradiction flagging, and complete §13 metadata.

**Architecture:** An additive read surface in `@megasaver/long-memory` lists eligible current-state snapshots; a pure draft builder in `@megasaver/memory-recall` maps them to `memoryEntrySchema`-valid suggested drafts with deterministic ids; `mega memory promote` writes drafts through `CoreRegistry.createMemoryEntry`; approved `lm-fact:` entries reach `renderTaskKickoffPack` fill-gap slots and, via a workspace-keyed hints file, `buildSaverDecision`'s fill-gap intent. Approval stays `applyApprovalFlip`; LM1 storage is untouched.

**Tech Stack:** TypeScript strict/ESM, Node 22 crypto/fs, Zod, Vitest, Citty, @megasaver/long-memory, @megasaver/memory-recall, @megasaver/core, @megasaver/evidence-ledger.

## Global Constraints

- No paid API calls in CI; no LLM/model calls; no network in any test (decisions/a4-closed-under-model).
- Risk HIGH: work only in worktree `feat/long-memory-ga`; no `main` edits; independent code-reviewer AND critic passes before merge.
- `@megasaver/long-memory` must not import `@megasaver/core`, connectors, or benchmark code (LM1 hard boundary, held).
- LM1 records are append-only: no deletion, mutation, or write-path change; expiry is promotion-admission only (`maxAgeDays` default 45).
- Every draft: `approval: "suggested"`, `source: "agent"`, `scope: "project"`, injected timestamps, deterministic `confidence`, explicit `expiresAt: null` — never omitted (§13 metadata completeness).
- Promoted id is deterministic: v5-style UUID from SHA-256 of `megasaver.memory.promotion.v1\0` + workspaceKey + snapshot id; re-promotion is an `already-promoted` no-op.
- Fill-gap precedence: explicit tool intent always wins; session intent precedes hint terms; absent both, saver behavior is byte-identical to today.
- Kickoff: promoted facts fill only slots left under `TASK_KICKOFF_MAX_MEMORIES` (6) after verified/healed memories; never displace one.
- Hints file `<storeRoot>/stats/<workspaceKey>/promoted-facts.json`: ≤12 terms × ≤64 code units, atomic tmp+rename, best-effort read/write (failure ⇒ `undefined` / no write).
- Reuse LM1 caps: 10,000-record scan, 512 distinct evidence resolutions; over-cap groups are omitted, never truncated.
- No timing-tight tests: injected clocks and structural counts only; no wall-clock assertions.
- Before final review: `pnpm verify` and `pnpm --filter @megasaver/long-memory test` and `pnpm --filter @megasaver/memory-recall test` and `pnpm --filter @megasaver/cli test`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/long-memory/src/lm1-promotion-read.ts | Bounded, eligibility-gated current-state listing for promotion. |
| packages/memory-recall/src/promotion.ts | Pure draft builder, deterministic promoted id, contradiction flags. |
| apps/cli/src/lm/evidence-eligibility.ts | Evidence-ledger → `EvidenceEligibilityPort` adapter (fail-closed). |
| apps/cli/src/hooks/promoted-facts.ts | Promoted-fact hints file writer/reader. |
| apps/cli/src/commands/memory/promote.ts | `mega memory promote` command. |
| apps/cli/src/hooks/saver.ts | Fill-gap hint injection (modify). |
| apps/cli/src/hooks/task-kickoff-pack.ts | Kickoff fill-gap admission (modify). |

### Task 1: List eligible current state for promotion

**Files:**
- Create: packages/long-memory/src/lm1-promotion-read.ts
- Create: packages/long-memory/test/lm1-promotion-read.test.ts
- Modify: packages/long-memory/src/index.ts
- Modify: packages/long-memory/test/index.test-d.ts

**Interfaces:**
- Consumes: `createFileLm1Store` (packages/long-memory/src/lm1-store.ts), `selectCurrentStateSnapshots` (packages/long-memory/src/lm1-state.ts), `EvidenceEligibilityPort`, `Lm1Snapshot` (packages/long-memory/src/lm1-model.ts), `Lm1Error` (packages/long-memory/src/lm1-errors.ts). Test fixture consumes `createLm1CaptureService` (`prepare` + `capturePrepared`, packages/long-memory/src/lm1-capture.ts).
- Produces:

~~~ts
export type Lm1PromotionClock = { now: () => string };
export type Lm1PromotionCandidate = { snapshot: Lm1Snapshot; ageDays: number };
export type ListCurrentStateForPromotionInput = {
  storeRoot: string;
  workspaceKey: string;
  evidenceEligibility: EvidenceEligibilityPort;
  clock: Lm1PromotionClock;
  maxAgeDays: number;
};
export function listCurrentStateForPromotion(
  input: ListCurrentStateForPromotionInput,
): Promise<readonly Lm1PromotionCandidate[]>;
~~~

- [ ] **Step 1: Write failing listing tests** (mimic the `createServices` fixture of packages/long-memory/test/lm1-recall.test.ts: mkdtemp root, stub redaction/binding ports, mutable eligibility status map, fixed clock)

~~~ts
// captureSnapshot mimics lm1-recall.test.ts:186-187 —
// capture.prepare(snapshotInput(overrides)) then
// capture.capturePrepared({ prepared, authorization: "signed" }).
it("returns only the newest eligible leaf per state key", async () => {
  const { capture, statuses, root } = createServices();
  const first = await captureSnapshot(capture, { stateKey: "billing.status", text: "unpaid", observedAt: "2026-07-30T00:00:00.000Z" });
  await captureSnapshot(capture, { stateKey: "billing.status", text: "paid", observedAt: "2026-08-01T00:00:00.000Z", supersedesSnapshotId: first.id });
  await captureSnapshot(capture, { stateKey: "old.key", text: "stale", observedAt: "2026-04-01T00:00:00.000Z" });
  const candidates = await listCurrentStateForPromotion({
    storeRoot: root,
    workspaceKey,
    evidenceEligibility,
    clock: { now: () => "2026-08-06T00:00:00.000Z" },
    maxAgeDays: 45,
  });
  expect(candidates.map((c) => c.snapshot.stateKey)).toEqual(["billing.status"]);
  expect(candidates[0]?.snapshot.text).toBe("paid");
  expect(candidates[0]?.ageDays).toBe(5);
});

it("omits a state key whose winning leaf lost evidence, never falling back", async () => {
  const { capture, statuses, root } = createServices();
  const first = await captureSnapshot(capture, { stateKey: "billing.status", text: "unpaid", observedAt: "2026-07-30T00:00:00.000Z" });
  await captureSnapshot(capture, { stateKey: "billing.status", text: "paid", observedAt: "2026-08-01T00:00:00.000Z", supersedesSnapshotId: first.id, evidenceIds: [secondEvidenceId] });
  statuses.set(secondEvidenceId, "revoked"); // winning leaf loses its evidence
  const candidates = await listCurrentStateForPromotion({
    storeRoot: root,
    workspaceKey,
    evidenceEligibility,
    clock: { now: () => "2026-08-06T00:00:00.000Z" },
    maxAgeDays: 45,
  });
  expect(candidates).toEqual([]); // superseded "unpaid" leaf is NOT a fallback
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/long-memory test -- lm1-promotion-read.test.ts`. Expected: FAIL (module does not exist).
- [ ] **Step 3: Implement**

~~~ts
export async function listCurrentStateForPromotion(
  input: ListCurrentStateForPromotionInput,
): Promise<readonly Lm1PromotionCandidate[]> {
  const parsed = parseInput(input); // Lm1Error("invalid_input") on bad shape; maxAgeDays int 1..3650
  const store = createFileLm1Store({ storeRoot: parsed.storeRoot });
  // Reuse the bounded scan + selectCurrentStateSnapshots exactly as lm1-recall.ts
  // does; resolve evidence for each winning leaf through evidenceEligibility with
  // the shared 512-distinct-id cap; any ineligible or over-cap group is omitted.
  // ageDays = floor((Date.parse(now) - Date.parse(observedAt)) / 86_400_000);
  // filter ageDays > maxAgeDays; sort by stateKey ordinal asc, then id asc.
}
~~~

  Export from `src/index.ts` (append only; no LM0/LM1 export removed). Extend `index.test-d.ts` type imports with `listCurrentStateForPromotion`, `Lm1PromotionCandidate`, `Lm1PromotionClock`, `ListCurrentStateForPromotionInput`.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/long-memory test -- lm1-promotion-read.test.ts index.test-d.ts && pnpm --filter @megasaver/long-memory typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(memory): add LM1 promotion read surface"`

### Task 2: Build promotion drafts with contradiction flags

**Files:**
- Create: packages/memory-recall/src/promotion.ts
- Create: packages/memory-recall/test/promotion.test.ts
- Modify: packages/memory-recall/src/index.ts

**Interfaces:**
- Consumes: `MemoryEntry`, `memoryEntrySchema` (@megasaver/core), `MemoryEntryId`, `memoryEntryIdSchema`, `ProjectId` (@megasaver/shared), `Lm1PromotionCandidate` (@megasaver/long-memory), `node:crypto` `createHash`.
- Produces:

~~~ts
export const PROMOTION_ID_DOMAIN = "megasaver.memory.promotion.v1";
export const PROMOTED_FACT_KEYWORD_PREFIX = "lm-fact:";
export function derivePromotedMemoryId(workspaceKey: string, snapshotId: string): MemoryEntryId;
export type PromotionContradiction = {
  stateKey: string;
  existingId: MemoryEntryId;
  draftId: MemoryEntryId;
};
export type BuildPromotionDraftsInput = {
  projectId: ProjectId;
  workspaceKey: string;
  candidates: readonly Lm1PromotionCandidate[];
  existing: readonly MemoryEntry[];
  now: string;
};
export type BuildPromotionDraftsResult = {
  drafts: readonly MemoryEntry[];
  contradictions: readonly PromotionContradiction[];
  unchanged: readonly MemoryEntryId[];
};
export function buildPromotionDrafts(input: BuildPromotionDraftsInput): BuildPromotionDraftsResult;
~~~

- [ ] **Step 1: Write failing builder tests** (mimic packages/memory-recall/test/rank-project-memories.test.ts setup style)

~~~ts
it("emits a schema-valid draft with complete §13 metadata", () => {
  const { drafts } = buildPromotionDrafts({
    projectId, workspaceKey: "0123456789abcdef",
    candidates: [candidate({ stateKey: "billing.status", text: "paid", evidenceIds: [evidenceA, evidenceB] })],
    existing: [], now: "2026-08-06T00:00:00.000Z",
  });
  const draft = memoryEntrySchema.parse(drafts[0]);
  expect(draft.approval).toBe("suggested");
  expect(draft.source).toBe("agent");
  expect(draft.scope).toBe("project");
  expect(draft.confidence).toBe("high"); // ≥2 evidence ids
  expect(draft.createdAt).toBe("2026-08-06T00:00:00.000Z");
  expect(draft.expiresAt).toBeNull(); // explicit null, never omitted
  expect(draft.keywords).toContain("lm-fact:billing.status");
  expect(draft.evidence).toEqual([snapshotId, evidenceA, evidenceB]);
});

it("derives the same id for the same snapshot and flags contradictions", () => {
  expect(derivePromotedMemoryId("0123456789abcdef", snapshotId))
    .toBe(derivePromotedMemoryId("0123456789abcdef", snapshotId));
  const { drafts, contradictions } = buildPromotionDrafts({
    projectId, workspaceKey: "0123456789abcdef",
    candidates: [candidate({ stateKey: "billing.status", text: "paid", evidenceIds: [evidenceA] })],
    existing: [approvedFact({ stateKey: "billing.status", content: "unpaid" })],
    now: "2026-08-06T00:00:00.000Z",
  });
  expect(drafts[0]?.supersedesId).toBe(contradictions[0]?.existingId);
  expect(drafts[0]?.confidence).toBe("medium"); // 1 evidence id
});

it("reports unchanged when an approved fact already matches", () => {
  // Equality contract is content-only: the shared `lm-fact:` keyword selects
  // the comparand; `content === snapshot.text` decides. Other fields
  // (confidence here) may differ and the fact still counts as unchanged.
  const existing = approvedFact({ stateKey: "billing.status", content: "paid", confidence: "low" });
  const { drafts, unchanged } = buildPromotionDrafts({
    projectId, workspaceKey: "0123456789abcdef",
    candidates: [candidate({ stateKey: "billing.status", text: "paid", evidenceIds: [evidenceA] })],
    existing: [existing], now: "2026-08-06T00:00:00.000Z",
  });
  expect(drafts).toEqual([]);
  expect(unchanged).toEqual([existing.id]); // reports the matching approved entry's id
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/memory-recall test -- promotion.test.ts`. Expected: FAIL (module does not exist).
- [ ] **Step 3: Implement** — pure function. Id derivation mirrors `deriveLm1RecordId` (packages/long-memory/src/lm1-identity.ts): SHA-256 over `PROMOTION_ID_DOMAIN + "\0" + workspaceKey + "\0" + snapshotId`, first 16 bytes, set version-5 and RFC-variant bits, render lowercase UUID, `memoryEntryIdSchema.parse`. Draft: `type: "architecture"`, `sessionId: null`, `title: "state: " + stateKey` truncated to 80 code units (a display/product choice — `titleSchema` in packages/shared/src/title.ts has no upper length bound, so any length would parse), content = `snapshot.text`, `keywords: [PROMOTED_FACT_KEYWORD_PREFIX + stateKey.toLowerCase()]`, `stale: false`, `createdAt`/`updatedAt` = `now`, `expiresAt: null`. Contradiction lookup: newest (by `updatedAt`) approved existing entry whose keywords contain the same `lm-fact:` keyword; different content ⇒ set `supersedesId` and record `PromotionContradiction`; equal content (content-only string equality on the keyword-matched entry) ⇒ push the matching entry's id to `unchanged`, no draft. Export from `src/index.ts`.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/memory-recall test -- promotion.test.ts && pnpm --filter @megasaver/memory-recall typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(memory): build promotion drafts"`

### Task 3: Fail-closed evidence eligibility adapter

**Files:**
- Create: apps/cli/src/lm/evidence-eligibility.ts
- Create: apps/cli/test/lm-evidence-eligibility.test.ts

**Interfaces:**
- Consumes: `loadEvidence` (@megasaver/evidence-ledger, signature `{ storeRoot, workspaceKey, evidenceId }`), `EvidenceEligibilityPort` (@megasaver/long-memory).
- Produces:

~~~ts
export function createLedgerEligibilityPort(input: {
  evidenceStoreRoot: string;
  load?: typeof loadEvidence; // test seam, mirrors the CLI's newId?/now? pattern
}): EvidenceEligibilityPort;
~~~

- [ ] **Step 1: Write failing adapter tests**

~~~ts
it("maps an available ledger record and fails closed on a missing one", async () => {
  const port = createLedgerEligibilityPort({
    evidenceStoreRoot: "/tmp/unused",
    load: async ({ evidenceId }) => {
      if (evidenceId === knownId)
        return recordFixture({
          status: "available",
          redactionReport: { redacted: true, highRiskFindings: 1, unresolvedHighRisk: true },
        });
      throw new Error("missing");
    },
  });
  const results = await port.resolve({ workspaceKey, evidenceIds: [knownId, unknownId] });
  expect(results).toEqual([
    // unresolvedHighRisk carried from record.redactionReport, not hardcoded
    { evidenceId: knownId, workspaceKey, status: "available", unresolvedHighRisk: true },
    { evidenceId: unknownId, workspaceKey, status: "revoked", unresolvedHighRisk: false },
  ]);
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- lm-evidence-eligibility.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — resolve each id sequentially via `load`; map the record's status onto the port's `available | retained_metadata_only | revoked`; `unresolvedHighRisk = record.redactionReport.unresolvedHighRisk` (a required field — packages/evidence-ledger/src/sub-schemas.ts:44-45 — so no absent case exists and no fallback is written, per §13); any throw ⇒ `{ status: "revoked", unresolvedHighRisk: false }`.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/cli test -- lm-evidence-eligibility.test.ts && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): add ledger eligibility adapter"`

### Task 4: Promoted-fact hints store

**Files:**
- Create: apps/cli/src/hooks/promoted-facts.ts
- Create: apps/cli/test/promoted-facts.test.ts

**Interfaces:**

~~~ts
export const MAX_PROMOTED_FACT_TERMS = 12;
export const MAX_PROMOTED_FACT_TERM_CODE_UNITS = 64;
export function writePromotedFactHints(
  storeRoot: string, workspaceKey: string, terms: readonly string[], ts: number,
): void;
export function readPromotedFactHints(
  storeRoot: string, workspaceKey: string,
): readonly string[] | undefined;
~~~

- [ ] **Step 1: Write failing hints tests** (mimic the atomic tmp+rename and Zod-read tests around `readSessionIntent`, per the intent-aware-hook spec §1/§3)

~~~ts
it("round-trips capped terms atomically and fails soft", () => {
  const root = mkdtempSync(join(tmpdir(), "megasaver-hints-"));
  writePromotedFactHints(root, wk, ["billing.status", "cache.mode"], 1);
  expect(readPromotedFactHints(root, wk)).toEqual(["billing.status", "cache.mode"]);
  expect(readPromotedFactHints(root, "feedfeedfeedfeed")).toBeUndefined();
  writeFileSync(hintsPath(root, wk), "not-json");
  expect(readPromotedFactHints(root, wk)).toBeUndefined();
});
it("caps to 12 terms of 64 code units and skips empty writes", () => {
  const root = mkdtempSync(join(tmpdir(), "megasaver-hints-"));
  const oversize = "x".repeat(65); // 65 code units: dropped whole, never truncated
  const valid = Array.from({ length: 14 }, (_, i) => `term.${i}`);
  writePromotedFactHints(root, wk, [oversize, ...valid], 1); // 15 terms in
  expect(readPromotedFactHints(root, wk)).toEqual(valid.slice(0, 12)); // drop first, then slice to 12
  writePromotedFactHints(root, "feedfeedfeedfeed", [], 1);
  expect(existsSync(hintsPath(root, "feedfeedfeedfeed"))).toBe(false); // empty ⇒ no file at all
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- promoted-facts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — file `<storeRoot>/stats/<workspaceKey>/promoted-facts.json` built with `node:path` `join`; write `{ terms, ts }` to `<file>.tmp` then `renameSync`; drop empty/oversize terms, slice to 12; empty result ⇒ no write. Read: `existsSync` guard, strict Zod `safeParse` on `{ terms: string[], ts: number }`, empty array or any failure ⇒ `undefined`. All best-effort try/catch.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/cli test -- promoted-facts.test.ts && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): add promoted-fact hints store"`

### Task 5: `mega memory promote` command

**Files:**
- Create: apps/cli/src/commands/memory/promote.ts
- Create: apps/cli/test/memory-promote.test.ts
- Modify: apps/cli/src/commands/memory/index.ts
- Modify: apps/cli/src/commands/memory/approve.ts

**Interfaces:**
- Consumes: `listCurrentStateForPromotion` (Task 1), `buildPromotionDrafts`, `projectWorkspaceKey` (@megasaver/memory-recall), `createLedgerEligibilityPort` (Task 3), `writePromotedFactHints` (Task 4), the same store-open sequence `runMemoryApprove` uses (`resolveStorePath` + `ensureStoreReady` + the same registry factory), `PROMOTED_FACT_KEYWORD_PREFIX`.
- Produces:

~~~ts
export type RunMemoryPromoteInput = {
  storeFlag?: string; cwd: string; home: string; xdgDataHome?: string;
  platform: NodeJS.Platform; localAppData?: string;
  maxAgeDays?: number; json?: boolean; now?: () => string;
};
export function runMemoryPromote(input: RunMemoryPromoteInput): Promise<0 | 1>;
~~~

- [ ] **Step 1: Write failing command tests** (mimic apps/cli/test/memory-approve.test.ts store fixture per workflows/cli-test-pattern; seed the LM1 store with the Task 1 capture fixture)

~~~ts
it("creates suggested drafts once and reports already-promoted on re-run", async () => {
  expect(await runMemoryPromote(promoteInput())).toBe(0);
  const created = registry.searchMemoryEntries(projectId, { text: "billing", includeUnapproved: true });
  expect(created[0]?.approval).toBe("suggested");
  expect(await runMemoryPromote(promoteInput())).toBe(0); // idempotent, no second row
  expect(registry.listMemoryEntries(projectId).filter(isLmFact)).toHaveLength(1);
});
it("keeps promoted facts out of default search until approved", async () => {
  await runMemoryPromote(promoteInput());
  expect(registry.searchMemoryEntries(projectId, { text: "billing" })).toEqual([]); // gate holds
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- memory-promote.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** — open store as `runMemoryApprove` does; workspace key = `projectWorkspaceKey(projectId)`; list candidates (`--max-age-days`, default 45) → `buildPromotionDrafts` with `existing = registry.listMemoryEntries(projectId)` → `registry.createMemoryEntry(draft)` per draft, catching the duplicate-id error as `already-promoted`; then refresh hints (`writePromotedFactHints` from all approved `lm-fact:` entries) and print created/already-promoted/unchanged/contradiction counts, `--json` parity. Register the subcommand in `commands/memory/index.ts`. In `runMemoryApprove`, after a flip on an entry whose keywords contain `PROMOTED_FACT_KEYWORD_PREFIX`, recompute and write hints (`applyApprovalFlip` itself stays untouched).
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/cli test -- memory-promote.test.ts memory-approve.test.ts && pnpm --filter @megasaver/cli typecheck && pnpm lint`. Expected: PASS, approve suite unchanged plus hints refresh.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): add mega memory promote"`

### Task 6: Saver fill-gap hint injection

**Files:**
- Modify: apps/cli/src/hooks/saver.ts
- Modify: apps/cli/src/hooks/saver-run.ts
- Modify: apps/cli/test/doctor-saver.test.ts (only if its `SaverDeps` fixture needs the new field)
- Create: apps/cli/test/saver-fact-hints.test.ts

**Interfaces:**
- `SaverDeps` (apps/cli/src/hooks/saver.ts) gains: `readPromotedFactHints: (storeRoot: string, workspaceKey: string) => readonly string[] | undefined;` — required field, wired in saver-run.ts to Task 4's reader (no optional shim; pre-1.0).

- [ ] **Step 1: Write failing precedence tests** (drive `buildSaverDecision` through the existing test harness for `readSessionIntent`, adding a stub `readPromotedFactHints`)

~~~ts
it("appends hint terms after session intent, fill-gap only", async () => {
  const deps = saverDeps({
    readSessionIntent: () => "fix billing bug",
    readPromotedFactHints: () => ["billing.status", "cache.mode"],
  });
  const decision = await buildSaverDecision(payload(), deps);
  expect(recordedInput(deps).intent).toBe("fix billing bug billing.status cache.mode");
});
it("is byte-identical to today when both sources are absent", async () => {
  const deps = saverDeps({
    readSessionIntent: () => undefined,
    readPromotedFactHints: () => undefined,
  });
  await buildSaverDecision(payload(), deps);
  expect("intent" in recordedInput(deps)).toBe(false);
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- saver-fact-hints.test.ts`. Expected: FAIL (`readPromotedFactHints` not in `SaverDeps`).
- [ ] **Step 3: Implement** — in `buildSaverDecision`, at the existing session-intent seam (the `sessionIntent` read and its conditional `intent` spread): compute `hintTerms = deps.readPromotedFactHints(deps.storeRoot, workspaceKey)`; fill-gap value = `[sessionIntent, ...(hintTerms ?? [])]` joined with single spaces, empty ⇒ omit the `intent` key entirely. `scoreChunk`, weights, and every other `record` field untouched. Wire the real reader in `saver-run.ts`.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/cli test -- saver-fact-hints.test.ts doctor-saver.test.ts && pnpm --filter @megasaver/cli typecheck`. Expected: PASS, existing saver suites green.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): rank saver output with fact hints"`

### Task 7: Kickoff fill-gap admission

**Files:**
- Modify: apps/cli/src/hooks/task-kickoff-pack.ts
- Create: apps/cli/test/task-kickoff-promoted.test.ts

**Interfaces:**
- Consumes: `TASK_KICKOFF_MAX_MEMORIES`, `eligibleMemory` (private), `isRecallable` (@megasaver/core), `PROMOTED_FACT_KEYWORD_PREFIX` (@megasaver/memory-recall).
- `renderTaskKickoffPack` signature unchanged; selection order inside changes only.

- [ ] **Step 1: Write failing admission tests** (fixture memories built with `memoryEntrySchema.parse`)

~~~ts
it("fills remaining slots with approved lm-facts, never displacing verified", async () => {
  const memories = [...verified(4), ...promotedFacts(3)]; // approved, non-stale, no lastVerified
  const pack = await renderTaskKickoffPack(packInput({ memories }));
  expect(countLines(pack.text, "state: ")).toBe(2); // 4 verified + 2 fill-gap = cap 6
});
it("excludes promoted facts when verified memories fill the cap", async () => {
  const pack = await renderTaskKickoffPack(packInput({ memories: [...verified(6), ...promotedFacts(2)] }));
  expect(countLines(pack.text, "state: ")).toBe(0);
});
it("never admits a suggested or stale lm-fact", async () => {
  // lmFact(overrides) = memoryEntrySchema.parse fixture with an "lm-fact:" keyword.
  const suggested = lmFact({ approval: "suggested" });
  const staleApproved = lmFact({ approval: "approved", stale: true });
  const rejected = await renderTaskKickoffPack(packInput({ memories: [suggested, staleApproved] }));
  expect(countLines(rejected.text, "state: ")).toBe(0); // slots free, still excluded
  const withLastVerified = lmFact({ approval: "approved", lastVerified: "2026-08-01T00:00:00.000Z" });
  const viaVerified = await renderTaskKickoffPack(packInput({ memories: [withLastVerified] }));
  expect(countLines(viaVerified.text, "state: ")).toBe(1); // admitted via the verified pool, not fill-gap
});
~~~

- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- task-kickoff-promoted.test.ts`. Expected: FAIL (promoted facts currently excluded by the `lastVerified` clause).
- [ ] **Step 3: Implement** — add a second selection pool after the `eligibleMemory` pass: entries where `isRecallable(memory, now)` and `!memory.stale` and `memory.lastVerified === undefined` and some keyword starts with `PROMOTED_FACT_KEYWORD_PREFIX`; append deterministically (existing ordinal ordering) up to the remaining `TASK_KICKOFF_MAX_MEMORIES` slots. Caps `TASK_KICKOFF_TOKEN_CAP` / `TASK_KICKOFF_CHARACTER_CAP` unchanged.
- [ ] **Step 4: Run green** — `pnpm --filter @megasaver/cli test -- task-kickoff-promoted.test.ts && pnpm --filter @megasaver/cli test -- task-kickoff && pnpm lint`. Expected: PASS incl. existing kickoff suites.
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): fill kickoff slots with lm facts"`

### Task 8: GA acceptance fixtures, boundary proof, release evidence

**Files:**
- Create: apps/cli/test/long-memory-ga-acceptance.test.ts
- Modify: packages/long-memory/test/lm1-dependency-boundary.test.ts
- Create: .changeset/long-memory-ga.md

**Interfaces:** none new — exercises Tasks 1–7 end to end.

- [ ] **Step 1: Write failing acceptance fixtures** — one test per LongMemEval-V2 ability row of the spec table, all local, model-free, no network:
  - static state: capture → promote → approve → fact line present in `renderTaskKickoffPack` output;
  - dynamic state: correction chain → only newest leaf promotes; approving the successor closes the predecessor (`supersedesId` honored via `applyApprovalFlip`);
  - premise (partial): contradiction reported and predecessor absent from default `searchMemoryEntries` after approval;
  - workflow/gotcha: assert an explicit skip marker referencing the spec's LM3 deferral (`it.todo`), so the deferral is visible, not hidden;
  - latency contract: structural only — assert candidate/evidence-lookup counts stay within the 10,000/512 caps on a 20-record fixture; no wall-clock.
- [ ] **Step 2: Run red** — `pnpm --filter @megasaver/cli test -- long-memory-ga-acceptance.test.ts`. Expected: FAIL until wiring settles.
- [ ] **Step 3: Implement/fix until green**; extend the dependency-boundary test to assert `lm1-promotion-read.ts` imports no `@megasaver/core`, connector, or benchmark module. Add the changeset (`@megasaver/long-memory` minor, `@megasaver/memory-recall` minor, `@megasaver/cli` minor).
- [ ] **Step 4: Full gate** — `pnpm verify` and the three package suites from Global Constraints; capture a `mega memory promote` + `mega memory approve` + kickoff smoke transcript as DoD §9.5 evidence.
- [ ] **Step 5: Commit** — `git commit -m "test(memory): add long-memory GA acceptance"`

## Plan self-review

- Coverage: spec components 1–7 map to Tasks 1–7; GA acceptance table maps to Task 8; hygiene (expiry Task 1, contradiction Task 2, metadata Task 2) covered.
- No placeholders: every referenced symbol is defined in a task or cited to a real path (`applyApprovalFlip`, `isRecallable`, `renderTaskKickoffPack`, `readSessionIntent`, `projectWorkspaceKey`, `loadEvidence`, `selectCurrentStateSnapshots`, `createFileLm1Store` all exist today).
- Type consistency: `Lm1PromotionCandidate` flows Task 1 → 2 → 5; `PROMOTED_FACT_KEYWORD_PREFIX` flows Task 2 → 5 → 7; hints reader flows Task 4 → 5 → 6.
- Spec ASSUMPTIONS carried verbatim: brain-digest hints staleness, single `type` mapping. The former title-bound and `unresolvedHighRisk` assumptions are now verified facts (titleSchema has no upper bound; `redactionReport.unresolvedHighRisk` is required) and carry no fallback.
- No timing-tight tests; injected clocks everywhere; no network; no paid API calls in CI.
