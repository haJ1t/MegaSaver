# Memory Write-Verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the spec `docs/superpowers/specs/2026-08-06-memory-write-verify-design.md`: (a) a deterministic write gate for agent-sourced memory entries (`source: "agent" | "test_failure"`) and FORGE rules — evidence pointers must resolve and the claim must not contradict approved memory before persist, with failures landing as `approval: "suggested"` (never dropped, never auto-approved); (b) trust tiers — verification outcome caps the stored `confidence` at write time; (c) TTL — gated entries and auto-written rules get a default `expiresAt` (90d) that `mega memory sweep` enforces losslessly (archive, never delete).

**Architecture:** A new pure core module `packages/core/src/write-verify.ts` (`verifyMemoryWrite`: candidate + approved-active corpus + plain-data pointer resolutions → `{ outcome, reasons, confidence, approval, validationStatus, conflictIds }`). All IO stays in a new mcp-bridge resolver `packages/mcp-bridge/src/write-verify-resolver.ts` (`resolveWritePointers`: classify per Decision 3, resolve ledger ids via the existing `resolveEvidenceForMemory` (packages/mcp-bridge/src/evidence-resolver.ts:12) and chunk-set ids via `locateChunkSet` (re-exported by core at packages/core/src/context-gate.ts:12), return plain data). `handleSaveMemory` (packages/mcp-bridge/src/tools/save-memory.ts:102) wires the gate between schema-parse and `saveMemoryWithLineage`; verdicts land in the existing validation sidecar via `registry.setMemoryValidation` (packages/core/src/registry.ts:147, schema packages/core/src/memory-validation.ts:5) with `validatedBy: "system"`. `convert_failure_to_rule` (packages/mcp-bridge/src/tools/convert-failure-to-rule.ts:41) runs the same resolver (evidence only) and stamps confidence cap + `verification` + `expiresAt` onto the rule; `sweepMemoryTiers` (packages/core/src/memory-entry.ts:252) gains the expiry condition; `rankApplicableRules` (packages/core/src/project-rule-ranking.ts:36) gains optional `asOf`; `runMemorySweep` (apps/cli/src/commands/memory/sweep.ts:35) reports `expired=` / `rulesExpired=`. `approve_memory` stays the ONLY promotion path — untouched.

**Tech Stack:** TypeScript strict ESM (NodeNext, `exactOptionalPropertyTypes` — use conditional spreads for optional fields), Zod schemas at boundaries, Vitest (pinned ISO clocks, no wall-clock timing assertions), pnpm workspaces + Turborepo, Biome.

## Global Constraints

- Risk: **HIGH** (§12). Work in worktree `feat/memory-write-verify`; no `main` edits. `code-reviewer` AND `critic` separate passes; author ≠ reviewer.
- **Do NOT** touch: `approve-memory.ts` promotion semantics (`suggested` stays a rejected input there — packages/mcp-bridge/src/tools/approve-memory.ts:44), `effectiveConfidence` (read-time only, packages/core/src/memory-entry.ts:224), `isRecallable` (packages/core/src/memory-entry.ts:176), `memoryEntrySchema` fields (`expiresAt` already exists at packages/core/src/memory-entry.ts:98). No deletion of expired rows anywhere — expiry is read-exclusion (rules) + lossless tier demotion (entries). No `updateProjectRule`/delete API.
- Escalation triggers (stop and re-scope): any expired-row DELETION, any `isRecallable` change, any auto-approval shortcut.
- Delineation: `long-memory-ga` owns observation→fact promotion (`mega memory promote`); this feature gates only DIRECT agent writes at the MCP boundary. Do not double-gate promotion drafts.
- The gate is TOTAL: a resolver throw makes that pointer unresolved (reason recorded); the write itself NEVER fails because of the gate. Sidecar write is best-effort after persist. `sweepMemoryTiers` keeps its fail-loud invalid-`now` TypeError (packages/core/src/memory-entry.ts:261).
- Regression invariant (architect B1-amended): the `save_memory` MCP boundary FORCES `source: "agent"` (caller value overridden, key still accepted) — no agent can dodge the gate with `source: "manual"`. The byte-identical invariant applies to DIRECT-registry callers (CLI `memory create`): untouched, gate inert, no sidecar.
- Architect-fixed contract deltas (2026-08-16 re-review): (a) chunk-set pointers are project/session-bound WITH A LAYOUT BRANCH — `locateChunkSet` result must match: registry layout ⇒ the entry's projectId (and sessionId when the entry has one); overlay layout ⇒ `encodeWorkspaceKey(projectRootPath)` (and liveSessionId when the entry has one); mismatch ⇒ `hasCrossWorkspace: true` + `resolved: false, reason: "cross_workspace"`; (b) non-UUID ledger candidates ⇒ `invalid_pointer` with NO ledger IO; (c) `evidence` input capped `.max(32)`; (d) `fileOverlap` params narrow to `ConflictCandidate` too (conflict-checker.ts:21 would otherwise fail typecheck); (e) existing-suite GREEN deltas are PRE-DECLARED in Task 4/5 (no mid-GREEN discovery); (f) approve-gate composition is integration-tested (documented `missing_evidence` dead-end for zero-evidence writes).
- Import-cycle rule (no circular imports, §8): `write-verify.ts` may import only leaf modules (`memory-entry.js`, `conflict-checker.js`, `validation-status.js`, `@megasaver/shared`). Because `registry.ts` and `project-rule.ts` will import from `write-verify.ts`, the constant `POSSIBLE_SUPERSEDES_PREFIX` (currently packages/core/src/supersession.ts:42; supersession.ts imports registry.js) moves INTO `write-verify.ts` and `supersession.ts` re-exports it — existing importers and the `@megasaver/core` index surface stay unchanged.
- Commits: Conventional Commits, subject ≤ 50 chars, one logical change per task, `caveman-commit` style.
- Every task: RED first (run the named test, watch it fail), then GREEN, then `pnpm verify` before commit.
- ASSUMPTION markers below flag decisions the spec leaves open; do not silently widen them.

---

### Task 1: Core write-verify verdict (pure rubric, classification, TTL policy)

**Files:**
- Create: `packages/core/src/write-verify.ts`
- Create: `packages/core/test/write-verify.test.ts`
- Edit: `packages/core/src/conflict-checker.ts` (type-level Pick-narrowing only; behavior and call sites unchanged — packages/core/src/conflict-checker.ts:26)
- Edit: `packages/core/src/supersession.ts` (move `POSSIBLE_SUPERSEDES_PREFIX` declaration out; import + re-export from `./write-verify.js`)
- Edit: `packages/core/src/index.ts` (named export block, matching the style at packages/core/src/index.ts:30)

**Interfaces:**

```ts
// packages/core/src/write-verify.ts
export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";
export const writeVerifyOutcomeSchema = z.enum(["verified", "partial", "unverified"]);
export type WriteVerifyOutcome = z.infer<typeof writeVerifyOutcomeSchema>;
export type EvidencePointerKind = "lineage_note" | "chunk_set" | "ledger";
export function classifyEvidencePointer(evidence: string): EvidencePointerKind;
export type PointerResolution = {
  pointer: string;
  kind: Exclude<EvidencePointerKind, "lineage_note">;
  resolved: boolean;
  reason?: string;
};
export type WriteResolution = {
  resolutions: readonly PointerResolution[];
  unresolvedSecret: boolean;
  hasRevoked: boolean;
  hasCrossWorkspace: boolean;
  resolverUnavailable: boolean;
};
export type WriteVerifyInput = {
  candidate: ConflictCandidate;               // narrowed type from conflict-checker
  callerConfidence: MemoryConfidence;
  callerApproval: MemoryApproval;
  approvedActive: readonly ConflictCandidate[];
  resolution: WriteResolution;
  droppedCitedFiles: readonly string[];
};
export type WriteVerifyVerdict = {
  outcome: WriteVerifyOutcome;
  reasons: readonly string[];
  confidence: MemoryConfidence;
  approval: MemoryApproval;
  validationStatus: "valid" | "needs_approval" | "quarantined";
  conflictIds: readonly MemoryEntryId[];
};
export function verifyMemoryWrite(input: WriteVerifyInput): WriteVerifyVerdict;
export const WRITE_VERIFY_CONFIDENCE_CAP: Record<WriteVerifyOutcome, MemoryConfidence>;
export function minConfidence(a: MemoryConfidence, b: MemoryConfidence): MemoryConfidence;
export const WRITE_VERIFY_DEFAULT_TTL_DAYS = 90;
export function defaultWriteExpiresAt(createdAt: string): string; // createdAt + 90d, TypeError on invalid input
// ruleVerificationSchema lives here too (rule stamp, Task 2 wires it into projectRuleSchema):
export const ruleVerificationSchema: z.ZodObject<...>; // { outcome, reasons: string[], verifiedAt } .strict()
export type RuleVerification = z.infer<typeof ruleVerificationSchema>;
```

```ts
// packages/core/src/conflict-checker.ts — type-level narrowing (Decision 2).
// checkConflicts already reads ONLY these six fields (verified: lines 26-72).
export type ConflictCandidate = Pick<
  MemoryEntry,
  "id" | "type" | "title" | "content" | "keywords" | "relatedFiles"
>;
export function checkConflicts(
  candidate: ConflictCandidate,
  approvedActive: readonly ConflictCandidate[],
): ConflictResult;
```

