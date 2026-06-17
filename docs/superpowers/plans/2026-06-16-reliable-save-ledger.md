# Reliable Save Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `approve_memory` a validated commit gate — a `suggested` MemoryEntry can only become `approved` after deterministic schema/evidence/secret/scope checks pass and a conflict check against existing approved memory clears — so a false, secret-bearing, or contradictory agent save cannot reach agent-facing context.

**Architecture:** Three new pure modules in `@megasaver/core` — a validation-metadata **sidecar** (`MemoryValidation`, keyed by `memoryEntryId`, so the shipped `.strict()` `memoryEntrySchema` is untouched), a deterministic `saveValidator` (hard fail-closed checks + advisory heuristics that downgrade to `needs_approval`/`quarantined`, never auto-approve), and a `conflictChecker` (duplicate / supersession / contradiction / unrelated against approved-active memory). `approve_memory` (mcp-bridge) is wired to run validator + conflict before flipping `approval` to `approved`; on failure it returns reasons and leaves the row `suggested`/sets it `rejected`. No new package; memory correctness stays in Core (agent-agnostic).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, tsup, Biome, pnpm/Turbo.

**Source spec:** `docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md` (HIGH risk), §3–§9, §13–§15. This plan implements the **validator + conflict + approval-gate core**. Deferred to named follow-on plans (each ships working software):
- **Plan 3b — Evidence linkage** (§5, §12): wiring `evidenceIds` to `@megasaver/evidence-ledger` (Plan 1) — workspace match, `evidenceStatus`, replay. Depends on Plan 1.
- **Plan 3c — Per-target projection conformance** (§11): a projection-validation matrix test across all connector target shapes. **NB:** see "Spec discrepancy" below — the matrix must be corrected to match the shipped connectors first.

**Risk:** HIGH (trust boundary for saved memory). Worktree + `code-reviewer` AND `critic` per CLAUDE.md §12.

## Already enforced today (do NOT rebuild — verified in repo)

- **Phase-10 gate** (`packages/core/src/memory-search.ts:55`): `searchMemoryEntries` filters `q.includeUnapproved || entry.approval === "approved"`, default `includeUnapproved:false`. `search_memory`/`get_relevant_memories` never expose `includeUnapproved` → approved-only.
- **MCP leak prevention (§10)**: `mega_recall` (`recall.ts:42`), `get_project_context` (`project-context.ts:65`) both filter `approval==="approved"`. No current MCP tool returns unapproved claims or raw evidence. This plan ADDS a regression test locking that invariant; it does not re-implement gates.
- **Connector projection gate (§11)**: `buildConnectorContext` → `filterMemoryEntriesForSession` (`apps/cli/src/commands/connector/shared.ts`) filters `approval==="approved"`; `ConnectorContextSchema` rejects sentinel-injection in content/title.
- **`save_memory` already defaults `suggested`** (`mcp-bridge/src/tools/save-memory.ts`); **`approve_memory` already rejects `suggested` as an input** and is human-in-the-loop (`approve-memory.ts`). This plan inserts validation BEFORE the approve flip.

## Spec discrepancy to fix before Plan 3c (flag to spec author)

reliable-save §11 lists Aider `CONVENTIONS.md` as a "full generated file, no sentinel." The shipped `packages/connectors/generic-cli/src/targets.ts` `aiderTarget` is **sentinel-based** (in `builtinTargets`, same `MEGA_SAVER:BEGIN/END` pair as Codex/Gemini/Windsurf/Continue; only Cursor adds frontmatter *outside* the sentinel). The §11 matrix must be corrected: every shipped target is sentinel-based today. (Do not act on the wrong matrix in Plan 3c.)

---

## File Structure

```
packages/core/src/
├── validation-status.ts     # NEW: validationStatus enum (the full sidecar = Plan 3b)
├── save-validator.ts        # NEW: validateSave (hard + advisory)
├── conflict-checker.ts      # NEW: checkConflicts
└── index.ts                 # extend exports
packages/core/test/
├── validation-status.test.ts
├── save-validator.test.ts
└── conflict-checker.test.ts
packages/mcp-bridge/src/tools/
└── approve-memory.ts        # MODIFY: run validator + conflict before approving
packages/mcp-bridge/test/
└── approve-memory.test.ts   # extend: adversarial fixtures
```

