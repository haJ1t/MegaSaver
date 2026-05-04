# `@megasaver/shared` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real workspace package (`@megasaver/shared`) carrying the cross-cutting `RiskLevel`, `AgentId`, and three branded entity ID contracts the v0.1 slice depends on.

**Architecture:** Single ESM package authored schema-first via Zod. Public surface re-exported from one barrel `src/index.ts`. Tests in a sibling `test/` directory drive each schema with happy + sad + property-based (`fast-check`) coverage; type-level brand discrimination is asserted with Vitest's `expectTypeOf`.

**Tech Stack:** Node 22 · TypeScript 5.7 strict ESM · pnpm workspaces · Turborepo · tsup · Vitest · Biome · Zod 3 · fast-check 3.

**Spec:** [docs/superpowers/specs/2026-05-04-shared-package-design.md](../specs/2026-05-04-shared-package-design.md)

---

## File Structure

| Path | Role |
|---|---|
| `packages/shared/package.json` | Workspace package manifest. ESM, `private: true`, single `"."` export, `zod` dep, `fast-check` devDep. |
| `packages/shared/tsconfig.json` | Production TS config. Extends root `tsconfig.base.json`. `rootDir: src`, `outDir: dist`. Excludes `test/`. |
| `packages/shared/tsconfig.test.json` | Test TS config. Extends `tsconfig.json`, includes `test/`, disables emit. |
| `packages/shared/tsup.config.ts` | Build config. Single entry, ESM-only, `dts: true`, sourcemap on, `target: es2023`. |
| `packages/shared/vitest.config.ts` | Vitest config. Test glob `test/**/*.test.ts`. |
| `packages/shared/src/index.ts` | Barrel. Re-exports the three primitive modules. |
| `packages/shared/src/risk-level.ts` | `riskLevelSchema` (`z.enum`) + `RiskLevel` type. |
| `packages/shared/src/agent-id.ts` | `agentIdSchema` (`z.enum`) + `AgentId` type. |
| `packages/shared/src/ids.ts` | `projectIdSchema`, `sessionIdSchema`, `memoryEntryIdSchema` (branded UUID) + types. |
| `packages/shared/test/risk-level.test.ts` | Schema tests for risk level. |
| `packages/shared/test/agent-id.test.ts` | Schema tests for agent id. |
| `packages/shared/test/ids.test.ts` | Schema tests for branded IDs + brand-discrimination type assertions. |
| `wiki/entities/shared.md` | New entity page. |
| `wiki/index.md` | Update Entities section. |
| `wiki/log.md` | Append ingest + schema entries. |
| `.changeset/<name>.md` | Initial changeset for the new package. |

Root-level files are **not** modified — `pnpm-workspace.yaml` already globs `packages/*` so the new package is detected automatically.

---

## Task 1 — Scaffold the package and verify the build pipeline

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/tsconfig.test.json`
- Create: `packages/shared/tsup.config.ts`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/test/smoke.test.ts`

This task locks the build pipeline before any production code is written. The smoke test gives Vitest something to discover so the test runner is exercised on day 1.

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@megasaver/shared",
  "version": "0.0.0",
  "private": true,
  "description": "Cross-cutting types and Zod schemas for the Mega Saver workspace.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "fast-check": "^3.23.2"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules", ".turbo"]
}
```

- [ ] **Step 3: Create `packages/shared/tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/shared/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2023",
});
```

- [ ] **Step 5: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

`expectTypeOf` is a runtime-API helper that the `tsc -b` pass already
type-checks; Vitest's separate `typecheck` mode (for `*.test-d.ts`
files) is unnecessary here.

- [ ] **Step 6: Create empty barrel `packages/shared/src/index.ts`**

```ts
// Public surface. Modules added in subsequent tasks re-export here.
export {};
```

- [ ] **Step 7: Create smoke test `packages/shared/test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import * as shared from "../src/index.js";

describe("@megasaver/shared barrel", () => {
  it("loads without throwing", () => {
    expect(shared).toBeDefined();
  });
});
```

Relative import — the package is not yet built, so `dist/` does not
exist and the bare-specifier `@megasaver/shared` would not resolve.
Subsequent test files use the same relative pattern.

- [ ] **Step 8: Install dependencies from the repo root**

Run: `pnpm install`
Expected: pnpm resolves `zod` and `fast-check` for the new workspace; lockfile updates; no errors.

- [ ] **Step 9: Run the smoke test**

Run: `pnpm --filter @megasaver/shared test`
Expected: Vitest discovers `test/smoke.test.ts`, the test passes, exit code 0.

- [ ] **Step 10: Run typecheck**

Run: `pnpm --filter @megasaver/shared typecheck`
Expected: `tsc -b --noEmit` exits 0; no diagnostics.

- [ ] **Step 11: Run build**

Run: `pnpm --filter @megasaver/shared build`
Expected: `dist/` is created with `index.js`, `index.d.ts`, `index.js.map`, `index.d.ts.map`. No other files. Build exits 0.

- [ ] **Step 12: Run lint**

Run: `pnpm lint`
Expected: Biome reports zero issues.

- [ ] **Step 13: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "chore(shared): scaffold package"
```