Rubric (spec Decision 4, deterministic; caps never raise):
1. Hard flags — `unresolvedSecret`, `hasRevoked`, `hasCrossWorkspace`, conflict outcome `contradiction` (from `checkConflicts(candidate, approvedActive)`) — force `outcome: "unverified"`.
2. Else if ≥1 recognized pointer AND every resolution `resolved` AND `droppedCitedFiles` empty ⇒ `verified`.
3. Else if ≥1 resolution resolved ⇒ `partial`.
4. Else ⇒ `unverified` (zero pointers included; reason `zero_evidence_pointers`).
- `confidence = minConfidence(callerConfidence, cap)` with cap verified→high, partial→medium, unverified→low.
- `approval`: outcome ≠ `verified` ⇒ forced `"suggested"`; else `callerApproval` passes through.
- `validationStatus`: verified→`valid`, partial→`needs_approval`, unverified→`quarantined` (values exist in `validationStatusSchema`, packages/core/src/validation-status.ts).
- `reasons` (fixed order, deterministic): hard-flag reasons `unresolved_secret` / `revoked_evidence` / `cross_workspace_evidence` / `conflict_contradiction` (+ `conflict.reasons` pass-through on contradiction), then `resolver_unavailable` when flagged, then each unresolved pointer's `reason ?? \`unresolved:${pointer}\``, then `anchor_dropped:<file>` per dropped cited file, then `zero_evidence_pointers` when no recognized pointer.
- Classification (Decision 3, closed-form): `POSSIBLE_SUPERSEDES_PREFIX`-prefixed ⇒ `lineage_note`; `/^cs-[0-9a-f]{32}$/` ⇒ `chunk_set` (saver-minted ids, apps/cli/src/hooks/saver.ts:425); else ⇒ `ledger`.

**Steps:**

- [ ] Write the RED test `packages/core/test/write-verify.test.ts` (style mirrors packages/core/test/conflict-checker.test.ts):

```ts
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import {
  type WriteResolution,
  WRITE_VERIFY_DEFAULT_TTL_DAYS,
  classifyEvidencePointer,
  defaultWriteExpiresAt,
  verifyMemoryWrite,
} from "../src/write-verify.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CAND_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_ID = "33333333-3333-4333-8333-333333333333";
const CS_ID = `cs-${"a".repeat(32)}`;
const LEDGER_ID = "44444444-4444-4444-8444-444444444444";

const mk = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
  ({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "use pnpm not npm",
    keywords: ["pnpm"],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }) as MemoryEntry;

const resolution = (over: Partial<WriteResolution> = {}): WriteResolution => ({
  resolutions: [],
  unresolvedSecret: false,
  hasRevoked: false,
  hasCrossWorkspace: false,
  resolverUnavailable: false,
  ...over,
});

const base = {
  candidate: mk(CAND_ID),
  callerConfidence: "high" as const,
  callerApproval: "approved" as const,
  approvedActive: [],
  droppedCitedFiles: [],
};

describe("classifyEvidencePointer (closed-form, Decision 3)", () => {
  it.each([
    ["possible-supersedes:xyz", "lineage_note"],
    [CS_ID, "chunk_set"],
    ["cs-not-32-hex", "ledger"],
    [LEDGER_ID, "ledger"],
  ])("%s -> %s", (pointer, kind) => {
    expect(classifyEvidencePointer(pointer)).toBe(kind);
  });
});

describe("verifyMemoryWrite rubric (Decision 4)", () => {
  it("all pointers resolve, nothing dropped -> verified; caller approval passes through", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: CS_ID, kind: "chunk_set", resolved: true },
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
        ],
      }),
    });
    expect(v.outcome).toBe("verified");
    expect(v.confidence).toBe("high");
    expect(v.approval).toBe("approved");
    expect(v.validationStatus).toBe("valid");
  });

  it("zero recognized pointers -> unverified + low + forced suggested + quarantined", () => {
    const v = verifyMemoryWrite({ ...base, resolution: resolution() });
    expect(v.outcome).toBe("unverified");
    expect(v.confidence).toBe("low");
    expect(v.approval).toBe("suggested");
    expect(v.validationStatus).toBe("quarantined");
    expect(v.reasons).toContain("zero_evidence_pointers");
  });

  it("one of two resolves -> partial, medium cap, needs_approval, forced suggested", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
          { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
        ],
      }),
    });
    expect(v.outcome).toBe("partial");
    expect(v.confidence).toBe("medium");
    expect(v.approval).toBe("suggested");
    expect(v.validationStatus).toBe("needs_approval");
    expect(v.reasons).toContain("chunk_set_not_found");
  });

  it.each([
    ["unresolvedSecret", { unresolvedSecret: true }, "unresolved_secret"],
    ["hasRevoked", { hasRevoked: true }, "revoked_evidence"],
    ["hasCrossWorkspace", { hasCrossWorkspace: true }, "cross_workspace_evidence"],
  ] as const)("hard flag %s -> unverified even when every pointer resolves", (_n, flags, reason) => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        ...flags,
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("unverified");
    expect(v.confidence).toBe("low");
    expect(v.reasons).toContain(reason);
  });

  it("contradiction against the approved corpus is a hard flag with conflictIds", () => {
    // existing type=decision vs candidate project_rule + shared file + negation
    // divergence -> contradiction branch (conflict-checker.ts:55-69).
    const approved = mk(APPROVED_ID, {
      content: "tests must pass before merge",
      keywords: ["merge", "pass"],
    });
    const v = verifyMemoryWrite({
      ...base,
      candidate: mk(CAND_ID, {
        type: "project_rule",
        content: "merge without waiting for tests",
        keywords: ["merge", "skip"],
      }),
      approvedActive: [approved],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("unverified");
    expect(v.reasons).toContain("conflict_contradiction");
    expect(v.conflictIds).toEqual([APPROVED_ID]);
  });

  it("a supersession conflict is NOT a hard flag — resolving pointers still verify", () => {
    const approved = mk(APPROVED_ID, { content: "use npm not pnpm", keywords: ["npm"] });
    const v = verifyMemoryWrite({
      ...base,
      approvedActive: [approved],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("verified");
  });

  it("caps never raise: verified caller-low stays low; partial caller-high drops to medium", () => {
    const verified = verifyMemoryWrite({
      ...base,
      callerConfidence: "low",
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(verified.confidence).toBe("low");
    const partial = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: true },
          { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
        ],
      }),
    });
    expect(partial.confidence).toBe("medium");
  });

  it("a cited file dropped by the anchor blocks verified (partial when a pointer resolves)", () => {
    const v = verifyMemoryWrite({
      ...base,
      droppedCitedFiles: ["src/ghost.ts"],
      resolution: resolution({
        resolutions: [{ pointer: LEDGER_ID, kind: "ledger", resolved: true }],
      }),
    });
    expect(v.outcome).toBe("partial");
    expect(v.reasons).toContain("anchor_dropped:src/ghost.ts");
  });

  it("resolver unavailable -> never verified, reason resolver_unavailable (Decision 5)", () => {
    const v = verifyMemoryWrite({
      ...base,
      resolution: resolution({
        resolverUnavailable: true,
        resolutions: [
          { pointer: LEDGER_ID, kind: "ledger", resolved: false, reason: "resolver_unavailable" },
        ],
      }),
    });
    expect(v.outcome).toBe("unverified");
    expect(v.approval).toBe("suggested");
    expect(v.reasons).toContain("resolver_unavailable");
  });
});

describe("defaultWriteExpiresAt (Decision 6)", () => {
  it("stamps createdAt + 90 days", () => {
    expect(WRITE_VERIFY_DEFAULT_TTL_DAYS).toBe(90);
    expect(defaultWriteExpiresAt("2026-08-01T00:00:00.000Z")).toBe("2026-10-30T00:00:00.000Z");
  });
  it("fails loud on an invalid createdAt", () => {
    expect(() => defaultWriteExpiresAt("not-a-date")).toThrowError(TypeError);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/core exec vitest run test/write-verify.test.ts` — fails (module `../src/write-verify.js` does not exist).
- [ ] Implement `packages/core/src/write-verify.ts` per the interfaces above, exactly per the code below (no stubs):

