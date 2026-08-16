# Memory Write-Verify Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the shipped memory-write-verify write gate to the two remaining writers (CLI `mega memory from-session`, core `runAutopilot`) and thread `asOf` on the two remaining rule readers (`mega rules apply`, GUI workspace-rules route).

**Architecture:** Core stays gate-pure — `verifyMemoryWrite` already exists and is reused everywhere. Autopilot constructs its `WriteResolution` inline from its own recurrence computation (`priorHashes`); a new closed-form `autopilot_attestation` pointer kind makes the auto-approve verdict evidence-backed and structural (`auto-approve ⇔ qualified ∧ verified`). The CLI from-session path uses an empty resolution (zero pointers need no IO). Rule readers just pass `asOf: now`.

**Tech Stack:** TypeScript strict ESM, Vitest, Biome, tsup/turbo, Zod.

## Global Constraints

- Worktree `feat/write-verify-followup` at `/Users/ozger/Desktop/MegaSaver/.worktrees/feat-write-verify-followup`; no `main` edits (HIGH risk).
- DoD gate: `pnpm verify` (biome + tsc project refs + vitest + conventions:check) green before every task's final commit.
- TDD, red first. Clocks injected (ISO strings). No comments without a WHY. No stubs.
- Core agent-agnostic: no mcp-bridge imports in `@megasaver/core`; no core imports beyond public entry from other packages.
- `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — array accesses in tests need `?.` or length guards.
- Commit style: conventional commits, imperative, ≤50 char subjects.

---

### Task 1: Core — `autopilot_attestation` pointer kind + prefix relocation

**Files:**
- Modify: `packages/core/src/write-verify.ts` (classifier + kind union + prefix constant)
- Modify: `packages/core/src/autopilot.ts` (import + re-export the relocated prefix)
- Modify: `packages/core/test/write-verify.test.ts`
- Modify: `packages/core/test/autopilot.test.ts` (import line only)

**Interfaces:**
- Consumes: existing `classifyEvidencePointer`, `EvidencePointerKind`, `PointerResolution` in `write-verify.ts`; `AUTOPILOT_EVIDENCE_PREFIX`/`formatAutopilotEvidence` in `autopilot.ts`.
- Produces: `classifyEvidencePointer("autopilot@1 …") → "autopilot_attestation"`; `AUTOPILOT_EVIDENCE_PREFIX` exported from BOTH `write-verify.js` and (re-exported) `autopilot.js` so `packages/core/src/index.ts` and `apps/cli/src/commands/brain/digest.ts` keep compiling unchanged.

- [ ] **Step 1: RED — extend the classifier table test**

In `packages/core/test/write-verify.test.ts`, extend the existing `it.each` in `describe("classifyEvidencePointer (closed-form, Decision 3)")` with one row. The table currently reads (lines 55-63):

```ts
  it.each([
    ["possible-supersedes:xyz", "lineage_note"],
    [CS_ID, "chunk_set"],
    ["cs-not-32-hex", "ledger"],
    [LEDGER_ID, "ledger"],
  ])("%s -> %s", (pointer, kind) => {
```

Add one row after the lineage note row:

```ts
    ["autopilot@1 rule=recurring-failure session=abc", "autopilot_attestation"],
```

and one negative row after the ledger row:

```ts
    ["autopilot-ish", "ledger"],
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @megasaver/core exec vitest run test/write-verify.test.ts`
Expected: the two new rows fail (`expected "ledger" to be "autopilot_attestation"` for the first; second may pass already). TypeScript may also flag the missing union member in later edits.

- [ ] **Step 3: Implement**

In `packages/core/src/write-verify.ts`:

a) After the existing `export const POSSIBLE_SUPERSEDES_PREFIX = "possible-supersedes:";` line add:

```ts
// The autopilot engine's attestation prefix (relocated from autopilot.ts so
// the closed-form classification table owns its own prefixes — see the
// POSSIBLE_SUPERSEDES_PREFIX relocation pattern).
export const AUTOPILOT_EVIDENCE_PREFIX = "autopilot@1";
```

b) Extend the kind union (currently `export type EvidencePointerKind = "lineage_note" | "chunk_set" | "ledger";`):

```ts
export type EvidencePointerKind =
  | "lineage_note"
  | "chunk_set"
  | "autopilot_attestation"
  | "ledger";
```

c) In `classifyEvidencePointer`, after the lineage-note check and before the chunk-set check, add:

```ts
  if (evidence.startsWith(AUTOPILOT_EVIDENCE_PREFIX)) return "autopilot_attestation";
```

In `packages/core/src/autopilot.ts`: delete the local declaration (line 17) and replace with:

```ts
export { AUTOPILOT_EVIDENCE_PREFIX } from "./write-verify.js";
```

then fix the two usages: `formatAutopilotEvidence` needs the VALUE, so import it too:

```ts
import { AUTOPILOT_EVIDENCE_PREFIX } from "./write-verify.js";
```

with `export { AUTOPILOT_EVIDENCE_PREFIX };` after (keeps the index surface and digest.ts importers working; mirrors the `POSSIBLE_SUPERSEDES_PREFIX` re-export in `supersession.ts`).

- [ ] **Step 4: GREEN**

Run: `pnpm --filter @megasaver/core exec vitest run test/write-verify.test.ts test/autopilot.test.ts`
Expected: all pass; the autopilot suite is untouched except the import surface still resolving.

- [ ] **Step 5: Regression + verify**

Run: `pnpm --filter @megasaver/core test`, then `pnpm verify` from the worktree root.
Expected: green (existing importers — index.ts, digest.ts — compile because the re-export preserves the surface).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/write-verify.ts packages/core/src/autopilot.ts packages/core/test/write-verify.test.ts
git commit -m "feat(core): add autopilot attestation pointer kind"
```

---

### Task 2: Core — gate `runAutopilot` (structural composition)

**Files:**
- Modify: `packages/core/src/autopilot.ts` (gate wiring)
- Modify: `packages/core/test/autopilot.test.ts` (new describe block)

**Interfaces:**
- Consumes: `verifyMemoryWrite` (core, already exported), `defaultWriteExpiresAt` (core), `MemoryEntry`/`MemoryValidation` shapes, `registry.setMemoryValidation` (existing sidecar API).
- Produces: `RunAutopilotResult` unchanged in shape; every gated row now carries `expiresAt = createdAt+90d` and a system sidecar; `auto-approve ⇔ qualified ∧ verdict.outcome === "verified"`.

- [ ] **Step 1: RED — new describe block in `packages/core/test/autopilot.test.ts`**

Append after the existing `runAutopilot` describes (reuse `seedBase`, `run`, `PROJECT_ID`, `CURRENT_SESSION`, `NOW`, `nextId`; `NOW = "2026-07-15T12:00:00.000Z"` → `NOW + 90d = "2026-10-13T12:00:00.000Z"`):

```ts
const NOW_PLUS_90D = "2026-10-13T12:00:00.000Z";

describe("runAutopilot write gate", () => {
  it("gated rows carry TTL + system sidecar: approved and staged", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "build the cli bundle", "ENOENT: missing dist/cli.js");

    const result = await run(registry);

    expect(result.autoApproved).toHaveLength(1);
    expect(result.staged).toHaveLength(1);
    for (const entry of [...result.autoApproved, ...result.staged]) {
      expect(entry.expiresAt).toBe(NOW_PLUS_90D);
      const sidecar = registry.getMemoryValidation(entry.id);
      expect(sidecar?.validatedBy).toBe("system");
      expect(sidecar?.validatedAt).toBe(NOW);
    }
    const approved = result.autoApproved[0];
    expect(registry.getMemoryValidation(approved?.id)?.validationStatus).toBe("valid");
    const staged = result.staged[0];
    expect(registry.getMemoryValidation(staged?.id)?.validationStatus).toBe("quarantined");
    expect(registry.getMemoryValidation(staged?.id)?.reasons).toContain("zero_evidence_pointers");
  });

  it("a contradiction with approved memory quarantines instead of auto-approving", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    registry.createMemoryEntry({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "bug",
      title: "auth middleware crashes",
      content: "Failed step: auth middleware crashes",
      keywords: [],
      confidence: "high",
      source: "agent",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    } as never);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");

    const result = await run(registry);

    expect(result.autoApproved).toEqual([]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(result.staged[0]?.confidence).toBe("low");
    const sidecar = registry.getMemoryValidation(result.staged[0]?.id);
    expect(sidecar?.validationStatus).toBe("quarantined");
    expect(sidecar?.reasons).toContain("conflict_contradiction");
  });

  it("an anchor miss blocks auto-approve (cited file dropped)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry); // rootPath is a nonexistent dir → capture fails
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined", ["a.ts"]);
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined", ["a.ts"]);

    const result = await run(registry);

    expect(result.autoApproved).toEqual([]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]?.approval).toBe("suggested");
    expect(registry.getMemoryValidation(result.staged[0]?.id)?.reasons).toContain(
      "anchor_dropped:a.ts",
    );
  });

  it("dry-run still writes nothing and stages nothing", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(PRIOR_SESSION, "auth middleware crashes", "TypeError: x is undefined");
    addFailure(CURRENT_SESSION, "auth middleware crashes", "TypeError: x is undefined");

    const result = await run(registry, { dryRun: true });

    expect(result.autoApproved).toHaveLength(1);
    expect(registry.listMemoryEntries(PROJECT_ID)).toEqual([]);
  });

  it("session_summary candidates stay ungated (no TTL, no sidecar)", async () => {
    const registry = createInMemoryCoreRegistry();
    const addFailure = seedBase(registry);
    addFailure(CURRENT_SESSION, "choose auth library", "DECISION: use JWT with 15m expiry");

    const result = await run(registry);

    expect(result.staged).toHaveLength(2); // failure candidate + decision candidate
    const decision = result.staged.find((e) => e.source === "session_summary");
    expect(decision?.expiresAt).toBeUndefined();
    expect(registry.getMemoryValidation(decision?.id)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/core exec vitest run test/autopilot.test.ts`
Expected: TTL/sidecar assertions fail (no `expiresAt`, no sidecar yet); contradiction case currently AUTO-APPROVES (fails); anchor-miss case currently auto-approves (fails); session_summary case passes trivially today (no gate → no TTL) but pins the invariant.

- [ ] **Step 3: Implement**

In `packages/core/src/autopilot.ts`:

a) Add imports:

```ts
import {
  type WriteResolution,
  defaultWriteExpiresAt,
  verifyMemoryWrite,
} from "./write-verify.js";
```

b) Replace the entry-building block (currently lines 141-164). The gate runs ONLY for `candidate.source === "test_failure"` (failure candidates); decision candidates (`session_summary`) keep today's shape. After the existing `const approve = …` line and before `const entry = memoryEntrySchema.parse({…})`, insert the resolution computation, and change the entry fields:

