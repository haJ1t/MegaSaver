---
title: BB12 — extract context-gate orchestrator into @megasaver/context-gate
status: proposed
risk: MEDIUM
created: 2026-05-13
updated: 2026-05-13
epic: AA1 (Context Gate / Mega Saver Mode)
parent-spec: ./2026-05-10-aa1-context-gate-epic.md
trigger: AA1 §2a deferred-extraction trigger (FIRED — see §1)
execute-after: BB8 + BB11 merged
---

# BB12 — context-gate package extraction

## §1 Problem

AA1 §2a folded the context-gate orchestrator into
`@megasaver/core` for BB1–BB7b and locked a **deferred-extraction
trigger**: *"After BB7b lands … audit `packages/core/src/context-gate/`.
If total LOC … exceeds 500 lines, extract to `@megasaver/context-gate`
… (call it BB12 …). If ≤ 500 LOC, keep folded."* (AA1 §2a, §19a, §20e.)

The audit has fired. `wc -l packages/core/src/context-gate/*.ts`
on `main @ 751df6c` (BB1–BB7b merged):

```
 37 fetch-chunk.ts
 31 locate-chunk-set.ts
113 read.ts
280 run-command.ts
 70 run.ts
 22 types.ts
553 total
```

553 > 500 → the trigger is FIRED. This spec locks the extraction
into a standalone `@megasaver/context-gate` package. The principle
AA1 §19a deferred ("agent-agnostic-core argues orchestration is its
own package; the pragma avoided a premature split") now gets its
date with data.

**Note on the file set.** AA1 §2a's hypothetical file list
(`enable/disable/run/session-policy/context-hints/types.ts`) never
materialised; the real BB1–BB7b orchestrator is
`run / run-command / read / fetch-chunk / locate-chunk-set / types`.
The 500-LOC trigger applies to the actual files, which is what the
553 count above measures. (`context-gate.ts` barrel = 23 more LOC;
it moves too but is excluded from the 553 trigger count, matching
§2a's wording "across … `*.ts`" inside the folder.)

This is a **behavior-preserving refactor**: no runtime logic
changes; only the package boundary moves. MEDIUM risk (public
surface of `@megasaver/core` changes — it stops *owning* the
orchestrator and starts *re-exporting* it — but no user-observable
behavior changes).

## §2 The inversion check (make-or-break)

Today these files live in core and core re-exports them. After
extraction, the new package MUST NOT depend on `@megasaver/core`
(AA1 §3c). **Does any moved file import from `@megasaver/core`?**

**Yes — exactly one symbol, in four files, type-only:**

| File             | Offending import                                  |
|------------------|---------------------------------------------------|
| `types.ts`       | `import type { CoreRegistry } from "../registry.js"` |
| `read.ts`        | `import type { CoreRegistry } from "../registry.js"` |
| `run.ts`         | `import type { CoreRegistry } from "../registry.js"` |
| `run-command.ts` | `import type { CoreRegistry } from "../registry.js"` |

`fetch-chunk.ts` and `locate-chunk-set.ts` import only
`@megasaver/content-store` + `@megasaver/shared` — clean.

`CoreRegistry` (`packages/core/src/registry.ts:13–29`) is a 12-method
interface over the core entity layer (`Session`, `Project`,
`MemoryEntry`, `SessionUpdatePatch`, `TokenSaverSettings`). It cannot
be hoisted to `@megasaver/shared` without dragging the whole entity
layer with it — that would be a far larger refactor and is out of
scope for a behavior-preserving extraction.

**Resolution — structural port (no symbol hoist, no DI rewrite).**
The orchestrator uses only **two** read methods of the registry —
`getSession(id)` and `getProject(id)` (both in `read.ts:28,30`;
`run.ts`/`run-command.ts`/`types.ts` only *name* the type in their
input shapes, they never call other methods). The new package
defines its own minimal **structural** interface and depends on it
instead of core's `CoreRegistry`:

```ts
// packages/context-gate/src/registry-port.ts (NEW)
import type { ProjectId, SessionId } from "@megasaver/shared";

// Structural port: the slice of a registry the orchestrator reads.
// @megasaver/core's CoreRegistry structurally satisfies this, so
// callers keep passing a CoreRegistry with no cast (TS structural
// typing). Defined here to break the context-gate → core edge.
export interface OrchestratorRegistry {
  getSession(id: SessionId): SessionView | null;
  getProject(id: ProjectId): ProjectView | null;
}

export interface SessionView {
  projectId: ProjectId;
  tokenSaver?: {
    mode: import("@megasaver/shared").TokenSaverMode;
    maxReturnedBytes?: number;
    storeRawOutput?: boolean;
  };
}

export interface ProjectView {
  rootPath: string;
}
```

The four `import type { CoreRegistry } from "../registry.js"` lines
become `import type { OrchestratorRegistry } from "./registry-port.js"`
(and the field type `registry: CoreRegistry` becomes
`registry: OrchestratorRegistry`). Because TypeScript is structural,
core's concrete `CoreRegistry` is assignable to `OrchestratorRegistry`
with **no change at any call site** — `apps/cli` and `mcp-bridge`
pass a `createJsonDirectoryCoreRegistry()` exactly as before.

**Result of the inversion check: 4 offending imports found; all
resolved by a 3-property structural port. No symbol hoisted to
shared; no behavior change; zero call-site churn.** This is the
make-or-break and it passes.

(`SessionView`/`ProjectView` carry only the fields `read.ts` reads:
`session.projectId`, `session.tokenSaver?.{mode,maxReturnedBytes,
storeRawOutput}`, `project.rootPath`. `tokenSaver.redactSecrets`/
`autoRepair`/`enabled` etc. are NOT read by the orchestrator path,
so they stay out of the port.)

## §3 Locked surface

**New package** `packages/context-gate`, name
`@megasaver/context-gate`, holding the 6 moved source files + the
barrel + the new `registry-port.ts`. Public exports = exactly what
`packages/core/src/context-gate.ts` re-exports today (the barrel
moves verbatim, repointed to `./*.js` within the new package), plus
the three port interfaces (`OrchestratorRegistry`, `SessionView`,
`ProjectView`).

**Dependency edges (locked, per AA1 §3c).**
`@megasaver/context-gate` depends ONLY on:

```
@megasaver/shared        (SessionId, ProjectId, TokenSaverMode, modeToBudget)
@megasaver/policy        (evaluateCommand, evaluatePathRead, PolicyDenyCode)
@megasaver/output-filter (filterOutput, resolveSafeReadPath, FilterOutputResult)
@megasaver/content-store (saveChunkSet, loadChunkSet, ChunkSet, Chunk, ContentStoreError)
@megasaver/stats         (appendEvent, TokenSaverEvent)
zod                      (transitive only; no direct use today — omitted unless needed)
```

It MUST NOT depend on `@megasaver/core`, `@megasaver/mcp-bridge`,
or any `apps/*`. This is precisely the AA1 §3c allow-list that
`@megasaver/core`'s folded context-gate was already constrained to
(the existing guard `packages/core/test/context-gate/dependency-direction.test.ts`
allow-list: content-store, output-filter, policy, shared, stats —
BB7b widened it to add stats). The new package inherits that exact
allow-list.

**Consumer strategy — LOCKED: (a) core re-exports.**

`@megasaver/core` gains `@megasaver/context-gate` as a runtime
dependency and `packages/core/src/context-gate.ts` becomes a
thin re-export FROM the new package:

```ts
// packages/core/src/context-gate.ts (after BB12)
export * from "@megasaver/context-gate";
```

`packages/core/src/index.ts` keeps `export * from "./context-gate.js";`
unchanged. Therefore every consumer that imports
`runOutputPipeline / runOutputExecCommand / fetchChunk / locateChunkSet`
(and their types) **from `@megasaver/core` keeps working untouched**:

- `apps/cli/src/commands/output/file.ts`, `filter.ts` →
  `runOutputPipeline` from `@megasaver/core`.
- `apps/cli/src/commands/output/exec.ts` →
  `runOutputExecCommand` + `RunOutputExecResult` from `@megasaver/core`.
- `apps/cli/src/commands/output/chunk.ts` →
  `fetchChunk` + `FetchChunkResult` from `@megasaver/core`.
- `packages/mcp-bridge` (BB8, merged) →
  `fetchChunk`, `runOutputPipeline`, `runOutputExecCommand` from
  `@megasaver/core` (confirmed in BB8's source).

**Reasoning for (a) over (b).** Strategy (b) (repoint every
consumer to `@megasaver/context-gate` directly) would touch
4 CLI files + the entire mcp-bridge tool layer (and add a
`@megasaver/context-gate` dep to both `apps/cli` and
`@megasaver/mcp-bridge`) for zero functional gain — pure churn,
the opposite of behavior-preserving. Strategy (a) confines the
diff to the package boundary.

**Cycle check on (a).** The new edge is **core → context-gate**
(runtime). AA1 §3c forbids the reverse (context-gate → core), which
§2 just broke via the structural port. core → context-gate is
directionally fine: context-gate sits at the same layer as
policy/output-filter/content-store/stats (all of which core already
depends on), and it depends on none of them in the reverse
direction. No cycle closes. The existing core dep-graph guard
(`apps/gui/bridge` OO precedent; AA1 §3c) continues to hold: core
may depend on "all packages above" including the new one.

**Guard relocation.** `packages/core/test/context-gate/dependency-direction.test.ts`
moves to `packages/context-gate/test/dependency-direction.test.ts`
and is rewritten to assert the NEW package's `package.json`
`dependencies` equal the allow-list
**{content-store, output-filter, policy, shared, stats}** (alphabetic),
forbid `@megasaver/core`, forbid `@megasaver/mcp-bridge`, forbid
`apps/*`. (It currently parses `../../package.json` for core; the
moved copy parses `../package.json` for context-gate — note the
path-depth change from `../../` to `../`, matching the
output-filter/stats dep-graph tests which live one level shallower.)

**Test split (behavior-preserving).** Three of the six context-gate
test files (`run.test.ts`, `run-command.test.ts`, `read.test.ts`)
build a **real** registry via `createJsonDirectoryCoreRegistry`
(a core implementation) and pass it into the orchestrator. Moving
those tests into `@megasaver/context-gate` would force a
`@megasaver/core` **devDependency** on the new package — a test-only
core↔context-gate cycle that muddies the §3c guard. To stay
behavior-preserving AND keep the package graph clean:

- **Stay in `packages/core/test/context-gate/`** (they test core's
  *composed* surface — core re-exports the orchestrator and owns the
  registry, so registry+orchestrator integration tests belong with
  core): `run.test.ts`, `run-command.test.ts`, `read.test.ts`.
  Their imports stay `from "../../src/index.js"` (core barrel,
  which still re-exports the orchestrator). The one deep import in
  `run-command.test.ts` (`from "../../src/context-gate/run-command.js"`)
  is repointed to `@megasaver/context-gate` since that internal path
  no longer exists in core.
- **Move to `packages/context-gate/test/`** (registry-free — they
  exercise only the on-disk content store): `fetch-chunk.test.ts`,
  `locate-chunk-set.test.ts`. Their imports repoint
  `../../src/index.js` / `@megasaver/core` → `../src/index.js`.
- **Move to `packages/context-gate/test/`**: `dependency-direction.test.ts`
  (rewritten per "Guard relocation" above).

This split is the minimal change that (i) preserves every existing
test assertion verbatim, (ii) keeps `@megasaver/context-gate` free
of any core dependency in both `dependencies` and `devDependencies`,
(iii) lands the dep-direction guard in the new package.

## §4 Alternatives considered

- **(b) Repoint consumers to `@megasaver/context-gate` directly —
  REJECTED.** Touches 4 CLI files + the merged mcp-bridge tool layer
  + two `package.json` dep lists for zero functional benefit.
  Strategy (a) confines the diff to the boundary. (See §3.)
- **Hoist `CoreRegistry` to `@megasaver/shared` — REJECTED.**
  `CoreRegistry` is the core entity-layer facade (12 methods over
  Session/Project/MemoryEntry). Hoisting it drags the entity layer
  into shared — a large, non-behavior-preserving change. The
  3-property structural port (§2) achieves the inversion at a
  fraction of the surface. Mirrors AA1 §19e's logic (hoist only the
  cross-cutting closed enum, not the whole type) but here even the
  hoist is unnecessary — a local port suffices.
- **Move ALL six test files + add `@megasaver/core` devDep —
  REJECTED.** Creates a test-only core↔context-gate package cycle
  and forces the §3c guard to carve a core-in-devDeps exception,
  weakening the very guarantee the guard exists to enforce. The
  §3 split keeps the graph clean with no test-body rewrites.
- **Rewrite the registry-coupled tests to use an in-test fake
  registry (so all tests can move cleanly) — REJECTED.** Changes
  test behavior (loses real-registry integration coverage) and is a
  larger diff — both contrary to "behavior-preserving".
- **Keep folded (do not extract) — REJECTED by the trigger.**
  553 > 500; AA1 §2a/§19a/§20e make the extraction non-discretionary
  once the count exceeds 500.

## §5 Risk

**MEDIUM.** Behavior-preserving refactor of a package boundary.
The orchestrator includes the CRITICAL `mega output exec` /
`mega_run_command` spawn path (`run-command.ts`), but BB12 moves
that code **verbatim** (git mv, no logic edit) — the CRITICAL
surface itself is unchanged and was already reviewed under BB7b.
The risk in BB12 is structural (a cycle slipping in, a consumer
breaking), not behavioral. Mitigations: the relocated dep-direction
guard (no cycle), the unchanged consumer imports (strategy (a)), and
`pnpm verify` exercising every moved test from its new home.

**Execution constraint: AFTER BB8 + BB11 merge.** BB8 (mcp-bridge)
and BB11 (connector CONTEXT_GATE block) consume the orchestrator
via `@megasaver/core`. Extracting mid-flight would churn their
diffs. A BB8 workflow is running concurrently in
`.worktrees/bb8-mcp-bridge`; BB12 must not start its code phase
until BB8 + BB11 are on `main`. (This is a sequencing constraint on
*execution*; authoring the spec/plan now is fine.)

## §6 Definition of Done

1. This spec exists (`docs/superpowers/specs/2026-05-13-bb12-context-gate-extract-design.md`).
2. Plan exists (`docs/superpowers/plans/2026-05-13-bb12-context-gate-extract-plan.md`).
3. `@megasaver/context-gate` package created, added to the
   `pnpm-workspace.yaml` `packages/*` glob (already matched — no
   YAML edit needed; confirm in plan), scaffolded mirroring
   `packages/stats` (package.json / tsconfig.json / tsconfig.test.json /
   tsconfig.test-d.json / tsup.config.ts / vitest.config.ts).
4. The 6 src files + barrel moved via `git mv` (history preserved);
   the 4 `CoreRegistry` imports replaced by the structural port
   (§2); internal `../registry.js` references gone.
5. `@megasaver/core` re-exports from `@megasaver/context-gate`
   (strategy (a)); `apps/cli` + `mcp-bridge` imports unchanged.
6. Dep-direction guard relocated to
   `packages/context-gate/test/dependency-direction.test.ts`
   asserting deps = {content-store, output-filter, policy, shared,
   stats} alphabetic; forbidding core / mcp-bridge / apps.
7. Registry-free tests (`fetch-chunk`, `locate-chunk-set`) moved to
   the new package; registry-coupled tests (`run`, `run-command`,
   `read`) remain in core with the one deep import repointed.
8. **No cycle:** `@megasaver/context-gate` has no `@megasaver/core`
   in `dependencies` OR `devDependencies`; the new dep-direction
   test passes.
9. `pnpm verify` green (lint + typecheck + test) across the
   workspace; all context-gate tests green from their new homes.
10. Changeset added covering the new package (`@megasaver/context-gate`
    minor — new public package) and the `@megasaver/core`
    public-surface change (patch — re-export source moved, surface
    identical).
11. §2a record: `wc -l packages/context-gate/src/*.ts` captured in
    the verifier evidence bundle (the post-extraction location of
    the count that fired the trigger).
12. External reviewer + verifier pass (AA1 / CLAUDE.md §9); author ≠
    reviewer.