```ts
import type { MemoryEntryId } from "@megasaver/shared";
import { z } from "zod";
import { type ConflictCandidate, checkConflicts } from "./conflict-checker.js";
import type { MemoryApproval, MemoryConfidence } from "./memory-entry.js";

export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";
const CHUNK_SET_POINTER = /^cs-[0-9a-f]{32}$/;
const CONFIDENCE_RANK: Record<MemoryConfidence, number> = { low: 0, medium: 1, high: 2 };
export const WRITE_VERIFY_CONFIDENCE_CAP: Record<WriteVerifyOutcome, MemoryConfidence> = {
  verified: "high",
  partial: "medium",
  unverified: "low",
};
const SIDECAR_STATUS = {
  verified: "valid",
  partial: "needs_approval",
  unverified: "quarantined",
} as const;

export function minConfidence(a: MemoryConfidence, b: MemoryConfidence): MemoryConfidence {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

export function classifyEvidencePointer(evidence: string): EvidencePointerKind {
  if (evidence.startsWith(POSSIBLE_SUPERSEDES_PREFIX)) return "lineage_note";
  if (CHUNK_SET_POINTER.test(evidence)) return "chunk_set";
  return "ledger";
}

export function verifyMemoryWrite(input: WriteVerifyInput): WriteVerifyVerdict {
  const conflict = checkConflicts(input.candidate, input.approvedActive);
  const r = input.resolution;
  const reasons: string[] = [];
  if (r.unresolvedSecret) reasons.push("unresolved_secret");
  if (r.hasRevoked) reasons.push("revoked_evidence");
  if (r.hasCrossWorkspace) reasons.push("cross_workspace_evidence");
  if (conflict.outcome === "contradiction") {
    reasons.push("conflict_contradiction", ...conflict.reasons);
  }
  const hardFlagged = reasons.length > 0;
  if (r.resolverUnavailable) reasons.push("resolver_unavailable");
  for (const p of r.resolutions) {
    if (!p.resolved) reasons.push(p.reason ?? `unresolved:${p.pointer}`);
  }
  for (const f of input.droppedCitedFiles) reasons.push(`anchor_dropped:${f}`);
  if (r.resolutions.length === 0) reasons.push("zero_evidence_pointers");

  const resolvedCount = r.resolutions.filter((p) => p.resolved).length;
  const outcome: WriteVerifyOutcome = hardFlagged
    ? "unverified"
    : r.resolutions.length > 0 &&
        resolvedCount === r.resolutions.length &&
        input.droppedCitedFiles.length === 0
      ? "verified"
      : resolvedCount >= 1
        ? "partial"
        : "unverified";
  return {
    outcome,
    reasons,
    confidence: minConfidence(input.callerConfidence, WRITE_VERIFY_CONFIDENCE_CAP[outcome]),
    approval: outcome === "verified" ? input.callerApproval : "suggested",
    validationStatus: SIDECAR_STATUS[outcome],
    conflictIds: conflict.outcome === "contradiction" ? conflict.conflictIds : [],
  };
}

export const WRITE_VERIFY_DEFAULT_TTL_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
export function defaultWriteExpiresAt(createdAt: string): string {
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) throw new TypeError(`defaultWriteExpiresAt: invalid createdAt: ${createdAt}`);
  return new Date(at + WRITE_VERIFY_DEFAULT_TTL_DAYS * DAY_MS).toISOString();
}

export const ruleVerificationSchema = z
  .object({
    outcome: writeVerifyOutcomeSchema,
    reasons: z.array(z.string()),
    verifiedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RuleVerification = z.infer<typeof ruleVerificationSchema>;
```

  ASSUMPTION: the spec's Decision 7 names an additive `verification` field on `projectRuleSchema` but locks no shape; `{ outcome, reasons, verifiedAt }` `.strict()` is chosen here (mirrors the memory validation sidecar's system stamp, packages/core/src/memory-validation.ts:5, minus entry-only fields).
- [ ] Apply the `ConflictCandidate` Pick-narrowing in `packages/core/src/conflict-checker.ts` (type-level only): BOTH `checkConflicts` params AND `fileOverlap`'s params (conflict-checker.ts:21 — `fileOverlap(a: MemoryEntry, b: MemoryEntry)`; its call sites at :45/:61 pass the narrowed candidates, so narrowing the params is required to typecheck). The `norm` bodies and both existing call sites — approve-memory.ts:136 and supersession internals — compile unchanged.
- [ ] Move `POSSIBLE_SUPERSEDES_PREFIX` out of `packages/core/src/supersession.ts:42`: delete the local declaration, add `import { POSSIBLE_SUPERSEDES_PREFIX } from "./write-verify.js";` plus `export { POSSIBLE_SUPERSEDES_PREFIX };` so every existing importer and the index surface keep working (avoids the cycle registry → write-verify → supersession → registry).
- [ ] Export the new module from `packages/core/src/index.ts` (named exports: `verifyMemoryWrite`, `classifyEvidencePointer`, `minConfidence`, `defaultWriteExpiresAt`, `WRITE_VERIFY_CONFIDENCE_CAP`, `WRITE_VERIFY_DEFAULT_TTL_DAYS`, `writeVerifyOutcomeSchema`, `ruleVerificationSchema`, and the types `WriteVerifyOutcome`, `WriteVerifyInput`, `WriteVerifyVerdict`, `WriteResolution`, `PointerResolution`, `EvidencePointerKind`, `RuleVerification`, `ConflictCandidate`).
- [ ] GREEN: `pnpm --filter @megasaver/core exec vitest run test/write-verify.test.ts` — all pass. Then `pnpm --filter @megasaver/core test` (no regression in conflict-checker/supersession suites).
- [ ] `pnpm verify`
- [ ] Commit: `feat(core): add write-verify verdict rubric`

---

### Task 2: Core TTL enforcement — sweep expiry, rule schema, ranking asOf

**Files:**
- Edit: `packages/core/src/memory-entry.ts` (`sweepMemoryTiers`, line 252)
- Edit: `packages/core/src/project-rule.ts` (`projectRuleSchema` line 18, `failureToRuleInputSchema` line 38)
- Edit: `packages/core/src/project-rule-ranking.ts` (`applicableRuleQuerySchema` line 23, `rankApplicableRules` line 36)
- Edit: `packages/core/src/registry.ts` (in-memory `convertFailureToRule`, line 582) and `packages/core/src/json-directory-registry.ts` (line 546) — the two impls already duplicate this method verbatim; mirror the change in both.
- Edit tests (extend, no duplicate suites): `packages/core/test/memory-tier-decay.test.ts`, `packages/core/test/project-rule-ranking.test.ts`, `packages/core/test/registry-forge.test.ts`, `packages/core/test/forge-schemas.test.ts`

**Interfaces:**

```ts
// memory-entry.ts — return type gains expiredIds (additive; existing callers
// destructure archiveIds only: sweep-memory.ts:33, apps/cli sweep.ts:95)
export function sweepMemoryTiers(
  entries: readonly MemoryEntry[],
  now: string,
  policy: SweepPolicy = DEFAULT_SWEEP_POLICY,
): { archiveIds: MemoryEntry["id"][]; expiredIds: MemoryEntry["id"][] };

// project-rule.ts — additive fields; legacy rows parse untouched (both optional)
projectRuleSchema: + expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
                   + verification: ruleVerificationSchema.optional(),
failureToRuleInputSchema: + expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
                          + verification: ruleVerificationSchema.optional(),

// project-rule-ranking.ts — optional asOf; absent ⇒ unfiltered (byte-identical)
export type ApplicableRuleQuery = { task?: string; files?: readonly string[]; limit?: number; asOf?: string };
```

ASSUMPTION: the spec's Decision 6 names only `expiresAt` gaining `.nullable()` on `failureToRuleInputSchema`; the additional optional `verification` passthrough is required because the bridge handler stamps the verdict (Component 5) yet the spec forbids any `updateProjectRule` API (Decision 7) — the stamp can only travel through `convertFailureToRule`'s input. Registry-side TTL stays engine-owned (Component 6).

**Steps:**

- [ ] RED tests. Append to `packages/core/test/memory-tier-decay.test.ts`:

```ts
describe("sweepMemoryTiers expiry (TTL M3, pinned now)", () => {
  const NOW = "2026-08-01T00:00:00.000Z";
  const row = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry =>
    ({
      id,
      projectId: "11111111-1111-4111-8111-111111111111",
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "t",
      content: "c",
      keywords: [],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
      ...over,
    }) as MemoryEntry;

  it("archives a past-expiresAt row and reports it in expiredIds", () => {
    const { archiveIds, expiredIds } = sweepMemoryTiers(
      [row("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { expiresAt: "2026-07-31T00:00:00.000Z" })],
      NOW,
    );
    expect(archiveIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(expiredIds).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  });

  it("null or absent expiresAt never expires", () => {
    const { archiveIds, expiredIds } = sweepMemoryTiers(
      [
        row("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { expiresAt: null }),
        row("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
      ],
      NOW,
    );
    expect(archiveIds).toEqual([]);
    expect(expiredIds).toEqual([]);
  });

  it("working tier is exempt even when expired", () => {
    const { archiveIds, expiredIds } = sweepMemoryTiers(
      [
        row("dddddddd-dddd-4ddd-8ddd-dddddddddddd", {
          tier: "working",
          expiresAt: "2026-07-31T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(archiveIds).toEqual([]);
    expect(expiredIds).toEqual([]);
  });

  it("is idempotent — an already-archival expired row is not re-planned", () => {
    const { archiveIds } = sweepMemoryTiers(
      [
        row("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", {
          tier: "archival",
          expiresAt: "2026-07-31T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(archiveIds).toEqual([]);
  });
});
```

  Append to `packages/core/test/project-rule-ranking.test.ts` (build full rule literals; do not widen the existing `rule()` helper):

```ts
describe("rankApplicableRules asOf (rule TTL read-exclusion)", () => {
  const full = (id: string, over: Partial<ProjectRule> = {}): ProjectRule =>
    ({
      id,
      projectId: PROJECT_ID as ProjectRule["projectId"],
      title: "title",
      rule: "do the thing",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
      ...over,
    }) as ProjectRule;

  it("asOf excludes an expired rule; null expiry survives", () => {
    const live = full("b0000000-0000-4000-8000-000000000011", { expiresAt: null });
    const expired = full("b0000000-0000-4000-8000-000000000012", {
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    const out = rankApplicableRules([live, expired], { asOf: "2026-07-01T00:00:00.000Z" });
    expect(out.map((r) => r.rule.id)).toEqual([live.id]);
  });

  it("absent asOf leaves the result identical to today (back-compat)", () => {
    const live = full("b0000000-0000-4000-8000-000000000011");
    const expired = full("b0000000-0000-4000-8000-000000000012", {
      expiresAt: "2026-06-01T00:00:00.000Z",
    });
    const out = rankApplicableRules([live, expired], {});
    expect(out.map((r) => r.rule.id)).toEqual([live.id, expired.id]);
  });
});
```

  Append to the dual-impl `suite()` body in `packages/core/test/registry-forge.test.ts` (runs against BOTH in-memory and json-directory registries):