```ts
    const priorSessionHit = priorHashes.has(candidate.contentHash);
    // Write gate (memory write-verify follow-up): qualified candidates claim
    // the autopilot attestation pointer — resolved by construction, because
    // qualification already required cross-session recurrence; everyone else
    // resolves zero pointers. The verdict then owns approval: auto-approve
    // ⇔ qualified ∧ verified, so a contradicting approved row or an anchor
    // miss can no longer machine-approve.
    const gated = candidate.source === "test_failure";
    const resolution: WriteResolution = {
      resolutions:
        gated && qualified
          ? [
              {
                pointer: formatAutopilotEvidence(sessionId),
                kind: "autopilot_attestation",
                resolved: true,
              },
            ]
          : [],
      unresolvedSecret: false,
      hasRevoked: false,
      hasCrossWorkspace: false,
      resolverUnavailable: false,
    };
    const normalized = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");
    const droppedCitedFiles =
      anchor === undefined
        ? candidate.relatedFiles.map(normalized)
        : candidate.relatedFiles
            .map(normalized)
            .filter(
              (f) =>
                !anchor.files.some((a) => a.path === f) &&
                !anchor.symbols.some((a) => a.path === f),
            );
    const verdict = gated
      ? verifyMemoryWrite({
          candidate: {
            id: "00000000-0000-4000-8000-000000000000",
            type: candidate.type,
            title: candidate.title,
            content: candidate.content,
            keywords: [dedupeKeyword],
            relatedFiles: candidate.relatedFiles,
          },
          callerConfidence: approve ? "high" : candidate.confidence,
          callerApproval: approve ? "approved" : "suggested",
          approvedActive: registry
            .listMemoryEntries(projectId)
            .filter((m) => m.approval === "approved" && !m.stale),
          resolution,
          droppedCitedFiles,
        })
      : undefined;
```