---

## Task 2 — `riskLevelSchema` (TDD)

**Files:**
- Create: `packages/shared/test/risk-level.test.ts`
- Create: `packages/shared/src/risk-level.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/shared/test/risk-level.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { riskLevelSchema, type RiskLevel } from "../src/risk-level.js";

const members: ReadonlyArray<RiskLevel> = [
  "low",
  "medium",
  "high",
  "critical",
];

describe("riskLevelSchema", () => {
  it("parses every enum member to itself", () => {
    for (const m of members) {
      expect(riskLevelSchema.parse(m)).toBe(m);
    }
  });

  it("rejects a known non-member with a ZodError", () => {
    const result = riskLevelSchema.safeParse("extreme");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("invalid_enum_value");
    }
  });

  it("property: any enum member is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom(...members), (m) => {
        expect(riskLevelSchema.parse(m)).toBe(m);
      }),
    );
  });

  it("property: any string outside the enum is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(members as readonly string[]).includes(s)),
        (s) => {
          expect(riskLevelSchema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `pnpm --filter @megasaver/shared test`
Expected: FAIL with module-not-found for `../src/risk-level.js`.

- [ ] **Step 3: Implement `packages/shared/src/risk-level.ts`**

```ts
import { z } from "zod";

export const riskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
```

- [ ] **Step 4: Update barrel `packages/shared/src/index.ts`**

```ts
export * from "./risk-level.js";
```

- [ ] **Step 5: Run the test — confirm pass**

Run: `pnpm --filter @megasaver/shared test`
Expected: PASS. All four tests in `risk-level.test.ts` green; smoke test still green.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @megasaver/shared typecheck`
Expected: 0 diagnostics.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/risk-level.ts \
        packages/shared/src/index.ts \
        packages/shared/test/risk-level.test.ts
git commit -m "feat(shared): add riskLevelSchema"
```

---

## Task 3 — `agentIdSchema` (TDD)

**Files:**
- Create: `packages/shared/test/agent-id.test.ts`
- Create: `packages/shared/src/agent-id.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/shared/test/agent-id.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { agentIdSchema, type AgentId } from "../src/agent-id.js";

const members: ReadonlyArray<AgentId> = ["claude-code", "generic-cli"];