```ts
    it("convertFailureToRule stamps createdAt + 90d when expiresAt absent", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const { rule } = r.convertFailureToRule(
        FA_ID,
        { title: "no npm", rule: "use pnpm", severity: "warning" },
        clock,
      );
      expect(rule.expiresAt).toBe("2026-09-10T00:00:00.000Z"); // TS (2026-06-12) + 90d
    });

    it("convertFailureToRule respects an explicit expiresAt: null (no expiry)", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const { rule } = r.convertFailureToRule(
        FA_ID,
        { title: "no npm", rule: "use pnpm", severity: "warning", expiresAt: null },
        clock,
      );
      expect(rule.expiresAt).toBeNull();
    });

    it("convertFailureToRule passes the verification stamp through (both impls — json-directory round-trip included)", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const { rule } = r.convertFailureToRule(
        FA_ID,
        {
          title: "no npm",
          rule: "use pnpm",
          severity: "warning",
          verification: {
            outcome: "unverified",
            reasons: ["resolver_unavailable"],
            verifiedAt: "2026-06-12T00:00:00.000Z",
          },
        },
        clock,
      );
      expect(rule.verification).toEqual({
        outcome: "unverified",
        reasons: ["resolver_unavailable"],
        verifiedAt: "2026-06-12T00:00:00.000Z",
      });
      const reloaded = r.getProjectRule(rule.id);
      expect(reloaded?.verification?.outcome).toBe("unverified"); // persisted, not memory-only
    });
```

  Append to `packages/core/test/forge-schemas.test.ts`:

```ts
  it("legacy rule row without expiresAt/verification still parses (additive)", () => {
    const legacy = {
      id: "c0000000-0000-4000-8000-000000000009",
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "t",
      rule: "r",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    };
    const parsed = projectRuleSchema.parse(legacy);
    expect(parsed.expiresAt).toBeUndefined();
    expect(parsed.verification).toBeUndefined();
  });

  it("projectRuleSchema accepts additive expiresAt + verification", () => {
    const parsed = projectRuleSchema.parse({
      id: "c0000000-0000-4000-8000-000000000010",
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "t",
      rule: "r",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "low",
      createdFrom: "failed_attempt",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
      verification: {
        outcome: "unverified",
        reasons: ["zero_evidence_pointers"],
        verifiedAt: "2026-06-12T00:00:00.000Z",
      },
    });
    expect(parsed.verification?.outcome).toBe("unverified");
  });
```

- [ ] RED: `pnpm --filter @megasaver/core exec vitest run test/memory-tier-decay.test.ts test/project-rule-ranking.test.ts test/registry-forge.test.ts test/forge-schemas.test.ts` — new cases fail (missing `expiredIds`, unknown schema keys, no TTL stamp).
- [ ] Implement `sweepMemoryTiers` expiry: inside the existing loop (after the `working`/`archival` skip at memory-entry.ts:265, so both exemption and idempotence are preserved) add `const expired = entry.expiresAt != null && at >= Date.parse(entry.expiresAt);`, push to a new `expiredIds` when expired, and extend the archive condition to `closed || entry.stale || idleLowValue || expired`. Return `{ archiveIds, expiredIds }`. Keep the invalid-`now` TypeError untouched (memory-entry.ts:261).
- [ ] Implement the `projectRuleSchema` / `failureToRuleInputSchema` additive fields in `packages/core/src/project-rule.ts` (import `ruleVerificationSchema` from `./write-verify.js` — no cycle: write-verify imports no project-rule).
- [ ] Implement TTL stamping in BOTH `convertFailureToRule` impls (registry.ts:597 and json-directory-registry.ts:563, inside each `projectRuleSchema.parse({...})` input): `expiresAt: parsedInput.expiresAt !== undefined ? parsedInput.expiresAt : defaultWriteExpiresAt(clock.now()),` and `...(parsedInput.verification !== undefined ? { verification: parsedInput.verification } : {}),`.
- [ ] Implement `asOf` in `rankApplicableRules`: add `asOf: z.string().datetime({ offset: true }).optional()` to `applicableRuleQuerySchema`, and before any scoring filter `const active = q.asOf === undefined ? rules : rules.filter((r) => r.expiresAt == null || Date.parse(q.asOf) < Date.parse(r.expiresAt));` then use `active` in both the no-filter and scored branches. Absent `asOf` must leave output byte-identical.
- [ ] GREEN: rerun the four suites; then `pnpm --filter @megasaver/core test`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(core): enforce memory and rule TTL in sweep`

---

### Task 3: Bridge pointer resolver (`resolveWritePointers`)

**Files:**
- Create: `packages/mcp-bridge/src/write-verify-resolver.ts`
- Create: `packages/mcp-bridge/test/write-verify-resolver.test.ts`

**Interfaces:**

```ts
// packages/mcp-bridge/src/write-verify-resolver.ts
import { type PointerResolution, type WriteResolution, classifyEvidencePointer, locateChunkSet } from "@megasaver/core";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { resolveEvidenceForMemory } from "./evidence-resolver.js";