Note: the gate candidate uses a fixed placeholder id (`00000000-0000-4000-8000-000000000000`) — the engine mints the real id once via `newId()` below; `checkConflicts` reads `id` only for the self-exclusion in `approvedActive`, which is already pre-filtered. `MemoryEntryId` cast: `as MemoryEntryId` (import the type from `@megasaver/shared` — `MemoryEntryId` is already imported? No — add `type MemoryEntryId` to the shared import line).

c) Change the entry construction:

```ts
    const entry: MemoryEntry = memoryEntrySchema.parse({
      id: newId(),
      projectId,
      sessionId,
      scope: candidate.scope,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      keywords: [dedupeKeyword],
      confidence: blockedByConflict
        ? "low"
        : (verdict?.confidence ?? (approve ? "high" : candidate.confidence)),
      source: candidate.source,
      approval: autoApprove ? "approved" : "suggested",
      ...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),
      ...(anchor !== undefined ? { anchor } : {}),
      ...(gated ? { expiresAt: defaultWriteExpiresAt(now) } : {}),
      ...(autoApprove
        ? {
            validFrom: now,
            lastActiveAt: now,
            evidence: [formatAutopilotEvidence(sessionId)],
          }
        : {}),
      createdAt: now,
      updatedAt: now,
    });
```