---

## Task 1: Validation status enum

**Files:** Create `packages/core/src/validation-status.ts`; Test `packages/core/test/validation-status.test.ts`

Spec §4 defines a richer validation-metadata **sidecar** (`validationStatus`, `evidenceIds`, `conflictIds`, `projectionPreflight`, `evidenceStatus`, …). In THIS slice the gate computes validation on-the-fly at approve-time and returns it inline — nothing persists or reads a sidecar yet. Per YAGNI / repo §13 (no half-implementations), this plan ships ONLY the `validationStatus` enum the validator/conflict code consumes. The full persisted sidecar (with `evidenceStatus`/`projectionPreflight`/`memoryValidationSchema`) lands in **Plan 3b**, where `mega memory explain` actually reads it and the registry persists it.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { validationStatusSchema } from "../src/validation-status.js";

describe("validationStatusSchema", () => {
  it("has the five lifecycle states", () => {
    for (const s of ["unvalidated", "valid", "needs_approval", "quarantined", "rejected"]) {
      expect(validationStatusSchema.safeParse(s).success).toBe(true);
    }
  });
  it("rejects approval-lifecycle values (validation status is distinct)", () => {
    expect(validationStatusSchema.safeParse("approved").success).toBe(false);
    expect(validationStatusSchema.safeParse("suggested").success).toBe(false);
  });
  it("preserves declaration order (AA3: order is a contract)", () => {
    expect(validationStatusSchema.options).toEqual([
      "unvalidated",
      "valid",
      "needs_approval",
      "quarantined",
      "rejected",
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core test validation-status`

- [ ] **Step 3: Create `src/validation-status.ts`**

```typescript
import { z } from "zod";

// The deterministic outcome of save validation, distinct from the approval
// lifecycle (suggested/approved/rejected). `valid` is the only state that
// permits an approve flip; everything else routes to human review or rejection.
export const validationStatusSchema = z.enum([
  "unvalidated",
  "valid",
  "needs_approval",
  "quarantined",
  "rejected",
]);
export type ValidationStatus = z.infer<typeof validationStatusSchema>;
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/core test validation-status`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/validation-status.ts packages/core/test/validation-status.test.ts
git commit -m "feat(core): validation status enum"
```

---

## Task 2: Save validator — hard checks (fail-closed)

**Files:** Create `packages/core/src/save-validator.ts`; Test `packages/core/test/save-validator.test.ts`

Spec §7 hard checks. Pure function over a candidate `MemoryEntry` + a redaction/evidence context. Returns a `validationStatus` + reasons; hard-check failure → `rejected` or `quarantined`, never `valid`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { validateSave } from "../src/save-validator.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEM_ID = "00000000-0000-4000-8000-0000000000a1";

function candidate(over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: MEM_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict ESM",
    content: "The repo uses strict ESM with NodeNext resolution.",
    keywords: ["esm"],
    confidence: "medium",
    source: "agent",
    approval: "suggested",
    stale: false,
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...over,
  } as MemoryEntry;
}

describe("validateSave hard checks", () => {
  it("a human save with no evidence is valid (humans assert directly)", () => {
    const r = validateSave({ candidate: candidate({ source: "manual" }), evidenceIds: [], unresolvedSecret: false });
    expect(r.status).toBe("valid");
  });

  it("an agent save with no evidence is quarantined (non-human needs evidence)", () => {
    const r = validateSave({ candidate: candidate({ source: "agent" }), evidenceIds: [], unresolvedSecret: false });
    expect(r.status).toBe("quarantined");
    expect(r.reasons).toContain("missing_evidence");
  });

  it("an agent save with evidence and no flags is valid", () => {
    const r = validateSave({ candidate: candidate({ source: "agent" }), evidenceIds: ["ev-1"], unresolvedSecret: false });
    expect(r.status).toBe("valid");
  });

  it("an unresolved secret finding is rejected regardless of source", () => {
    const r = validateSave({ candidate: candidate({ source: "manual" }), evidenceIds: ["ev-1"], unresolvedSecret: true });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("unresolved_secret");
  });

  it("an absolute or traversal relatedFiles path is rejected", () => {
    const r = validateSave({
      candidate: candidate({ relatedFiles: ["/etc/shadow"] }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("unsafe_related_file");
  });

  it("over-long content is rejected (bounded)", () => {
    const r = validateSave({
      candidate: candidate({ content: "x".repeat(8001) }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected");
    expect(r.reasons).toContain("content_too_long");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 3: Create `src/save-validator.ts`** (hard checks only — advisory added in Task 3)

```typescript
import type { MemoryEntry } from "./memory-entry.js";
import type { ValidationStatus } from "./validation-status.js";

const MAX_CONTENT = 8000;

export interface ValidateSaveInput {
  candidate: MemoryEntry;
  evidenceIds: readonly string[];
  unresolvedSecret: boolean;
}

export interface ValidateSaveResult {
  status: ValidationStatus;
  reasons: readonly string[];
}

function isSafeProjectRelative(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.split(/[\\/]/).includes("..")) return false;
  return true;
}

export function validateSave(input: ValidateSaveInput): ValidateSaveResult {
  const { candidate, evidenceIds, unresolvedSecret } = input;
  const reasons: string[] = [];
  const isHuman = candidate.source === "manual";

  // Secret gate first — fail closed, hardest stop.
  if (unresolvedSecret) reasons.push("unresolved_secret");

  // Non-human candidates need at least one evidence reference.
  if (!isHuman && evidenceIds.length === 0) reasons.push("missing_evidence");

  for (const file of candidate.relatedFiles ?? []) {
    if (!isSafeProjectRelative(file)) {
      reasons.push("unsafe_related_file");
      break;
    }
  }

  if (candidate.content.length > MAX_CONTENT) reasons.push("content_too_long");

  if (reasons.includes("unresolved_secret") || reasons.includes("unsafe_related_file") || reasons.includes("content_too_long")) {
    return { status: "rejected", reasons };
  }
  if (reasons.includes("missing_evidence")) {
    return { status: "quarantined", reasons };
  }
  return { status: "valid", reasons };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/save-validator.ts packages/core/test/save-validator.test.ts
git commit -m "feat(core): save validator hard checks (fail-closed)"
```

---

## Task 3: Save validator — advisory heuristics (downgrade, never auto-approve)

**Files:** Modify `src/save-validator.ts`; extend `test/save-validator.test.ts`

Spec §7 advisory checks use deterministic heuristics and downgrade a would-be-`valid` candidate to `needs_approval` — they never silently approve or rewrite.

- [ ] **Step 1: Write the failing test** — append:

```typescript
describe("validateSave advisory heuristics", () => {
  it("high confidence with zero evidence is needs_approval (confidence exceeds evidence)", () => {
    const r = validateSave({
      candidate: candidate({ source: "manual", confidence: "high" }),
      evidenceIds: [],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("needs_approval");
    expect(r.reasons).toContain("confidence_exceeds_evidence");
  });

  it("a transcript-fragment-looking content is needs_approval", () => {
    const r = validateSave({
      candidate: candidate({ content: "@@ -1,4 +1,4 @@ const x = 1;\n+const y = 2;\n-const z = 3;" }),
      evidenceIds: ["ev-1"],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("needs_approval");
    expect(r.reasons).toContain("looks_like_transcript_fragment");
  });

  it("advisory never overrides a hard rejection", () => {
    const r = validateSave({
      candidate: candidate({ source: "manual", confidence: "high", content: "x".repeat(8001) }),
      evidenceIds: [],
      unresolvedSecret: false,
    });
    expect(r.status).toBe("rejected"); // content_too_long wins
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 3: Add advisory logic to `validateSave`** — replace the final return block:

```typescript
  // Hard failures first (unchanged): rejected / quarantined short-circuit.
  if (reasons.includes("unresolved_secret") || reasons.includes("unsafe_related_file") || reasons.includes("content_too_long")) {
    return { status: "rejected", reasons };
  }
  if (reasons.includes("missing_evidence")) {
    return { status: "quarantined", reasons };
  }

  // Advisory heuristics — deterministic, downgrade to needs_approval only.
  const advisory: string[] = [];
  if (candidate.confidence === "high" && evidenceIds.length === 0) {
    advisory.push("confidence_exceeds_evidence");
  }
  if (looksLikeTranscriptFragment(candidate.content)) {
    advisory.push("looks_like_transcript_fragment");
  }
  if (advisory.length > 0) {
    return { status: "needs_approval", reasons: advisory };
  }
  return { status: "valid", reasons };
}

// Heuristic: diff/hunk markers or an unbalanced code-symbol density suggest a
// raw transcript fragment rather than a self-contained claim. Deterministic; it
// only routes to human review, never blocks outright (spec §7).
function looksLikeTranscriptFragment(content: string): boolean {
  if (/^@@ -\d/m.test(content)) return true;
  if (/^[+-]\S/m.test(content) && /\n/.test(content)) return true;
  return false;
}
```

(Delete the old trailing `return { status: "valid", reasons };` from Task 2 so there is one return path.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/save-validator.ts packages/core/test/save-validator.test.ts
git commit -m "feat(core): advisory heuristics route ambiguous saves to human review"
```

---

## Task 4: Conflict checker

**Files:** Create `packages/core/src/conflict-checker.ts`; Test `packages/core/test/conflict-checker.test.ts`

Spec §8. Compare a suggested candidate against approved-active memory in the same project. Deterministic outcomes.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { checkConflicts } from "../src/conflict-checker.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
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
    confidence: "medium",
    source: "agent",
    approval: "approved",
    stale: false,
    relatedFiles: ["package.json"],
    createdAt: "2026-06-16T12:00:00.000Z",
    updatedAt: "2026-06-16T12:00:00.000Z",
    ...over,
  }) as MemoryEntry;

describe("checkConflicts", () => {
  it("exact duplicate of an approved memory -> duplicate (link, do not re-commit)", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1")];
    const r = checkConflicts(mk("00000000-0000-4000-8000-0000000000b2"), existing);
    expect(r.outcome).toBe("duplicate");
    expect(r.conflictIds).toEqual(["00000000-0000-4000-8000-0000000000b1"]);
  });

  it("same file + same type, different conclusion -> supersession (needs explicit supersedes)", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1", { content: "use pnpm not npm" })];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", { content: "use npm not pnpm", keywords: ["npm"] });
    const r = checkConflicts(cand, existing);
    expect(r.outcome).toBe("supersession");
  });

  it("a contradiction (shared files + opposite keyword) -> contradiction (quarantine)", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1", { content: "tests must pass before merge", keywords: ["merge", "pass"] })];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", {
      type: "project_rule",
      content: "merge without waiting for tests",
      keywords: ["merge", "skip"],
    });
    const r = checkConflicts(cand, existing);
    // existing type=decision, candidate type=project_rule → supersession's
    // same-type guard is false, so the contradiction branch fires.
    expect(r.outcome).toBe("contradiction");
  });

  it("an unrelated fact -> continue", () => {
    const existing = [mk("00000000-0000-4000-8000-0000000000b1", { content: "use pnpm", relatedFiles: ["package.json"] })];
    const cand = mk("00000000-0000-4000-8000-0000000000b2", {
      content: "auth uses JWT",
      keywords: ["jwt"],
      relatedFiles: ["src/auth.ts"],
    });
    const r = checkConflicts(cand, existing);
    expect(r.outcome).toBe("unrelated");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core test conflict-checker`

- [ ] **Step 3: Create `src/conflict-checker.ts`**

```typescript
import type { MemoryEntryId } from "@megasaver/shared";
import type { MemoryEntry } from "./memory-entry.js";

export type ConflictOutcome = "duplicate" | "supersession" | "contradiction" | "unrelated";

export interface ConflictResult {
  outcome: ConflictOutcome;
  conflictIds: readonly MemoryEntryId[];
  reasons: readonly string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function fileOverlap(a: MemoryEntry, b: MemoryEntry): boolean {
  const fa = new Set(a.relatedFiles ?? []);
  return (b.relatedFiles ?? []).some((f) => fa.has(f));
}

export function checkConflicts(
  candidate: MemoryEntry,
  approvedActive: readonly MemoryEntry[],
): ConflictResult {
  const candContent = norm(candidate.content);
  const candTitle = norm(candidate.title);

  // 1) exact duplicate: identical normalized title+content.
  const dup = approvedActive.find((m) => norm(m.content) === candContent && norm(m.title) === candTitle);
  if (dup) return { outcome: "duplicate", conflictIds: [dup.id], reasons: ["exact_duplicate"] };

  // 2) supersession: same type + overlapping files, different conclusion.
  const supersede = approvedActive.find(
    (m) => m.type === candidate.type && fileOverlap(m, candidate) && norm(m.content) !== candContent,
  );
  if (supersede) {
    return { outcome: "supersession", conflictIds: [supersede.id], reasons: ["same_scope_different_conclusion"] };
  }

  // 3) contradiction: project_rule with overlapping files/keywords but a
  // negation-bearing keyword set divergence. Heuristic → quarantine upstream.
  const NEGATIONS = new Set(["skip", "without", "no", "never", "disable"]);
  const candNeg = candidate.keywords.some((k) => NEGATIONS.has(k.toLowerCase()));
  const contra = approvedActive.find(
    (m) =>
      (m.type === "project_rule" || candidate.type === "project_rule") &&
      fileOverlap(m, candidate) &&
      candNeg !== m.keywords.some((k) => NEGATIONS.has(k.toLowerCase())),
  );
  if (contra) return { outcome: "contradiction", conflictIds: [contra.id], reasons: ["rule_polarity_divergence"] };

  return { outcome: "unrelated", conflictIds: [], reasons: [] };
}
```

> **WHY heuristic, not semantic (spec §3 non-goal — no LLM):** these checks are deterministic approximations. They produce false positives/negatives; that is acceptable because every non-`unrelated` outcome routes to human review, never to silent auto-approval. The spec must not claim full contradiction *prevention* — only detection-and-quarantine of the cases these heuristics catch.
>
> **Check precedence is intentional:** duplicate → supersession → contradiction. A real contradiction that *also* shares the same `type` + overlapping files is labelled `supersession` (it matches check 2 first). This mislabels but never mis-approves — both block the flip and route to a human. If the `explain` label matters downstream (Plan 3b), reorder or merge the two; for the gate's safety it is irrelevant.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/core test conflict-checker`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/conflict-checker.ts packages/core/test/conflict-checker.test.ts
git commit -m "feat(core): deterministic conflict checker (dup/supersession/contradiction)"
```

---

## Task 5: Export the validator/conflict surface

**Files:** Modify `packages/core/src/index.ts`; Test `packages/core/test/save-validator.test-d.ts`

- [ ] **Step 1: Write the failing type-surface test** (`test/save-validator.test-d.ts`)

```typescript
import { expectTypeOf } from "vitest";
import * as core from "../src/index.js";
import type { ConflictResult, ValidateSaveResult, ValidationStatus } from "../src/index.js";

expectTypeOf(core.validateSave).toBeFunction();
expectTypeOf(core.checkConflicts).toBeFunction();
expectTypeOf(core.validationStatusSchema).not.toBeNever();
expectTypeOf<ValidateSaveResult>().toHaveProperty("status");
expectTypeOf<ConflictResult>().toHaveProperty("outcome");
expectTypeOf<ValidationStatus>().toEqualTypeOf<"unvalidated" | "valid" | "needs_approval" | "quarantined" | "rejected">();
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 3: Append to `packages/core/src/index.ts`** (new export block; do not reorder existing exports)

```typescript
export { validationStatusSchema, type ValidationStatus } from "./validation-status.js";
export { validateSave, type ValidateSaveInput, type ValidateSaveResult } from "./save-validator.js";
export { checkConflicts, type ConflictOutcome, type ConflictResult } from "./conflict-checker.js";
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/core test save-validator`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/save-validator.test-d.ts
git commit -m "feat(core): export reliable-save validator + conflict checker"
```

---

## Task 6: Gate `approve_memory` on validation + conflict

**Files:** Modify `packages/mcp-bridge/src/tools/approve-memory.ts`; extend `packages/mcp-bridge/test/approve-memory.test.ts`

Spec §3/§13: `approve_memory` runs validation + conflict before flipping to `approved`. On hard failure → return reasons, leave `suggested` (or set `rejected` for a hard reject); on advisory/conflict → leave `suggested` with reasons (human must resolve). Read the current `approve-memory.ts` first for `ApproveMemoryEnv`/`ApproveMemoryResult` shapes.

- [ ] **Step 1: Write the failing test** — append the adversarial fixtures to `approve-memory.test.ts`:

```typescript
import { validateSave } from "@megasaver/core";

describe("approve_memory validation gate (adversarial)", () => {
  it("refuses to approve an agent memory with no evidence (stays suggested, returns reasons)", async () => {
    const registry = seededRegistry(); // seeds a suggested agent memory with no evidence
    const result = await handleApproveMemory(
      { registry, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested"); // NOT approved
    expect(result.validation?.status).toBe("quarantined");
    expect(result.validation?.reasons).toContain("missing_evidence");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.approval).toBe("suggested");
  });

  it("approves a human-curated memory with no conflicts", async () => {
    const registry = seededRegistry({ source: "manual", evidenceIds: [] });
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: MEMORY_ID, approval: "approved" });
    expect(result.approval).toBe("approved");
  });

  it("a reject decision still rejects regardless of validation", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: MEMORY_ID, approval: "rejected" });
    expect(result.approval).toBe("rejected");
  });

  it("approving an exact duplicate of an approved memory REJECTS it (no second approved row) — spec §8", async () => {
    // Seed an already-approved memory + a suggested duplicate with the same title+content.
    const registry = seededDuplicateRegistry();
    const before = registry.listMemoryEntries(PROJECT_ID).filter((m) => m.approval === "approved").length;
    const result = await handleApproveMemory({ registry, now: () => TS }, { memoryEntryId: DUP_ID, approval: "approved" });
    expect(result.approval).toBe("rejected");
    expect(result.conflict?.outcome).toBe("duplicate");
    const after = registry.listMemoryEntries(PROJECT_ID).filter((m) => m.approval === "approved").length;
    expect(after).toBe(before); // duplicate did NOT create a second approved row
  });
});
```

(Add a `seededDuplicateRegistry()` fixture: an `approved` memory `APPROVED_ID` and a `suggested` `DUP_ID` with identical `title` + `content`. Both `source:"manual"` so the validator's evidence check passes and only the conflict gate decides. Also adjust `seededRegistry` to accept overrides for `source`/evidence; mirror the existing fixture.)

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/mcp-bridge test approve-memory`

- [ ] **Step 3: Extend the result type, then insert the gate at the exact anchor.**

First read `approve-memory.ts`. The real handler (verified) parses input → loads `existing` → has an early no-op `if (existing.approval === approval) return { id, approval };` → then an **unconditional** `updateMemoryEntry({ approval, updatedAt })` → `return { id, approval }`. There is NO `approval === "approved"` branch to "enter" — you create one. Insert the gate **after the no-op equality check** (so re-approving an already-approved row stays a no-op and is not re-validated) and **before** the `updateMemoryEntry` flip.

Extend the result type concretely (the existing `ApproveMemoryResult = { id: string; approval: MemoryApproval }` gains two optionals; `ApproveMemoryEnv = { registry; now }` is unchanged — the evidence/secret ports arrive in Plan 3b):

```typescript
import type { ConflictOutcome } from "@megasaver/core";
import type { ValidationStatus } from "@megasaver/core";
import type { MemoryApproval, MemoryEntryId } from "@megasaver/shared"; // MemoryApproval is re-exported by core; match the file's existing import

export interface ApproveMemoryResult {
  id: string;
  approval: MemoryApproval;
  validation?: { status: ValidationStatus; reasons: readonly string[] };
  conflict?: { outcome: ConflictOutcome; conflictIds: readonly MemoryEntryId[] };
}
```

Insert between the no-op return and the `updateMemoryEntry` flip:

```typescript
// Only an APPROVE decision is gated; a REJECT is always honoured (it proceeds
// to the existing updateMemoryEntry flip below).
if (approval === "approved") {
  // Plan 3b wires these to the evidence ledger; until then evidence comes from
  // the entry's own `evidence[]` and the secret input defaults false (see
  // changeset: the unresolved-secret gate is INERT until Plan 3b).
  const evidenceIds = existing.evidence ?? [];
  const unresolvedSecret = false;
  const validation = validateSave({ candidate: existing, evidenceIds, unresolvedSecret });
  const approvedActive = env.registry
    .listMemoryEntries(existing.projectId)
    .filter((m) => m.approval === "approved" && !m.stale && m.id !== existing.id);
  const conflict = checkConflicts(existing, approvedActive);

  // spec §8: an exact duplicate of an approved memory must NOT become a second
  // approved row. Reject the suggested duplicate (kept for audit), do not flip.
  if (conflict.outcome === "duplicate") {
    const rejected = env.registry.updateMemoryEntry(existing.id, { approval: "rejected", updatedAt: env.now() });
    return {
      id: rejected.id,
      approval: rejected.approval,
      validation: { status: "rejected", reasons: ["exact_duplicate"] },
      conflict: { outcome: conflict.outcome, conflictIds: conflict.conflictIds },
    };
  }
  // Any non-valid validation or any non-unrelated conflict blocks the flip: the
  // row stays `suggested` and the reasons are surfaced for the human to resolve.
  if (validation.status !== "valid" || conflict.outcome !== "unrelated") {
    return {
      id: existing.id,
      approval: existing.approval, // still "suggested"
      validation: { status: validation.status, reasons: [...validation.reasons, ...conflict.reasons] },
      conflict: { outcome: conflict.outcome, conflictIds: conflict.conflictIds },
    };
  }
}
// fall through to the existing updateMemoryEntry({ approval, updatedAt }) flip.
```

> **Concurrency (spec §8 serialization) — deferred + flagged:** `checkConflicts` runs against the current approved set at approve-time. The in-memory registry is synchronous/single-threaded, so sequential approvals are safe (the 1st becomes approved, the 2nd then sees the conflict). True per-workspace serialization / compare-and-swap for a future concurrent/persistent registry is **Plan 3b** — it is NOT implemented here. Do not claim §8 serialization is done.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @megasaver/mcp-bridge test approve-memory`

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-bridge/src/tools/approve-memory.ts packages/mcp-bridge/test/approve-memory.test.ts
git commit -m "feat(mcp-bridge): gate approve_memory on validator + conflict checks"
```

---

## Task 7: MCP leak regression test (lock the §10 invariant)

**Files:** Create `packages/mcp-bridge/test/mcp-leak.test.ts`

Spec §10. The gates already exist (mega_recall, get_project_context, search_memory, get_relevant_memories filter approved-only). This task LOCKS that no agent-facing retrieval returns a `suggested`/`rejected`/`quarantined` claim, so a future tool addition can't silently leak.

- [ ] **Step 1: Write the failing/locking test** — seed a project with one `approved`, one `suggested`, one `rejected` memory; call each agent-facing tool; assert only the approved claim appears.

```typescript
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleSearchMemory } from "../src/tools/search-memory.js";
import { handleGetRelevantMemories } from "../src/tools/get-relevant-memories.js";
// (mega_recall + get_project_context similarly — follow each tool's env shape)

// ... seed approved "ALPHA", suggested "BRAVO", rejected "CHARLIE" with shared keyword ...

describe("MCP leak invariant: agent retrieval returns approved-only", () => {
  it("search_memory excludes suggested + rejected", async () => {
    const { memory } = await handleSearchMemory(env, { projectId: PROJECT_ID, text: "shared" });
    const contents = memory.map((m) => m.content);
    expect(contents).toContain("ALPHA");
    expect(contents).not.toContain("BRAVO");
    expect(contents).not.toContain("CHARLIE");
  });
  it("get_relevant_memories excludes suggested + rejected", async () => {
    const { memory } = await handleGetRelevantMemories(env, { projectId: PROJECT_ID, task: "shared" });
    expect(memory.map((m) => m.content)).toEqual(["ALPHA"]);
  });
  // repeat for mega_recall + get_project_context
});
```

- [ ] **Step 2: Run — expect PASS immediately** (the gates already exist; this is a regression lock, not a fix). If any assertion FAILS, that is a real leak — stop and fix the gate.

Run: `pnpm --filter @megasaver/mcp-bridge test mcp-leak`

- [ ] **Step 3: Commit**

```bash
git add packages/mcp-bridge/test/mcp-leak.test.ts
git commit -m "test(mcp-bridge): lock approved-only invariant across agent retrieval tools"
```

---

## Task 8: Changeset + full verify

**Files:** Create `.changeset/reliable-save-ledger.md`

- [ ] **Step 1: Create the changeset**

```markdown
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
---

Reliable save: approve_memory now runs a deterministic validator (schema,
evidence-for-non-human, safe related files, bounded content, advisory
heuristics) plus a conflict checker (duplicate/supersession/contradiction)
before flipping a suggested memory to approved. Hard failures and conflicts
leave the row suggested with reasons; an exact duplicate of an approved memory
is rejected (never a second approved row); nothing auto-approves. NOTE: the
unresolved-secret check is wired but its input is supplied by the evidence
ledger (Plan 3b) — until then it defaults false, so the secret gate is inert in
this release; the evidence-presence gate is fully active. Adds a regression test
locking that agent-facing retrieval returns approved-only memory.
```

- [ ] **Step 2: Repo-wide gate**

Run: `pnpm verify`
Expected: PASS (lint + typecheck + test + conventions). `pnpm lint:fix` first if biome flags import order. Core dependency-graph allow-list unchanged.

- [ ] **Step 3: Commit**

```bash
git add .changeset/reliable-save-ledger.md
git commit -m "chore(core): changeset for reliable save validator + conflict gate"
```

---

## Self-Review (against reliable-save-ledger-design.md)

- §3 Reconciliation → candidate IS `approval:"suggested"`; no parallel entity; `approve_memory` validates before approving. ✓
- §4 Validation metadata → only the `validationStatus` enum ships here (computed inline at approve-time, returned in the result). The full persisted sidecar (`evidenceStatus`/`projectionPreflight`/`memoryValidationSchema`) is **Plan 3b** where it is actually read by `mega memory explain` — not shipped unwired (critic finding #5). ✓ (scoped)
- §5 Evidence rules → `validateSave` takes `evidenceIds` + `unresolvedSecret` inputs; ledger linkage (workspace match, evidenceStatus, revoked-tombstone) is **Plan 3b**. ⚠️ **Known limitation:** `unresolvedSecret` defaults `false` here, so the secret gate is INERT until 3b (stated in the changeset); the evidence-presence gate IS active.
- §6 Workspace identity → Plan 3b. Noted.
- §7 Save validator → hard checks (Task 2) + advisory heuristics that downgrade (Task 3). ✓
- §8 Conflict checker → dup/supersession/contradiction/unrelated (Task 4); **exact duplicate of approved → suggested row rejected, never a second approved row** (critic finding #1 fixed, Task 6). Per-workspace **serialization/CAS is NOT implemented** — synchronous in-memory registry makes sequential approval safe; concurrent/persistent serialization deferred to Plan 3b (flagged, not silently dropped). ⚠️
- §9 Approval policy → human valid → approved; agent valid+evidence → approvable; hard-fail → rejected/quarantined; conflict → stays suggested; duplicate → rejected (Task 6). ✓
- §10 MCP leak → already enforced; locked by regression test (Task 7). ✓
- §11 Projection matrix → **Plan 3c**, AND the spec matrix must first be corrected (Aider is sentinel-based, not full-file — see "Spec discrepancy"). ✓ (flagged)
- §13 CLI/MCP surface → `approve_memory` gated (result extended with `validation`/`conflict`); `mega memory review`/`explain` = Plan 3b. Noted.
- §15 Testing → validator/conflict unit tests + adversarial approve fixtures (incl. duplicate-not-double-approved) + MCP-leak lock; evidence/replay tests = Plan 3b.

**Placeholder scan:** Task 6 now gives the concrete `ApproveMemoryResult` extension + the exact insertion anchor (after the no-op equality check, before the flip) rather than "read and figure out." The executor must still read `approve-memory.ts` to match its import style. Task 7's mega_recall/get_project_context cases say "follow each tool's env shape" — the search_memory/get_relevant_memories cases are fully written as the pattern.

**Type consistency:** `ValidationStatus`/`ValidateSaveResult`/`ConflictResult`/`ConflictOutcome` consistent across tasks; `ApproveMemoryResult` extended with optional `validation`/`conflict`; `validateSave`/`checkConflicts` signatures stable.

**Carried scope:** Plan 3b (evidence linkage + workspace identity + `mega memory review`/`explain` + replay), Plan 3c (projection conformance, after §11 matrix correction).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-16-reliable-save-ledger.md`. Execution options: (1) Subagent-Driven (recommended), (2) Inline. Which approach?