export async function resolveWritePointers(args: {
  storeRoot: string | undefined; // undefined ⇒ resolver_unavailable (Decision 5)
  evidence: readonly string[];
  projectRootPath: string;
  projectId: ProjectId;   // NEW (architect M2): chunk-set binding
  sessionId: SessionId | null; // NEW: bind only when the entry has one
}): Promise<WriteResolution>;
```

Behavior (Decision 3 + architect amendments):
- Classify each evidence string via `classifyEvidencePointer`; `lineage_note` entries are skipped entirely (not in `resolutions`).
- `storeRoot === undefined` ⇒ every recognized pointer `{ resolved: false, reason: "resolver_unavailable" }`, flags all false, `resolverUnavailable: true`.
- `chunk_set` ⇒ `locateChunkSet({ storeRoot, chunkSetId })` (read path only, packages/context-gate/src/locate-chunk-set.ts:20); miss ⇒ `resolved: false, reason: "chunk_set_not_found"`. HIT is not enough — bind per layout (architect N1): the located record is `{ layout: "registry"; projectId; sessionId }` or `{ layout: "overlay"; workspaceKey; liveSessionId }` (locate-chunk-set.ts:6-10). Registry ⇒ `projectId` must equal args' `projectId`, and when `args.sessionId !== null` the layout's `sessionId` must equal it. Overlay ⇒ `workspaceKey` must equal `encodeWorkspaceKey(args.projectRootPath)`, and when `args.sessionId !== null` the layout's `liveSessionId` must equal it. Any mismatch ⇒ `hasCrossWorkspace: true` + `{ resolved: false, reason: "cross_workspace" }`. IMPLEMENTATION NOTE (architect N6): check the expected paths first (`content/<projectId>/` walk for registry, `content/<workspaceKey>/` for overlay) before falling back to the store-wide walk, so a duplicated cs-id across projects can never be readdir-order dependent. On a direct-path hit (trivial when `sessionId !== null`: `existsSync` at `content/<projectId>/<sessionId>/<id>.json` or `content/<workspaceKey>/<liveSessionId>/<id>.json`), construct the binding record `{ layout, projectId/sessionId }` or `{ layout, workspaceKey, liveSessionId }` FROM THE ARGS — no `locateChunkSet` round-trip needed on the primary path; `locateChunkSet` remains the fallback for the store-wide search.
- `ledger` ⇒ UUID-shape check first (zod `z.string().uuid()` or equivalent safeParse — NO ledger IO on failure): non-UUID ⇒ `{ resolved: false, reason: "invalid_pointer" }`. UUID ⇒ `resolveEvidenceForMemory({ storeRoot, evidenceIds: [pointer], projectRootPath })` called PER POINTER so one throw never poisons the rest; OR-accumulate `unresolvedSecret`/`hasRevoked`/`hasCrossWorkspace` from each resolution; `resolved` iff `records.length === 1` (a revoked record loads — it resolves AND sets the hard flag; the rubric downgrades it). Miss reasons: `missingIds` non-empty ⇒ `"evidence_not_found"`; cross-workspace miss ⇒ `"cross_workspace"`; catch ⇒ `"resolver_error"`.
- The resolver reads existence/status only — never copies ledger content (spec §Security).

**Steps:**

- [ ] Write the RED test `packages/mcp-bridge/test/write-verify-resolver.test.ts` (fixture pattern mirrors packages/mcp-bridge/test/approve-memory.test.ts:427 `minimalInput`):

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvidenceRecordInput, appendEvidence, revokeEvidence } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWritePointers } from "../src/write-verify-resolver.js";

const ROOT_PATH = "/tmp/demo";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "99999999-9999-4999-8999-999999999999";
const TS = "2026-08-01T00:00:00.000Z";
const EV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CS_ID = `cs-${"a".repeat(32)}`;
const CS_MISSING = `cs-${"b".repeat(32)}`;
const WORKSPACE_KEY = encodeWorkspaceKey(ROOT_PATH);

function minimalInput(evidenceId: string): EvidenceRecordInput {
  return {
    evidenceId,
    workspaceKey: WORKSPACE_KEY,
    sessionRef: null,
    sourceKind: "command",
    sourceRef: { label: "test" },
    classification: "test",
    redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
    redactedRawChunkSetId: "cset-0000",
    returnedChunkRefs: [],
    createdAt: TS,
    expiresAt: null,
    retentionClass: "transient",
    policyVersion: "1.0",
    pipelineVersion: "1.0",
    redactedRawContent: "raw content",
    redactedReturnedContent: "returned content",
  };
}

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-wv-resolver-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("resolveWritePointers", () => {
  it("resolves a present ledger id and reports a missing one", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [EV_ID, MISSING_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: EV_ID, kind: "ledger", resolved: true },
      { pointer: MISSING_ID, kind: "ledger", resolved: false, reason: "evidence_not_found" },
    ]);
    expect(res.resolverUnavailable).toBe(false);
    expect(res.hasRevoked).toBe(false);
  });

  it("a revoked record resolves but raises the hard flag", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    await revokeEvidence({
      storeRoot,
      workspaceKey: WORKSPACE_KEY,
      evidenceId: EV_ID,
      reason: "policy_change",
      deleteChunk: async () => {},
      now: new Date(TS),
    });
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [EV_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasRevoked).toBe(true);
    expect(res.resolutions[0]?.resolved).toBe(true);
  });

  it("finds a same-project chunk-set id on disk and misses an absent one", async () => {
    // registry layout: content/<projectId>/<sessionId>/<chunkSetId>.json
    mkdirSync(join(storeRoot, "content", PROJECT_ID, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", PROJECT_ID, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID, CS_MISSING],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: true },
      { pointer: CS_MISSING, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
    ]);
  });

  it("a chunk-set id from ANOTHER project is a hard cross_workspace flag, never resolved (architect M2)", async () => {
    mkdirSync(join(storeRoot, "content", OTHER_PROJECT_ID, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", OTHER_PROJECT_ID, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "cross_workspace" },
    ]);
  });

  it("an overlay-layout chunk set in the SAME workspace resolves (architect N1)", async () => {
    // saver persist layout: content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json
    mkdirSync(join(storeRoot, "content", WORKSPACE_KEY, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", WORKSPACE_KEY, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(false);
    expect(res.resolutions).toEqual([{ pointer: CS_ID, kind: "chunk_set", resolved: true }]);
  });

  it("an overlay chunk set in ANOTHER workspace is a cross_workspace hard flag (architect N1)", async () => {
    mkdirSync(join(storeRoot, "content", "deadbeefdeadbeef", SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", "deadbeefdeadbeef", SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "cross_workspace" },
    ]);
  });

  it("a non-UUID ledger candidate is invalid_pointer with no ledger IO (architect m8/m10)", async () => {
    const res = await resolveWritePointers({
      storeRoot,
      evidence: ["../etc/passwd", "not a uuid"],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: "../etc/passwd", kind: "ledger", resolved: false, reason: "invalid_pointer" },
      { pointer: "not a uuid", kind: "ledger", resolved: false, reason: "invalid_pointer" },
    ]);
    expect(res.hasCrossWorkspace).toBe(false);
  });

  it("skips possible-supersedes lineage notes entirely", async () => {
    const res = await resolveWritePointers({
      storeRoot,
      evidence: ["possible-supersedes:xyz"],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([]);
  });

  it("no storeRoot -> every pointer unresolved with resolver_unavailable", async () => {
    const res = await resolveWritePointers({
      storeRoot: undefined,
      evidence: [EV_ID, CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolverUnavailable).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: EV_ID, kind: "ledger", resolved: false, reason: "resolver_unavailable" },
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "resolver_unavailable" },
    ]);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/write-verify-resolver.test.ts` — fails (module missing).
- [ ] Implement `packages/mcp-bridge/src/write-verify-resolver.ts` per the behavior above (per-pointer try/catch; conditional-spread the optional `reason` for `exactOptionalPropertyTypes`).
- [ ] GREEN: rerun the suite; then `pnpm --filter @megasaver/mcp-bridge test`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): add write pointer resolver`

---

### Task 4: Gate wiring in `save_memory`

**Files:**
- Edit: `packages/mcp-bridge/src/tools/save-memory.ts` (input schema line 43, `handleSaveMemory` line 102, `SaveMemoryEnv` line 23)
- Create: `packages/mcp-bridge/test/tools/save-memory-write-verify.test.ts`
- Edit (regression only if compile requires): none — `server.ts:384-388` already passes `storeRoot` into `SaveMemoryEnv`.

**Interfaces:**

```ts
// saveMemoryInputSchema changes (additive):
evidence: z.array(z.string()).max(32).optional(),  // NEW — see ASSUMPTION below; capped (architect m8)
expiresAt: z.string().datetime({ offset: true }).nullable().optional(),  // was non-nullable (line 59)
// SaveMemoryEnv gains: policyVersion?: string      // sidecar stamp, default "1" (matches approve-memory.ts:277)
```

ASSUMPTION: the spec never names an `evidence` input on `save_memory`, but its rubric verifies "Evidence strings" of the candidate and its smoke test is "save_memory with a dead evidence id". Verified: `saveMemoryInputSchema` (save-memory.ts:43-62) has NO evidence field today, and no other tool writes ledger ids into `MemoryEntry.evidence` (only supersession lineage notes, supersession.ts:206). Without this additive input the gate could never emit `verified` and `approve_memory`'s evidence resolution (approve-memory.ts:92) is unreachable for save_memory entries. `MemoryEntry.evidence` already exists (memory-entry.ts:92), so this is input plumbing, not a schema change.

Gate wiring (between schema-parse and `saveMemoryWithLineage`, Component 4):
1. **Boundary-forced source (architect B1):** `const source = "agent";` — the stored `entry.source` is ALWAYS `"agent"` at this MCP boundary, regardless of the caller-supplied value (key still accepted by the schema for back-compat; `test_failure` is reserved for engine-owned paths and never callable through save_memory).
2. `const gated = true` for this tool — everything below runs (the `source ∈ {agent, test_failure}` condition is engine-level for future surfaces; at save_memory it is unconditionally agent). When `project === null` the gate is skipped and the flow falls through to the registry's existing `resource_not_found` behavior exactly as today.
3. `resolveWritePointers({ storeRoot: env.storeRoot, evidence: entry.evidence ?? [], projectRootPath: project.rootPath, projectId: entry.projectId, sessionId: entry.sessionId })`.
4. Cited-file coverage: `droppedCitedFiles` = when `entry.anchor !== undefined`, the `entry.relatedFiles ?? []` entries (normalized `f.replace(/\\/g, "/").replace(/^\.\//, "")`) absent from `anchor.files[].path ∪ anchor.symbols[].path`; when `entry.anchor === undefined` ⇒ `[]` (capture is best-effort and must never block a save, save-memory.ts:112-115). ASSUMPTION: cited files are repo-relative (the discipline `validateSave` enforces at approve, packages/core/src/save-validator.ts:17); an absolute cited path reads as dropped — conservative, caps not raises.
5. Corpus mirrors approve-memory.ts:133-135: `registry.listMemoryEntries(entry.projectId).filter((m) => m.approval === "approved" && !m.stale && m.id !== entry.id)`.
6. `verifyMemoryWrite({ candidate: entry, callerConfidence: entry.confidence, callerApproval: entry.approval, approvedActive, resolution, droppedCitedFiles })`, then re-parse: `entry = memoryEntrySchema.parse({ ...entry, source, confidence: verdict.confidence, approval: verdict.approval, expiresAt: entry.expiresAt !== undefined ? entry.expiresAt : defaultWriteExpiresAt(entry.createdAt) })` — explicit datetime or explicit `null` wins; only an ABSENT `expiresAt` gets the 90d default (Decision 6). ALSO change the INITIAL entry parse (`save-memory.ts:140`, `source: d.source ?? "agent"`) to the forced `source` constant (architect N4) — the forced value applies at every parse of this tool, so no future non-gated branch can resurrect the `manual` bypass.
7. After a successful `saveMemoryWithLineage` and only when `result.deduped === undefined`: best-effort sidecar in try/catch — `registry.setMemoryValidation({ memoryEntryId: result.entry.id, validationStatus: verdict.validationStatus, reasons: [...verdict.reasons], conflictIds: [...verdict.conflictIds], validatedAt: env.now(), validatedBy: "system", policyVersion: env.policyVersion ?? "1" })`. A sidecar failure never fails the save.

**Steps:**

- [ ] Write the RED test `packages/mcp-bridge/test/tools/save-memory-write-verify.test.ts` (registry seeding mirrors packages/mcp-bridge/test/tools/memory-tools.test.ts:11; evidence fixture mirrors approve-memory.test.ts:427):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { type EvidenceRecordInput, appendEvidence } from "@megasaver/evidence-ledger";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveMemory } from "../../src/tools/save-memory.js";
import { handleApproveMemory } from "../../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ROOT_PATH = "/tmp/demo";
const TS = "2026-06-11T00:00:00.000Z";
const TS_PLUS_90D = "2026-09-09T00:00:00.000Z";
const EV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: ROOT_PATH,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function idFactory(): () => string {
  const ids = [
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ];
  let i = 0;
  return () => ids[i++] ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
}