d) Change the write block (currently lines 174-175):

```ts
    if (!dryRun) {
      registry.createMemoryEntry(entry);
      if (verdict !== undefined) {
        // Best-effort, mirrors save_memory: a sidecar failure never fails the write.
        try {
          registry.setMemoryValidation({
            memoryEntryId: entry.id,
            validationStatus: blockedByConflict ? "quarantined" : verdict.validationStatus,
            reasons:
              blockedByConflict && conflict?.outcome === "contradiction"
                ? [...verdict.reasons]
                : blockedByConflict
                  ? [...verdict.reasons, ...(conflict?.reasons ?? [])]
                  : [...verdict.reasons],
            conflictIds: blockedByConflict
              ? [...(conflict?.conflictIds ?? [])]
              : [...verdict.conflictIds],
            validatedAt: now,
            validatedBy: "system",
            policyVersion: "1",
          });
        } catch {
          // best-effort — see above
        }
      }
    }
    (autoApprove ? result.autoApproved : result.staged).push(entry);
```

- [ ] **Step 4: GREEN**

Run: `pnpm --filter @megasaver/core exec vitest run test/autopilot.test.ts`
Expected: all pass. Note the existing "captures the anchor on BOTH branches" real-git test keeps passing — its seedBase uses a real repo so anchors resolve and cited files are not dropped.

- [ ] **Step 5: Regression + verify**