describe("agentIdSchema", () => {
  it("parses every v0.1 connector id", () => {
    for (const m of members) {
      expect(agentIdSchema.parse(m)).toBe(m);
    }
  });

  it("rejects an agent that has no v0.1 connector (codex)", () => {
    const result = agentIdSchema.safeParse("codex");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("invalid_enum_value");
    }
  });

  it("property: any enum member is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom(...members), (m) => {
        expect(agentIdSchema.parse(m)).toBe(m);
      }),
    );
  });

  it("property: any string outside the enum is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(members as readonly string[]).includes(s)),
        (s) => {
          expect(agentIdSchema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `pnpm --filter @megasaver/shared test`
Expected: FAIL with module-not-found for `../src/agent-id.js`.

- [ ] **Step 3: Implement `packages/shared/src/agent-id.ts`**

```ts
import { z } from "zod";

export const agentIdSchema = z.enum(["claude-code", "generic-cli"]);

export type AgentId = z.infer<typeof agentIdSchema>;
```

- [ ] **Step 4: Update barrel `packages/shared/src/index.ts`**

```ts
export * from "./risk-level.js";
export * from "./agent-id.js";
```

- [ ] **Step 5: Run the test — confirm pass**

Run: `pnpm --filter @megasaver/shared test`
Expected: PASS. All four tests in `agent-id.test.ts` green; previous tests still green.

- [ ] **Step 6: Run typecheck**

Run: `pnpm --filter @megasaver/shared typecheck`
Expected: 0 diagnostics.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/agent-id.ts \
        packages/shared/src/index.ts \
        packages/shared/test/agent-id.test.ts
git commit -m "feat(shared): add agentIdSchema"
```

---

## Task 4 — Branded entity IDs (TDD)

**Files:**
- Create: `packages/shared/test/ids.test.ts`
- Create: `packages/shared/src/ids.ts`
- Modify: `packages/shared/src/index.ts`

This task ships the three IDs together because they share an identical schema shape. Brand discrimination is asserted at the type layer with `expectTypeOf` so a regression that collapses two brand types into the same alias breaks compilation.

- [ ] **Step 1: Write the failing test `packages/shared/test/ids.test.ts`**

```ts
import { describe, it, expect, expectTypeOf } from "vitest";
import * as fc from "fast-check";
import {
  projectIdSchema,
  sessionIdSchema,
  memoryEntryIdSchema,
  type ProjectId,
  type SessionId,
  type MemoryEntryId,
} from "../src/ids.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAMPLE_UUID = "11111111-1111-4111-8111-111111111111";

describe.each([
  ["projectIdSchema", projectIdSchema],
  ["sessionIdSchema", sessionIdSchema],
  ["memoryEntryIdSchema", memoryEntryIdSchema],
] as const)("%s", (_label, schema) => {
  it("parses a known-valid UUID", () => {
    expect(schema.parse(SAMPLE_UUID)).toBe(SAMPLE_UUID);
  });

  it("rejects a non-UUID string", () => {
    const result = schema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });

  it("property: any UUID is accepted", () => {
    fc.assert(
      fc.property(fc.uuid(), (id) => {
        expect(schema.parse(id)).toBe(id);
      }),
    );
  });

  it("property: any non-UUID string is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !UUID_RE.test(s)),
        (s) => {
          expect(schema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });
});

describe("brand discrimination (compile-time)", () => {
  it("ProjectId, SessionId, MemoryEntryId are mutually unassignable", () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<SessionId>();
    expectTypeOf<ProjectId>().not.toEqualTypeOf<MemoryEntryId>();
    expectTypeOf<SessionId>().not.toEqualTypeOf<MemoryEntryId>();
  });

  it("none of the brands collapse to plain string", () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<string>();
    expectTypeOf<SessionId>().not.toEqualTypeOf<string>();
    expectTypeOf<MemoryEntryId>().not.toEqualTypeOf<string>();
  });
});
```

- [ ] **Step 2: Run the test — confirm failure**

Run: `pnpm --filter @megasaver/shared test`
Expected: FAIL with module-not-found for `../src/ids.js`.

- [ ] **Step 3: Implement `packages/shared/src/ids.ts`**

```ts
import { z } from "zod";

export const projectIdSchema = z.string().uuid().brand<"ProjectId">();
export type ProjectId = z.infer<typeof projectIdSchema>;

export const sessionIdSchema = z.string().uuid().brand<"SessionId">();
export type SessionId = z.infer<typeof sessionIdSchema>;

export const memoryEntryIdSchema = z
  .string()
  .uuid()
  .brand<"MemoryEntryId">();
export type MemoryEntryId = z.infer<typeof memoryEntryIdSchema>;
```

- [ ] **Step 4: Update barrel `packages/shared/src/index.ts`**

```ts
export * from "./risk-level.js";
export * from "./agent-id.js";
export * from "./ids.js";
```

- [ ] **Step 5: Run the test — confirm pass**

Run: `pnpm --filter @megasaver/shared test`
Expected: PASS. The three `describe.each` blocks each emit four tests (12), plus the two compile-time blocks; all green.

- [ ] **Step 6: Run typecheck — confirm brand discrimination**

Run: `pnpm --filter @megasaver/shared typecheck`
Expected: 0 diagnostics. (A regression that aliases two brands to the same type would surface here through the `expectTypeOf` calls.)

- [ ] **Step 7: Build and inspect emitted dts**

Run: `pnpm --filter @megasaver/shared build`
Expected: build exits 0; `packages/shared/dist/index.d.ts` declares all three brand types and their schemas.

Verification command:

```bash
grep -E '^(export (declare const|type) (ProjectId|SessionId|MemoryEntryId|projectIdSchema|sessionIdSchema|memoryEntryIdSchema|RiskLevel|riskLevelSchema|AgentId|agentIdSchema))' \
  packages/shared/dist/index.d.ts | sort
```
Expected: 10 lines (5 type aliases + 5 schema constants), one per primitive.

- [ ] **Step 8: Remove the smoke placeholder test**

The smoke test has served its purpose; the real schema tests now exercise the barrel.

Delete: `packages/shared/test/smoke.test.ts`

- [ ] **Step 9: Re-run tests**

Run: `pnpm --filter @megasaver/shared test`
Expected: PASS with the smoke test no longer reported.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/ids.ts \
        packages/shared/src/index.ts \
        packages/shared/test/ids.test.ts
git rm packages/shared/test/smoke.test.ts
git commit -m "feat(shared): add branded entity ids"
```

---

## Task 5 — Wiki updates

**Files:**
- Create: `wiki/entities/shared.md`
- Modify: `wiki/index.md`
- Modify: `wiki/log.md`

The wiki is the canonical project-knowledge channel ([wiki-first feedback rule](../../wiki/CLAUDE.md)). The Entities section was placeholder until v0.1 packages started landing — `shared` unblocks it.

- [ ] **Step 1: Create `wiki/entities/shared.md`**

```markdown
---
title: '@megasaver/shared'
tags: [entity, package, contracts, v0.1]
sources:
  - docs/superpowers/specs/2026-05-04-shared-package-design.md
  - docs/superpowers/plans/2026-05-04-shared-package-plan.md
status: active
created: 2026-05-04
updated: 2026-05-04
---

# `@megasaver/shared`

The cross-cutting contracts package. Every other v0.1 package
(`core`, `cli`, `connectors/claude-code`, `connectors/generic-cli`)
imports the canonical types and Zod schemas from here.

## Scope

Contracts only — no runtime util, no constants, no agent-specific
knowledge. v0.1 surface:

- `RiskLevel` — `"low" | "medium" | "high" | "critical"` enum
  (CLAUDE.md §12).
- `AgentId` — closed enum of agents that ship a v0.1 connector
  (`claude-code`, `generic-cli`). New agents are added by their own
  connector spec.
- `ProjectId`, `SessionId`, `MemoryEntryId` — UUID strings branded
  for compile-time discrimination.

Out of scope is recorded in the spec §11.

## Authoring style

Schema-first via Zod. Types are derived with `z.infer<typeof X>` so
the runtime parser and the static type stay in lock-step.

Tests live in `packages/shared/test/` and combine three layers:
happy + sad case → property-based via `fast-check` → compile-time
brand discrimination via Vitest's `expectTypeOf`.

## Boundary rules

- Anything agent-specific belongs in `connectors/<agent>/`, not
  here ([[concepts/agent-agnostic-core]]).
- Entity schemas land with the feature that consumes them — they
  do not live in this package preemptively.

## Related

- [[decisions/bootstrap-matrix]] — sets the package roster.
- [[concepts/agent-agnostic-core]] — why scope is contracts-only.
- [[syntheses/mega-saver-product]] — v0.1 slice membership.
```

- [ ] **Step 2: Update `wiki/index.md`**

Replace the existing `## Entities (none seeded yet)` block:

```markdown
Subsystem pages will land as features get built. Slot reserved for: `core-engine`, `cli`, `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`.
```

with:

```markdown
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1).

More subsystem pages land as features get built. Slot reserved for: `core-engine`, `cli`, `connectors-claude-code`, `connectors-generic-cli`, `mcp-bridge`, `app`, `skill-packs`.
```

Bump the frontmatter `updated:` field to `2026-05-04`.

- [ ] **Step 3: Append to `wiki/log.md`**

Append at the bottom (preserving every existing entry):

```markdown
## [2026-05-04] ingest | shared package spec + plan

Wrote `docs/superpowers/specs/2026-05-04-shared-package-design.md` and `docs/superpowers/plans/2026-05-04-shared-package-plan.md`. Locked v0.1 surface for the new package: `RiskLevel`, `AgentId`, three branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). Schema-first via Zod; Vitest + fast-check; ESM-only; `private: true` until v0.1 release. Risk MEDIUM.

## [2026-05-04] ingest | entities/shared seeded

Wrote `wiki/entities/shared.md` and unblocked the Entities section of `index.md`. Future entity pages (`core-engine`, `cli`, connector pages) follow the same template.
```

- [ ] **Step 4: Commit**

```bash
git add wiki/entities/shared.md wiki/index.md wiki/log.md
git commit -m "docs(wiki): seed shared entity page"
```

---

## Task 6 — Changeset

**Files:**
- Create: `.changeset/shared-package-init.md`

Even though the package is `private: true`, Changesets still tracks workspace-internal API events; the first appearance of a package is release-relevant when `private` flips to `false` at v0.1.

- [ ] **Step 1: Inspect Changesets config**

Run: `cat .changeset/config.json | head`
Expected: `"access"` and `"baseBranch"` keys present (configured during the project skeleton spec).

- [ ] **Step 2: Create `.changeset/shared-package-init.md`**

```markdown
---
"@megasaver/shared": minor
---

Initial release of `@megasaver/shared` — cross-cutting contracts package. v0.1 surface: `RiskLevel`, `AgentId`, branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`). Schema-first via Zod, ESM-only.
```

- [ ] **Step 3: Sanity-check the changeset**

Run: `pnpm changeset status`
Expected: Reports `@megasaver/shared` with bump type `minor`. No errors.

- [ ] **Step 4: Commit**

```bash
git add .changeset/shared-package-init.md
git commit -m "chore(shared): add init changeset"
```

---

## Task 7 — Final verification + smoke evidence

**Files:** none.

This task is the DoD evidence collection. Every command must succeed before requesting review.

- [ ] **Step 1: Clean any stale build artifacts**

Run: `pnpm --filter @megasaver/shared clean`
Expected: `dist/` removed (if present), exit 0.

- [ ] **Step 2: Full root verify**

Run: `pnpm verify`
Expected: `pnpm lint` (Biome) → `pnpm typecheck` (turbo → tsc -b) → `pnpm test` (turbo → build → vitest) all green. Exit code 0.

- [ ] **Step 3: Capture build artefact evidence**

Run:
```bash
ls -1 packages/shared/dist
```
Expected, exactly:
```
index.d.ts
index.d.ts.map
index.js
index.js.map
```

- [ ] **Step 4: Capture public API surface evidence**

Run:
```bash
grep -E '^(export (declare const|type) )' packages/shared/dist/index.d.ts | sort
```
Expected: 10 lines covering `riskLevelSchema`, `RiskLevel`, `agentIdSchema`, `AgentId`, `projectIdSchema`, `ProjectId`, `sessionIdSchema`, `SessionId`, `memoryEntryIdSchema`, `MemoryEntryId`. Save the output into the PR description.

- [ ] **Step 5: Capture test count evidence**

Run: `pnpm --filter @megasaver/shared test`
Expected tail line resembles `Test Files  3 passed (3)` and `Tests  20 passed (20)` (4 risk-level + 4 agent-id + 12 ids + 2 brand-discrimination compile-time descriptors). Save into PR description.

- [ ] **Step 6: Push the branch and open the PR**

```bash
git push -u origin feat/shared-package
gh pr create \
  --title "feat(shared): add @megasaver/shared contracts package" \
  --body "$(cat <<'EOF'
## Summary
- New workspace package `@megasaver/shared` carrying cross-cutting contracts: `RiskLevel`, `AgentId`, branded entity IDs (`ProjectId`, `SessionId`, `MemoryEntryId`).
- Schema-first via Zod. Vitest + fast-check tests. ESM-only build via tsup.
- `private: true` for now — public flip ships with v0.1 release.

## Spec / plan
- Spec: `docs/superpowers/specs/2026-05-04-shared-package-design.md`
- Plan: `docs/superpowers/plans/2026-05-04-shared-package-plan.md`

## Smoke evidence
- `dist/` contents and `index.d.ts` public surface captured in CI logs.
- `pnpm verify` green from a clean checkout.

## Test plan
- [ ] `pnpm install`
- [ ] `pnpm verify`
- [ ] Inspect `packages/shared/dist/index.d.ts` matches the spec surface.
- [ ] Reviewer agent pass (fresh context).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens with the bullet list above; CI starts.

- [ ] **Step 7: Request external review**

Dispatch a fresh-context `code-reviewer` agent against the PR (per CLAUDE.md §9 #6). The author session must not also approve.

After approval and CI green, merge per the established trunk-based pattern (squash or fast-forward; see `wiki/log.md` precedent for PRs #1 and #2). Tear down the worktree:

```bash
cd /Users/halitozger/Desktop/MegaSaver
git worktree remove ../MegaSaver-shared-package
git branch -d feat/shared-package
git fetch --prune
```

Append a final `schema | shared package PR #N merged` line to `wiki/log.md` from the main checkout (separate trivial commit on main).

---

## Definition of Done — final cross-check

When every box above is ticked, walk the spec §10 list and confirm:

- Spec ✓ (Task 0 — already committed in this branch).
- Plan ✓ (this file).
- TDD ✓ (Tasks 2-4: test before impl).
- `pnpm verify` green ✓ (Task 7 step 2).
- Smoke evidence ✓ (Task 7 steps 3-5).
- `code-reviewer` pass ✓ (Task 7 step 7).
- `verifier` pass ✓ (run after reviewer).
- Zero pending TodoWrite ✓ (close the list at merge).
- Changeset ✓ (Task 6).
- Wiki updated ✓ (Task 5).
- Agent files unchanged ✓ (no convention drift in this PR).

If any box stays empty, do **not** claim "done" — return to the failing task.