function minimalInput(evidenceId: string): EvidenceRecordInput {
  return {
    evidenceId,
    workspaceKey: encodeWorkspaceKey(ROOT_PATH),
    sessionRef: null,
    sourceKind: "command",
    sourceRef: { label: "test" },
    classification: "test",
    redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
    redactedRawChunkSetId: "cset-0000",
    returnedChunkRefs: [],
    createdAt: TS,
    expiresAt: null,
    retentionClass: "transient",
    policyVersion: "1.0",
    pipelineVersion: "1.0",
    redactedRawContent: "raw content",
    redactedReturnedContent: "returned content",
  };
}

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-wv-save-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("save_memory write gate", () => {
  it("agent save citing a dead evidence id persists suggested/low with a quarantined sidecar", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [MISSING_ID],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("suggested"); // never dropped, never auto-approved
    expect(stored?.confidence).toBe("low");
    expect(stored?.expiresAt).toBe(TS_PLUS_90D);
    const sidecar = registry.getMemoryValidation(result.id as MemoryEntryId);
    expect(sidecar?.validationStatus).toBe("quarantined");
    expect(sidecar?.validatedBy).toBe("system");
    expect(sidecar?.reasons).toContain("evidence_not_found");
  });

  it("agent save with resolving evidence is verified: caller approval + confidence pass through", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [EV_ID],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("approved");
    expect(stored?.confidence).toBe("high");
    expect(registry.getMemoryValidation(result.id as MemoryEntryId)?.validationStatus).toBe("valid");
  });

  it("explicit expiresAt: null on a gated write means no expiry", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "x", expiresAt: null },
    );
    expect(registry.getMemoryEntry(result.id as MemoryEntryId)?.expiresAt).toBeNull();
  });

  it("missing storeRoot fails closed for trust, open for persistence (resolver_unavailable)", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "x", evidence: [EV_ID] },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("suggested");
    expect(stored?.confidence).toBe("low");
    expect(registry.getMemoryValidation(result.id as MemoryEntryId)?.reasons).toContain(
      "resolver_unavailable",
    );
  });

  it("caller source is boundary-forced: manual/test_failure cannot dodge the gate (architect B1)", async () => {
    const registry = seededRegistry();
    const newId = idFactory();
    for (const source of ["manual", "test_failure"] as const) {
      const result = await handleSaveMemory(
        { registry, storeRoot, now: () => TS, newId },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: `dodgy claim ${source}`,
          source,
          confidence: "high",
          approval: "approved",
        },
      );
      const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
      expect(stored?.source).toBe("agent"); // forced at the boundary
      expect(stored?.approval).toBe("suggested"); // gate ran — cannot land approved
      expect(stored?.confidence).toBe("low");
      expect(stored?.expiresAt).toBe(TS_PLUS_90D);
    }
  });

  it("an evidence array over the 32-pointer cap is rejected by the schema", async () => {
    const registry = seededRegistry();
    await expect(
      handleSaveMemory(
        { registry, storeRoot, now: () => TS, newId: idFactory() },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: "x",
          evidence: Array.from({ length: 33 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
        },
      ),
    ).rejects.toThrow();
  });

  it("approve composition: a verified gate-written entry still approves (architect M4)", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const saved = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [EV_ID],
      },
    );
    const res = await handleApproveMemory(
      { registry, now: () => TS, storeRoot },
      { memoryEntryId: saved.id as MemoryEntryId },
    );
    expect(res.approval).toBe("approved");
  });

  it("approve composition: a zero-evidence gated entry is quarantined missing_evidence (documented, not accidental — architect M4)", async () => {
    const registry = seededRegistry();
    const saved = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "auth uses JWT" },
    );
    const res = await handleApproveMemory(
      { registry, now: () => TS, storeRoot },
      { memoryEntryId: saved.id as MemoryEntryId },
    );
    expect(res.validation?.status).toBe("quarantined"); // ApproveMemoryResult shape (architect N3)
    expect(res.validation?.reasons).toContain("missing_evidence");
  });

  it("a deduped save writes no second sidecar", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const env = { registry, storeRoot, now: () => TS, newId: idFactory() };
    const input = {
      projectId: PROJECT_ID,
      scope: "project" as const,
      content: "auth uses JWT",
      title: "auth uses JWT",
      confidence: "high" as const,
      approval: "approved" as const,
      evidence: [EV_ID],
    };
    const first = await handleSaveMemory(env, input);
    const before = registry.getMemoryValidation(first.id as MemoryEntryId);
    const second = await handleSaveMemory(env, input);
    expect(second.deduped?.existingId).toBe(first.id);
    expect(registry.getMemoryValidation(first.id as MemoryEntryId)).toEqual(before);
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/tools/save-memory-write-verify.test.ts` — fails (`evidence` rejected by `.strict()` input schema; no gate).
- [ ] Implement the input-schema changes and the gate wiring per Interfaces above in `packages/mcp-bridge/src/tools/save-memory.ts`. Keep the entry-construction spread for evidence conditional: `...(d.evidence !== undefined ? { evidence: d.evidence } : {})`. The gate runs BEFORE `saveMemoryWithLineage`, so supersession lineage notes appended later are never classified at save time. CORRECTED (architect m7): at APPROVE time `approve-memory.ts:84-96` passes all evidence strings verbatim to `resolveEvidenceForMemory` — there is NO prefix skip there today, so an entry whose only evidence is lineage notes reads as missing ids and blocks non-human approval (pre-existing behavior; approve-memory is untouched per non-goals — documented in the spec's Open questions, not fixed here).
- [ ] GREEN: rerun the suite; then `pnpm --filter @megasaver/mcp-bridge test`. PRE-DECLARED existing-suite deltas (architect M3 — no mid-GREEN discovery; verified against the current files):
  - `memory-tools.test.ts` "search_memory ranks by text and get_relevant_memories returns hits" (~:89-115): its two seeding saves pass `approval: "approved"` with no evidence → after the gate they land `suggested` and the search corpus is empty. DELTA: add an `appendEvidence` fixture (EV_ID) and `evidence: [EV_ID]` to both seeding saves so they verify — intent (recall ranking) preserved.
  - `memory-tools.test.ts` "save_memory with explicit approval honours it" (~:131-144): same fix — `evidence: [EV_ID]` + fixture; intent (approval passthrough on verified writes) preserved.
  - `memory-tools.test.ts` "save_memory without approval defaults to suggested": unchanged, stays green (suggested either way).
  - `save-memory-anchor.test.ts`, `save-memory-no-agent-close.test.ts`, `save-memory-reserved-keyword.test.ts`, `verify-memories.test.ts`: expected green with NO edits — verified: anchor suite asserts only anchor/symbol/spawn counts (no approval asserts, resolver does no git calls); no-agent-close passes `approval:"approved"` but its close-blocking rests on `allowImmediateClose` (saveMemoryWithLineage opts — agent saves never immediately close), so forced-suggested keeps every assertion true; reserved-keyword asserts keyword stripping only; verify-memories asserts anchor existence only.
  - No other suite edits are authorized. If any of the four above fails anyway, STOP and re-check the gate condition — the only legal fixes are the two memory-tools deltas above.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): gate agent memory writes at save`

---

### Task 5: Rule path — `convert_failure_to_rule` verification, `get_applicable_rules` now, server threading

**Files:**
- Edit: `packages/mcp-bridge/src/tools/convert-failure-to-rule.ts` (env line 11, `inputSchema` line 17, handler line 41)
- Edit: `packages/mcp-bridge/src/tools/get-applicable-rules.ts` (env line 11, handler line 24)
- Edit: `packages/mcp-bridge/src/server.ts` (case `convert_failure_to_rule` line ~486 gains `storeRoot: deps.storeRoot`; the `get_applicable_rules` case needs NO edit — it already passes `now`)
- Edit: `packages/mcp-bridge/test/tools/forge-tools.test.ts` (extend; update existing `handleGetApplicableRules` call sites for the new required `now`)

**Interfaces:**

```ts
export type ConvertFailureToRuleEnv = {
  registry: CoreRegistry;
  now: () => string;
  newId: () => string;
  storeRoot?: string;         // NEW — absent ⇒ resolver_unavailable ⇒ never verified
};
// inputSchema (+ additive): expiresAt: z.string().datetime({ offset: true }).nullable().optional()
// CORRECTED (architect m6): GetApplicableRulesEnv ALREADY requires now
// (get-applicable-rules.ts:13) and server.ts already passes it — no env change.
// The only handler change is threading `asOf: env.now()` into rankApplicableRules.
```

Handler flow (`convert_failure_to_rule`, Component 5 — rules are ALWAYS gated, evidence only, no conflict corpus):
1. After the failureId parse: `const failure = env.registry.getFailedAttempt(failureId.data)` (registry.ts:116). If `null`, fall through to the registry call so the existing `failed_attempt_not_found` mapping stays byte-identical.
2. Project root: `env.registry.getProject(failure.projectId)?.rootPath` — a `null` project resolves nothing (treat as `storeRoot: undefined` input to the resolver).
3. `resolveWritePointers({ storeRoot: env.storeRoot, evidence: d.evidence ?? [], projectRootPath, projectId: failure.projectId, sessionId: null })` — only CALLER evidence is verified; the engine-seeded failure provenance string (`seedFailureEvidence`, packages/core/src/failed-attempt.ts:36, appended at registry.ts:603) is added after and is never a pointer claim. Rules are project-level ⇒ `sessionId: null` (no session binding, architect N2).
4. `verifyMemoryWrite` with a rule-shaped `ConflictCandidate` adapter `{ id: <ruleId placeholder>, type: "project_rule", title: d.title, content: d.rule, keywords: [], relatedFiles: d.appliesTo ?? [] }` and `approvedActive: []` (empty corpus ⇒ conflict never fires; the Pick-narrowed signature from Task 1 makes the adapter type-check), `droppedCitedFiles: []`.
5. Call `registry.convertFailureToRule` with `confidence: minConfidence(d.confidence ?? "medium", WRITE_VERIFY_CONFIDENCE_CAP[verdict.outcome])`, `verification: { outcome: verdict.outcome, reasons: [...verdict.reasons], verifiedAt: env.now() }`, and `...(d.expiresAt !== undefined ? { expiresAt: d.expiresAt } : {})` (TTL default stays engine-owned, Task 2). The rule is NEVER dropped — an unverified verdict lands as confidence `low` + recorded verification.

`get_applicable_rules`: pass `asOf: env.now()` into `rankApplicableRules` — expired rules drop out of the MCP read path; CLI/other callers without `asOf` stay byte-identical.

**Steps:**

- [ ] RED tests — append to `packages/mcp-bridge/test/tools/forge-tools.test.ts` (constants/`seeded()` from lines 8-31 already exist; add `const RULE_ID = "c0000000-0000-4000-8000-000000000099";` and tmpdir imports):

```ts
describe("convert_failure_to_rule write gate", () => {
  it("unresolvable evidence -> confidence capped low, verification recorded, TTL stamped, never dropped", async () => {
    const registry = seeded();
    const res = await handleConvertFailureToRule(
      { registry, now: () => TS, newId: () => RULE_ID, storeRoot: undefined },
      {
        failureId: "a0000000-0000-4000-8000-000000000001",
        title: "no npm",
        rule: "use pnpm",
        severity: "warning",
        confidence: "high",
        evidence: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      },
    );
    const rule = registry.getProjectRule(res.ruleId as never);
    expect(rule).not.toBeNull(); // never dropped
    expect(rule?.confidence).toBe("low"); // cap never raises
    expect(rule?.verification?.outcome).toBe("unverified");
    expect(rule?.verification?.reasons).toContain("resolver_unavailable");
    expect(rule?.expiresAt).toBe("2026-09-10T00:00:00.000Z"); // TS (2026-06-12) + 90d
  });

  it("explicit expiresAt: null survives the gate (no expiry)", async () => {
    const registry = seeded();
    const res = await handleConvertFailureToRule(
      { registry, now: () => TS, newId: () => RULE_ID },
      {
        failureId: "a0000000-0000-4000-8000-000000000001",
        title: "no npm",
        rule: "use pnpm",
        severity: "warning",
        expiresAt: null,
      },
    );
    expect(registry.getProjectRule(res.ruleId as never)?.expiresAt).toBeNull();
  });
});

describe("get_applicable_rules rule TTL", () => {
  it("excludes a rule expired at env.now and keeps a live one", async () => {
    const registry = seeded();
    registry.createProjectRule({
      id: "c0000000-0000-4000-8000-000000000011",
      projectId: PROJECT_ID,
      title: "live",
      rule: "keep me",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: TS,
      updatedAt: TS,
    } as never);
    registry.createProjectRule({
      id: "c0000000-0000-4000-8000-000000000012",
      projectId: PROJECT_ID,
      title: "expired",
      rule: "drop me",
      appliesTo: [],
      evidence: [],
      severity: "critical",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: TS,
      updatedAt: TS,
      expiresAt: "2026-06-01T00:00:00.000Z",
    } as never);
    const res = await handleGetApplicableRules({ registry, now: () => TS }, { projectId: PROJECT_ID });
    const ids = res.rules.map((r) => r.rule.id);
    expect(ids).toContain("c0000000-0000-4000-8000-000000000011");
    expect(ids).not.toContain("c0000000-0000-4000-8000-000000000012");
  });
});
```

- [ ] RED: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/tools/forge-tools.test.ts` — new cases fail.
- [ ] Implement both handlers + `server.ts` threading per Interfaces. CORRECTED (architect m6): `server.ts` case `convert_failure_to_rule` gains `storeRoot: deps.storeRoot`; the `get_applicable_rules` case needs NO change (it already passes `now`). The `handleGetApplicableRules` handler gains `asOf: env.now()` — existing test call sites in forge-tools.test.ts must add `now: () => TS` (runtime TypeError otherwise: the handler now calls `env.now()`).
- [ ] GREEN: rerun forge-tools; then `pnpm --filter @megasaver/mcp-bridge test` and `pnpm --filter @megasaver/mcp-bridge exec vitest run test/server.e2e.test.ts`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): verify forge rules, expire reads`

---

### Task 6: CLI sweep reporting — `expired=` / `rulesExpired=`

**Files:**
- Edit: `apps/cli/src/commands/memory/sweep.ts` (`runMemorySweep` line 35, summary lines 100-105)
- Edit: `apps/cli/test/memory-sweep.test.ts` (extend the existing suite — no duplicate suite; update the `toEqual` summary at line 114)

**Interfaces:**

```ts
// runMemorySweep summary (public CLI output change — HIGH-risk item, spec §Risk):
const { archiveIds, expiredIds } = sweepMemoryTiers(entries, now);
// ... existing archival loop unchanged (lossless tier demotion) ...
const rules = registry.listProjectRules(project.id);
const nowMs = Date.parse(now);
const rulesExpired = rules.filter((r) => r.expiresAt != null && nowMs >= Date.parse(r.expiresAt)).length;
const summary = {
  archived: archiveIds.length,
  scanned: entries.length,
  expired: expiredIds.length,
  rulesExpired,
};
// text: `archived=${...} scanned=${...} expired=${...} rulesExpired=${...}`  — json: same keys
// SEMANTICS (architect m9, pinned): `expired=` counts rows expired AND archived
// BY THIS RUN (newly expired; a re-sweep reports 0 — rows are already archival);
// `rulesExpired=` counts currently-expired rules (state — rules are never mutated).
// State this in the command's summary/help text.
```

Rules are counted, never mutated (read-exclusion only; no update/delete API exists — Decision 7). Existing `toContain("archived=")` assertions keep passing because the line is extended, not reshaped.

**Steps:**

- [ ] RED tests — in `apps/cli/test/memory-sweep.test.ts`: widen the `memEntry` helper's `over` param with optional `expiresAt?: string` and `tier?: string` passthrough (spread into the JSON), add a rules seeder, and append:

```ts
const RULE_ID = "55555555-5555-4555-8555-555555555555";

function ruleRow(id: string, expiresAt: string | null): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    title: "r",
    rule: "use pnpm",
    appliesTo: [],
    evidence: [],
    severity: "info",
    confidence: "medium",
    createdFrom: "manual",
    createdAt: OLD,
    updatedAt: OLD,
    ...(expiresAt !== null ? { expiresAt } : {}),
  });
}

async function seedRules(rules: string[]): Promise<void> {
  await mkdir(join(store, "project-rules"), { recursive: true });
  await writeFile(join(store, "project-rules", `${PROJECT_ID}.jsonl`), `${rules.join("\n")}\n`);
}

describe("runMemorySweep TTL enforcement", () => {
  it("archives a past-expiresAt entry (lossless) and reports expired=", async () => {
    await seed([
      memEntry(ID_RECENT_HIGH, {
        confidence: "high",
        createdAt: RECENT,
        updatedAt: RECENT,
        expiresAt: "2026-06-29T12:00:00.000Z", // before NOW
      }),
    ]);
    const code = await runMemorySweep(env());
    expect(code).toBe(0);
    const entries = await readEntries();
    expect(entries.find((e) => e.id === ID_RECENT_HIGH)?.tier).toBe("archival");
    expect(entries.length).toBe(1); // lossless — row still present
    expect(out.join("\n")).toContain("expired=1");
  });

  it("reports rulesExpired= without mutating the rule rows", async () => {
    await seed([memEntry(ID_RECENT_HIGH, { confidence: "high", createdAt: RECENT, updatedAt: RECENT })]);
    await seedRules([ruleRow(RULE_ID, "2026-06-01T00:00:00.000Z")]);
    const code = await runMemorySweep(env());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("rulesExpired=1");
    const raw = await readFile(join(store, "project-rules", `${PROJECT_ID}.jsonl`), "utf8");
    expect(raw).toContain(RULE_ID); // read-exclusion only — never deleted
  });

  it("emits the new keys in --json", async () => {
    await seed([memEntry(ID_OLD_LOW, { confidence: "low", createdAt: OLD, updatedAt: OLD })]);
    const code = await runMemorySweep(env({ jsonFlag: true }));
    expect(code).toBe(0);
    const summary = JSON.parse(out.join("")) as Record<string, number>;
    expect(summary).toEqual({ archived: 1, scanned: 1, expired: 0, rulesExpired: 0 });
  });
});
```

  Also UPDATE the existing `--json` assertion (apps/cli/test/memory-sweep.test.ts:114) from `toEqual({ archived: 1, scanned: 1 })` to `toEqual({ archived: 1, scanned: 1, expired: 0, rulesExpired: 0 })` — this is the spec's "update the `toEqual` summary" instruction, not a regression edit. Note `readFile` is already imported (line 1). The rules file path `project-rules/<projectId>.jsonl` is the json-directory layout (packages/core/src/json-directory-store.ts:67, :209).
- [ ] RED: `pnpm --filter @megasaver/cli exec vitest run test/memory-sweep.test.ts` — new cases fail (`expired=` missing; json keys missing).
- [ ] Implement the `runMemorySweep` changes per Interfaces (destructure `expiredIds`; count expired rules; extend text + json output). Exit codes 0/1 unchanged (`workflows/cli-test-pattern`).
- [ ] GREEN: rerun the suite; then `pnpm --filter @megasaver/cli test`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(cli): report expired counts in memory sweep`

---

### Task 7: Changesets, full verify, smoke evidence (DoD gate)

**Files:**
- Create: `.changeset/memory-write-verify.md`

**Steps:**

- [ ] Add the changeset (public API changed in all three packages — spec §Dependencies):

```md
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
---

Memory write-verify: deterministic write gate for agent-sourced memory
entries and FORGE rules (evidence pointers must resolve; contradictions
quarantine), write-time confidence caps, and 90-day default TTL enforced
losslessly by `mega memory sweep` (`expired=` / `rulesExpired=` reporting;
`rankApplicableRules` gains `asOf` read-exclusion).
```

- [ ] Full gate: `pnpm verify` (biome + tsc project refs + vitest) — must be green.
- [ ] Smoke evidence (DoD #5, capture the terminal session into the PR):
  1. Bridge smoke (dead evidence id → suggested/low): `pnpm --filter @megasaver/mcp-bridge exec vitest run test/tools/save-memory-write-verify.test.ts --reporter=verbose` — capture the verbose pass list; then a live MCP run through the built server exercising `save_memory` with `evidence: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]` against a scratch store, capturing the returned entry landing `suggested`. (ASSUMPTION: the `mega` bin (§2 repo layout) serves MCP via the existing `mega mcp serve` surface seen in apps/cli/test/mcp/serve.test.ts — follow that test's invocation pattern for the captured run.)
  2. CLI smoke (expired fixture archived + expired rule reported): seed a scratch store exactly as `apps/cli/test/memory-sweep.test.ts` does (projects.json, memory/<id>.jsonl with a past-`expiresAt` row, project-rules/<id>.jsonl with an expired rule), then run the built CLI `memory sweep demo --store <scratch> --json` and capture `{"archived":1,...,"expired":1,"rulesExpired":1}`.
- [ ] Wiki (post-merge, per spec): update `wiki/concepts/failed-run-learning.md`, the approval-gate page, and append a timestamped `wiki/log.md` entry.
- [ ] Request reviews: `code-reviewer` AND `critic` (separate passes, fresh contexts, author ≠ reviewer), then `verifier` with the smoke evidence. Do not claim done before §9 items 4-7 pass.
- [ ] Commit: `chore: add changesets for memory write-verify`

---

### Task 8-10: Critic scope amendment — approve pointer classification + two gated surfaces

Spec amendment: `docs/superpowers/specs/2026-08-06-memory-write-verify-design.md`
scope note (2026-08-16) + Decision 2/5 + Components 8-10.

### Task 8: `approve_memory` classifies evidence pointers (amendment A)

**Files:**
- Modify: `packages/mcp-bridge/src/tools/approve-memory.ts`
- Modify: `packages/mcp-bridge/test/tools/save-memory-write-verify.test.ts` (approve composition cases)

**Steps:**

- [ ] RED: extend the approve-composition describe — (1) a gate-verified entry
  whose evidence is a chunk-set pointer (`cs-…`) approves (`approval: "approved"`);
  (2) the same entry after the chunk file is deleted stays suggested with
  `validation.status: "rejected"` and reason `missing_evidence_record`.
- [ ] Implement: in `handleApproveMemory` replace the
  `resolveEvidenceForMemory` call with `resolveWritePointers` (env unchanged;
  project lookup already exists; pass `existing.sessionId`/`projectId`), then map:
  `unresolvedSecret`/`hasRevoked`/`hasCrossWorkspace` 1:1; unresolved non-note
  pointers (any reason) ⇒ the existing missing-record block for non-human
  sources; `unresolvedSecret` for `validateSave` as today. Human (`source:
  "manual"`) skip semantics unchanged. Remove the now-unused
  `resolveEvidenceForMemory` import (depcheck).
- [ ] GREEN: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/tools/save-memory-write-verify.test.ts` + approve-memory suite.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): classify evidence pointers at approve`

### Task 9: gate `save_project_rule` (amendment B)

**Files:**
- Modify: `packages/mcp-bridge/src/tools/project-rules.ts`
- Modify: `packages/mcp-bridge/test/tools/` — new `save-project-rule-write-verify.test.ts`

**Steps:**

- [ ] RED: new suite `packages/mcp-bridge/test/tools/save-project-rule-write-verify.test.ts`
  (fixture pattern mirrors forge-tools `seeded()`): (1) no evidence ⇒ rule lands
  confidence `low`, `verification.outcome: "unverified"`, `expiresAt = createdAt+90d`;
  (2) resolving ledger evidence ⇒ `verified` passthrough of caller confidence;
  (3) explicit `expiresAt: null` survives; (4) 33 evidence pointers ⇒
  `validation_failed`; (5) unknown project still throws `resource_not_found`.
- [ ] Implement: env gains optional `storeRoot`; schema gains
  `evidence .max(32)` + `expiresAt` (`.datetime().nullable().optional()`);
  gate between parse and `createProjectRule` mirroring FORGE
  (`resolveWritePointers` with `sessionId: null`; verdict candidate
  `{ type: "project_rule", relatedFiles: appliesTo }`; `approvedActive: []`;
  confidence `minConfidence(caller, cap)`; `verification` stamp; `expiresAt`
  default or explicit). `createdFrom` stays caller-claimed (pre-existing
  semantics).
- [ ] GREEN: rerun suite + `pnpm --filter @megasaver/mcp-bridge test`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): gate save_project_rule at the MCP boundary`