Run: `pnpm --filter @megasaver/core test` then `pnpm verify` from the worktree root.
Expected: green. The existing autopilot suite assertions (`approved.confidence === "high"`, staged `low`, dry-run byte-identical) all still hold: verdict verified → min(high, high) = high passthrough; staged unverified → low.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/autopilot.ts packages/core/test/autopilot.test.ts
git commit -m "feat(core): gate autopilot writes with write-verify"
```

---

### Task 3: mcp-bridge — fail-closed resolution for agent-cited attestations

**Files:**
- Modify: `packages/mcp-bridge/src/write-verify-resolver.ts`
- Modify: `packages/mcp-bridge/test/write-verify-resolver.test.ts`

**Interfaces:**
- Consumes: `classifyEvidencePointer` now returning `autopilot_attestation` (Task 1).
- Produces: agent-cited `autopilot@…` pointers resolve as `{ kind: "autopilot_attestation", resolved: false, reason: "autopilot_attestation_unverifiable" }` with zero IO; `hasCrossWorkspace` untouched.

- [ ] **Step 1: RED — add to `packages/mcp-bridge/test/write-verify-resolver.test.ts`**

Inside the existing `describe("resolveWritePointers", …)` (after the non-UUID test):

```ts
  it("an agent-cited autopilot attestation is fail-closed unverifiable", async () => {
    const res = await resolveWritePointers({
      storeRoot,
      evidence: ["autopilot@1 rule=recurring-failure session=abc"],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      {
        pointer: "autopilot@1 rule=recurring-failure session=abc",
        kind: "autopilot_attestation",
        resolved: false,
        reason: "autopilot_attestation_unverifiable",
      },
    ]);
    expect(res.hasCrossWorkspace).toBe(false);
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/write-verify-resolver.test.ts`
Expected: FAIL — the pointer currently falls into the ledger branch, fails the UUID shape, and returns `kind: "ledger", reason: "invalid_pointer"`.

- [ ] **Step 3: Implement**

In `packages/mcp-bridge/src/write-verify-resolver.ts`, inside the `for` loop of `resolveWritePointers`, after the lineage-note skip and before the chunk-set branch, add:

```ts
    if (kind === "autopilot_attestation") {
      // Only the core autopilot engine (which computed the cross-session
      // recurrence itself) may resolve this kind; an agent-cited marker is
      // a claim with no verifiable backing — fail closed, no IO.
      resolutions.push({
        pointer,
        kind,
        resolved: false,
        reason: "autopilot_attestation_unverifiable",
      });
      continue;
    }
```

- [ ] **Step 4: GREEN**

Run: `pnpm --filter @megasaver/mcp-bridge exec vitest run test/write-verify-resolver.test.ts`
Expected: pass.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @megasaver/mcp-bridge test` then `pnpm verify` from the worktree root.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-bridge/src/write-verify-resolver.ts packages/mcp-bridge/test/write-verify-resolver.test.ts
git commit -m "fix(mcp-bridge): fail-closed autopilot attestations"
```

---

### Task 4: CLI — gate `mega memory from-session`

**Files:**
- Modify: `apps/cli/src/commands/memory/from-session.ts`
- Modify: `apps/cli/test/memory-from-session.test.ts`

**Interfaces:**
- Consumes: `verifyMemoryWrite`, `defaultWriteExpiresAt` from `@megasaver/core` (public entry).
- Produces: gated `test_failure` rows: `expiresAt = now+90d`, `setMemoryValidation` sidecar (best-effort); `session_summary` rows unchanged; summary output `suggested=X skipped=Y` unchanged.

- [ ] **Step 1: RED — extend `apps/cli/test/memory-from-session.test.ts`**

The file's harness: `seed(failures[])` writes `projects.json`/`sessions.json`/`failed-attempts/<PROJECT_ID>.jsonl` into a temp store; `env()` injects `now: NOW` (`NOW = "2026-06-30T12:00:00.000Z"` → `NOW+90d = "2026-09-28T12:00:00.000Z"`); `readMemories()` reads the JSONL. Add `createJsonDirectoryCoreRegistry` to the `@megasaver/core` import line. Append inside the existing `describe("runMemoryFromSession", …)`:

```ts
  it("gates test_failure candidates: TTL + quarantined sidecar, still suggested/low", async () => {
    await seed([
      failure(FA_A, SESSION_ID, { failedStep: "run auth tests", errorOutput: "boom 401" }),
    ]);
    const code = await runMemoryFromSession(env());
    expect(code).toBe(0);

    const mems = await readMemories();
    expect(mems).toHaveLength(1);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const entry = registry.getMemoryEntry(mems[0]?.id as never);
    expect(entry?.approval).toBe("suggested");
    expect(entry?.confidence).toBe("low");
    expect(entry?.expiresAt).toBe("2026-09-28T12:00:00.000Z"); // NOW + 90d
    const sidecar = registry.getMemoryValidation(mems[0]?.id as never);
    expect(sidecar?.validationStatus).toBe("quarantined");
    expect(sidecar?.reasons).toContain("zero_evidence_pointers");
  });

  it("session_summary (DECISION:) candidates keep their pre-gate shape", async () => {
    await seed([
      failure(FA_A, SESSION_ID, {
        failedStep: "choose auth library",
        errorOutput: "DECISION: use JWT with 15m expiry",
      }),
    ]);
    const code = await runMemoryFromSession(env());
    expect(code).toBe(0);

    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const decision = registry
      .listMemoryEntries(PROJECT_ID as never)
      .find((m) => m.source === "session_summary");
    expect(decision?.approval).toBe("suggested");
    expect(decision?.expiresAt).toBeUndefined();
    expect(registry.getMemoryValidation(decision?.id as never)).toBeNull();
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/cli exec vitest run test/memory-from-session.test.ts`
Expected: FAIL (no `expiresAt`, no sidecar).

- [ ] **Step 3: Implement**

In `apps/cli/src/commands/memory/from-session.ts`:

a) Extend the core import with `defaultWriteExpiresAt`, `verifyMemoryWrite`, and `type WriteResolution`.

b) Inside the candidate loop, after `entry` is built (the `memoryEntrySchema.parse` block ending line 126), before `saveMemoryWithLineage`:

```ts
      // Write gate (memory write-verify follow-up): test_failure candidates
      // are gated exactly like the MCP from-session tool — zero pointers here,
      // so the verdict is unverified: suggested + low + default TTL + sidecar.
      let stagedEntry = entry;
      let verdict: ReturnType<typeof verifyMemoryWrite> | undefined;
      if (entry.source === "test_failure" && project !== null) {
        const resolution: WriteResolution = {
          resolutions: [],
          unresolvedSecret: false,
          hasRevoked: false,
          hasCrossWorkspace: false,
          resolverUnavailable: false,
        };
        verdict = verifyMemoryWrite({
          candidate: entry,
          callerConfidence: entry.confidence,
          callerApproval: entry.approval,
          approvedActive: registry
            .listMemoryEntries(session.projectId)
            .filter((m) => m.approval === "approved" && !m.stale && m.id !== entry.id),
          resolution,
          droppedCitedFiles: [],
        });
        stagedEntry = memoryEntrySchema.parse({
          ...entry,
          confidence: verdict.confidence,
          approval: verdict.approval,
          expiresAt: defaultWriteExpiresAt(entry.createdAt),
        });
      }
      // detect: false (living brain, architect #5): N terse extracted candidates
      // sharing the same session files would mass-auto-link against approved
      // rows and prime a bulk-approval mass-close. The from-session: dedupe
      // keyword stays the only dedupe on this path.
      const result = saveMemoryWithLineage(registry, stagedEntry, {
        now: () => now,
        detect: false,
      });
      if (result.deduped === undefined && verdict !== undefined) {
        // Sidecar is best-effort: a validation write failure never fails the tool.
        try {
          registry.setMemoryValidation({
            memoryEntryId: result.entry.id,
            validationStatus: verdict.validationStatus,
            reasons: [...verdict.reasons],
            conflictIds: [...verdict.conflictIds],
            validatedAt: now,
            validatedBy: "system",
            policyVersion: "1",
          });
        } catch {
          // best-effort — see above
        }
      }
```

Keep the rest (`staged.add`, `suggested += 1`) as-is.

- [ ] **Step 4: GREEN**

Run: `pnpm --filter @megasaver/cli exec vitest run test/memory-from-session.test.ts`
Expected: pass.

- [ ] **Step 5: Regression + verify**

Run: `pnpm --filter @megasaver/cli test`, then `pnpm verify` from the worktree root. Also run the autopilot-from-session interop suite (`apps/cli/test/autopilot-from-session-interop.test.ts`) — it asserts both writers produce the same dedupe keyword; the gate must not change keywords.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/memory/from-session.ts apps/cli/test/memory-from-session.test.ts
git commit -m "feat(cli): gate memory from-session writes"
```

---

### Task 5: CLI — `mega rules apply` threads `asOf`

**Files:**
- Modify: `apps/cli/src/commands/rules/apply.ts`
- Modify: `apps/cli/test/rules.test.ts`

**Interfaces:**
- Consumes: `rankApplicableRules(rules, { asOf, task?, files })` (asOf already in core's `applicableRuleQuerySchema`).
- Produces: `RunRulesApplyInput` gains `now?: () => string` (the test `base()` already passes it at runtime).

- [ ] **Step 1: RED — extend `apps/cli/test/rules.test.ts`**

Add a test in the existing describe: create a rule directly with a past `expiresAt` via the json-directory registry (the `runRulesAdd` surface has no expiresAt flag), then `runRulesApply` with injected `now`:

```ts
  it("excludes an expired rule (asOf)", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
    registry.createProjectRule({
      id: "c0000000-0000-4000-8000-000000000099",
      projectId: PROJECT_ID,
      title: "expired",
      rule: "use the old way",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: TS,
      updatedAt: TS,
      expiresAt: "2026-06-11T00:00:00.000Z", // before TS
    } as never);
    const code = await runRulesApply({
      ...base(root, out, err),
      taskFlag: undefined,
      filesFlags: undefined,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).not.toContain("expired");
  });
```

(`TS` in this file is `"2026-06-12T00:00:00.000Z"` and `base()` already carries `now: () => TS`.)

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/cli exec vitest run test/rules.test.ts`
Expected: FAIL — the expired rule is still listed.

- [ ] **Step 3: Implement**

In `apps/cli/src/commands/rules/apply.ts`: add `now?: () => string;` to `RunRulesApplyInput`, and in the handler replace the `rankApplicableRules` call:

```ts
    const ranked = rankApplicableRules(registry.listProjectRules(project.id), {
      asOf: input.now?.() ?? new Date().toISOString(),
      ...(input.taskFlag !== undefined ? { task: input.taskFlag } : {}),
      files,
    });
```

- [ ] **Step 4: GREEN + verify + commit**

Run: `pnpm --filter @megasaver/cli exec vitest run test/rules.test.ts` (pass), then `pnpm verify` from the worktree root.

```bash
git add apps/cli/src/commands/rules/apply.ts apps/cli/test/rules.test.ts
git commit -m "feat(cli): exclude expired rules in rules apply"
```

---

### Task 6: GUI — workspace-rules route threads `asOf`

**Files:**
- Modify: `apps/gui/bridge/routes/workspace-rules.ts`
- Test: `apps/gui/test/bridge/workspace-rules.test.ts` (new; follow `apps/gui/test/bridge/handoff-route.test.ts` harness pattern — `startTestBridge` from `./test-helpers.js`)

**Interfaces:**
- Consumes: `rankApplicableRules(rules, { asOf, task?, files })`; `RouteContext.now(): string` (already present in `route-context.ts:61`).
- Produces: `GET /api/workspaces/:key/rules` excludes expired overlay rules.

- [ ] **Step 1: RED — new test file `apps/gui/test/bridge/workspace-rules.test.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, describe, expect, it } from "vitest";
import { type TestServer, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/ws-rules-expiry";
const KEY = encodeWorkspaceKey(CWD);

let server: TestServer;

afterEach(async () => {
  if (server) await server.close();
});

// startTestBridge (test-helpers.ts:145) creates its own mkdtemp store root and
// exposes it as TestServer.storePath; close() removes it.
describe("GET /api/workspaces/:key/rules", () => {
  it("excludes an expired overlay rule (asOf)", async () => {
    server = await startTestBridge();
    mkdirSync(join(server.storePath, "rules"), { recursive: true });
    writeFileSync(
      join(server.storePath, "rules", `${KEY}.jsonl`),
      `${JSON.stringify({
        id: "e0000000-0000-4000-8000-000000000001",
        projectId: "11111111-1111-4111-8111-111111111111",
        title: "expired overlay",
        rule: "use the old way",
        appliesTo: [],
        evidence: [],
        severity: "info",
        confidence: "medium",
        createdFrom: "manual",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-02T00:00:00.000Z", // far past any real clock
      })}\n`,
    );
    const res = await fetch(`${server.baseUrl}/api/workspaces/${KEY}/rules`);
    const body = (await res.json()) as { id: string }[];
    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/workspace-rules.test.ts`
Expected: FAIL — the expired rule is returned.

- [ ] **Step 3: Implement**

In `apps/gui/bridge/routes/workspace-rules.ts`:

```ts
    const ranked = rankApplicableRules(rules, {
      asOf: ctx.now(),
      ...(taskRaw !== null && taskRaw.trim().length > 0 ? { task: taskRaw } : {}),
      files,
    });
```

- [ ] **Step 4: GREEN + verify + commit**

Run: `pnpm --filter @megasaver/gui exec vitest run test/bridge/workspace-rules.test.ts` (pass), then `pnpm verify` from the worktree root.

```bash
git add apps/gui/bridge/routes/workspace-rules.ts apps/gui/test/bridge/workspace-rules.test.ts
git commit -m "feat(gui): exclude expired workspace overlay rules"
```

---

### Task 7: Changesets, full verify, smoke evidence, reviews (DoD gate)

**Files:**
- Create: `.changeset/write-verify-followup.md`

- [ ] **Step 1: Changeset**

```md
---
"@megasaver/core": minor
"@megasaver/mcp-bridge": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Memory write-verify follow-up: the write gate now also covers `mega
memory from-session` (test_failure candidates) and brain autopilot —
autopilot auto-approve requires a verified `autopilot@` attestation
(cross-session recurrence) plus a clean conflict corpus, closing the
machine-approves-contradiction hole; gated rows carry a 90d default TTL
and a system validation sidecar. Agents cannot forge attestations
(fail-closed at the MCP resolver). `mega rules apply` and the GUI
workspace-rules route now exclude expired rules via `asOf`, matching
`get_applicable_rules`.
```

- [ ] **Step 2: Full gate**

Run: `pnpm verify` from the worktree root — biome + tsc + vitest + conventions:check must be green.

- [ ] **Step 3: Smoke evidence (DoD #5, capture into the PR)**

1. `pnpm --filter @megasaver/core exec vitest run test/autopilot.test.ts test/write-verify.test.ts --reporter=verbose` — capture the pass list.
2. `pnpm --filter @megasaver/cli exec vitest run test/memory-from-session.test.ts test/rules.test.ts --reporter=verbose` — capture.
3. Live CLI smoke in a scratch store: seed a session + 1 failed attempt with `mega fail record`, run `node apps/cli/dist/cli.js memory from-session <id> --store <scratch> --json` after `pnpm --filter @megasaver/cli build`, then re-read the store and capture an entry with `expiresAt` + a quarantined sidecar (`memory-validations` file or `getMemoryValidation` via a scratch script — prefer asserting through the CLI only: run `mega memory list` and the sweep to show the TTL is enforced).

- [ ] **Step 4: Reviews (HIGH risk — architect on spec, code-reviewer AND critic on code)**

- Architect pass on the spec+plan (fresh context) — fold findings into `docs/superpowers/specs/2026-08-16-memory-write-513`… (the followup spec) and this plan, commit as `docs(spec,plan): fold architect findings`.
- `code-reviewer` and `critic` separate passes (fresh contexts, author ≠ reviewer) over `git diff main..HEAD` in the worktree.
- Fold feedback per `superpowers:receiving-code-review`; every fix TDD with its own test.

- [ ] **Step 5: Commit**

```bash
git add .changeset/write-verify-followup.md
git commit -m "chore: add changesets for write-verify follow-up"
```

- [ ] **Step 6: Wiki (post-merge, per spec)**

Update the autopilot wiki page (or `concepts/structured-memory-engine` if no autopilot page exists — check `wiki/index.md`), extend the write-gate section with the follow-up surfaces, and append a timestamped `wiki/log.md` entry. Ship via the same PR if possible, else a follow-up docs PR.

---

## Plan self-review notes

- Spec coverage: Decision 1 → Task 4; Decision 2 → Tasks 1-3; Decision 3 → Tasks 2+4 (TTL/sidecar); Decision 4 → Tasks 5-6. Non-goals honored: no approve_memory change, no isRecallable change, no new package, rule table untouched, session_summary ungated (pinned in Tasks 2+4).
- Type consistency: `WriteResolution` shape (5 fields) matches `write-verify.ts`; `PointerResolution.kind` uses the new `autopilot_attestation` literal from Task 1; `MemoryEntryId` import noted in Task 2.
- Known deviation: Task 2's verdict candidate uses a placeholder id (documented in the task) — the same pattern the shipped save_project_rule gate uses.
- Existing autopilot tests that could break: the dry-run byte-identical test (Task 2 keeps `createMemoryEntry`/sidecar behind `!dryRun`); the real-git anchor test (anchor resolves, no dropped files); the cap test (capped row: verdict verified with caller "suggested" → stays suggested/low). All accounted for in Task 2 Step 5.