### Task 10: gate `memory_from_session` test_failure candidates (amendment C)

**Files:**
- Modify: `packages/mcp-bridge/src/tools/from-session-memory.ts`
- Modify: `packages/mcp-bridge/test/tools/from-session-memory.test.ts`

**Steps:**

- [ ] RED: extend the suite — a session whose failed attempt distills a
  `test_failure` candidate lands it `suggested` + confidence `low` +
  `expiresAt = createdAt+90d` + sidecar `quarantined` with
  `zero_evidence_pointers`; a `session_summary` (DECISION:) candidate keeps
  its pre-amendment shape (no `expiresAt`, no sidecar).
- [ ] Implement: env gains optional `storeRoot`; inside the candidate loop,
  when `candidate.source === "test_failure"` run the gate
  (`resolveWritePointers` over `[]`; `approvedActive` corpus as in
  save_memory; `droppedCitedFiles: []` — the relatedFiles are engine-recorded,
  not agent-claimed at save; verdict ⇒ confidence/approval/`expiresAt`
  default; `setMemoryValidation` sidecar when the save did not dedupe).
- [ ] GREEN: rerun suite + `pnpm --filter @megasaver/mcp-bridge test`.
- [ ] `pnpm verify`
- [ ] Commit: `feat(mcp-bridge): gate memory_from_session writes`

- [ ] Commit (final): `chore: add changesets for memory write-verify` (update
  the changeset body to name the three new surfaces).

---

## Plan self-review notes

- Spec fidelity checked against all seven Locked Decisions: pure core verdict (D1 → Task 1), reuse of `checkConflicts`/`resolveEvidenceForMemory`/`locateChunkSet`/anchor with type-only narrowing (D2 → Tasks 1/3/4), closed-form classification (D3 → Task 1), rubric/caps/approval/sidecar mapping (D4 → Task 1), boundary-keyed gate + fail-closed-for-trust/fail-open-for-persistence (D5 → Task 4; source forced `"agent"` at the boundary per architect B1), 90d TTL with explicit-null respect on both surfaces (D6 → Tasks 2/4/5), lossless sweep + additive rule fields + `asOf` + no rule update/delete API (D7 → Tasks 2/5/6).
- Non-goals honored: `approve-memory.ts` untouched; `effectiveConfidence`/`isRecallable` untouched; no `MemoryEntry` schema change; CLI `memory create` and `mega memory promote` not wired; no LLM calls; no deletion.
- Import-cycle risk (registry → write-verify → supersession → registry) resolved by relocating `POSSIBLE_SUPERSEDES_PREFIX` with a re-export; verify with `pnpm typecheck` + depcheck in CI.
- Open deviations are all marked `ASSUMPTION:` (evidence input on save_memory; `verification` shape and its passthrough on `failureToRuleInputSchema`; anchor-coverage path normalization; smoke-run bin surface — server env threading is now Verified against server.ts:384-452, not an assumption). If a reviewer rejects the `evidence`-input assumption, the fallback is spec-literal: gate runs with lineage-note-only evidence and every agent save lands `unverified` — flag that trade-off to the user rather than silently choosing it.
