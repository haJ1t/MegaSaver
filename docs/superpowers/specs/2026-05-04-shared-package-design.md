---
title: '@megasaver/shared — v0.1 contracts package'
date: 2026-05-04
risk: medium
status: approved
related:
  - docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md
  - docs/superpowers/specs/2026-05-03-project-skeleton-design.md
  - wiki/concepts/agent-agnostic-core.md
  - wiki/decisions/bootstrap-matrix.md
---

# `@megasaver/shared` — v0.1 contracts package

## 1. Context

The `MegaSaver/` repository carries a complete pnpm + Turborepo
skeleton (PR #2, merged 2026-05-03). `apps/` and `packages/` are
empty — no real package has landed yet.

`@megasaver/shared` is the first real package and the chosen entry
point for v0.1 implementation. Its role per
`docs/conventions/repo-layout.md` is **types, schemas, util** — i.e.
the cross-cutting bounded context every other v0.1 package
(`core`, `cli`, `connectors/claude-code`, `connectors/generic-cli`)
will import from.

The non-negotiable principle from
[wiki/concepts/agent-agnostic-core](../../../wiki/concepts/agent-agnostic-core.md):
shared carries **zero agent-specific knowledge**. CLAUDE.md / AGENTS.md
/ `.cursor/rules` formats live in their respective connectors, never
here.

## 2. Goal

Ship the smallest contracts surface that:

1. Lets every v0.1 package import a single canonical `RiskLevel`,
   `AgentId`, and the three entity ID brand types it will need.
2. Validates the build pipeline end-to-end (TypeScript strict ESM →
   tsup → emit → consumed via workspace protocol).
3. Locks in the package authoring conventions (schema-first via Zod,
   single barrel export, Vitest + fast-check tests) for every future
   `@megasaver/<name>` package.

Out of scope: see §11.

## 3. Locked decisions (from 2026-05-04 brainstorm)

| # | Decision                       | Value                                                                  |
|---|--------------------------------|------------------------------------------------------------------------|
| 1 | Scope                          | Contracts-only. No runtime util, no shared constants.                  |
| 2 | v0.1 surface                   | Cross-cutting primitives only: `RiskLevel`, `AgentId`, 3 ID brands.    |
| 3 | Authoring style                | Schema-first via Zod; types via `z.infer<typeof Schema>`.              |
| 4 | Public surface shape           | Single barrel `src/index.ts`. One `"."` export in `package.json`.      |
| 5 | Test strategy                  | Vitest happy + sad + property-based via `fast-check`; type-level via `expectTypeOf`. |
| 6 | Build target                   | ESM-only, ES2023, dts emit, sourcemap, single entry.                   |
| 7 | Privacy                        | `"private": true` for v0.1 dev. Public-publish flip is its own spec at v0.1 release. |
| 8 | Risk level                     | MEDIUM (see §9).                                                       |

These cannot be relaxed without a follow-up spec.

## 4. Public surface

### 4a. `RiskLevel`

```ts
// src/risk-level.ts
import { z } from "zod";

export const riskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export type RiskLevel = z.infer<typeof riskLevelSchema>;
```

Source of values: `CLAUDE.md` §12 +
[wiki/concepts/risk-aware-development](../../../wiki/concepts/risk-aware-development.md).
Any future expansion (e.g. an additional level) requires its own spec
and a major-version changeset.

### 4b. `AgentId`

```ts
// src/agent-id.ts
import { z } from "zod";

export const agentIdSchema = z.enum([
  "claude-code",
  "generic-cli",
]);

export type AgentId = z.infer<typeof agentIdSchema>;
```

The enum lists **only agents Mega Saver actually ships a connector
for in v0.1**. Adding a new agent (`codex`, `cursor`, `aider`, …) is
a breaking-change extension performed in the connector's own spec,
which extends this enum and ships a coordinated changeset.

Rationale: a closed enum lets connector routing code rely on
exhaustive checks (`switch (agentId) { ... }` with no `default` arm
needed) and prevents "stub agents with no connector" from leaking
into product surfaces.

### 4c. Branded entity IDs

```ts
// src/ids.ts
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

Three IDs only — these correspond to the three entities every v0.1
package already references conceptually
([wiki/syntheses/mega-saver-product](../../../wiki/syntheses/mega-saver-product.md)
§ "v0.1 slice"): a project, a session, a memory entry. Additional
brands land with the feature that introduces the entity.

`brand<...>()` gives compile-time discrimination: `ProjectId` is not
assignable to `SessionId` even though both are runtime strings.

### 4d. Barrel

```ts
// src/index.ts
export * from "./risk-level.js";
export * from "./agent-id.js";
export * from "./ids.js";
```

Single public entry. No subpath exports yet.

## 5. File layout

```
packages/shared/
├─ src/
│  ├─ risk-level.ts
│  ├─ agent-id.ts
│  ├─ ids.ts
│  └─ index.ts
├─ test/
│  ├─ risk-level.test.ts
│  ├─ agent-id.test.ts
│  └─ ids.test.ts
├─ package.json
├─ tsconfig.json
├─ tsconfig.test.json
├─ tsup.config.ts
└─ vitest.config.ts
```

Tests are **outside** `src/` so the build (which uses
`rootDir: "src"`) cannot accidentally emit them into `dist/`.

## 6. `package.json`

```json
{
  "name": "@megasaver/shared",
  "version": "0.0.0",
  "private": true,
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

`sideEffects: false` enables full tree-shaking for downstream
consumers. `"private": true` prevents accidental publish; it is
flipped in the v0.1 release spec, not here.

## 7. Build & TypeScript config

### 7a. `tsup.config.ts`

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

ESM-only. Node 22 is ESM-native and the repo is `"type": "module"`
throughout — no CJS dual-output complexity.

### 7b. `tsconfig.json`

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

### 7c. `tsconfig.test.json`

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

Vitest reads this for type-aware test compilation; the production
`tsconfig.json` stays test-clean so dts emit is not polluted.

## 8. Test strategy

`vitest.config.ts` runs `test/**/*.test.ts`. Each schema gets three
layers of coverage:

1. **Happy path** — known-valid input parses to the expected value.
2. **Sad path** — known-invalid input throws `ZodError` with the
   expected `issues[0].code`.
3. **Property-based** (`fast-check`) — randomized inputs:
   - `riskLevelSchema`: `fc.constantFrom(...members)` → success;
     `fc.string().filter(s => !members.includes(s as RiskLevel))` →
     `safeParse({ success: false })`.
   - `agentIdSchema`: same pattern.
   - ID brand schemas: `fc.uuid()` → success;
     `fc.string().filter(s => !UUID_RE.test(s))` → fail.

Type-level discrimination uses Vitest's built-in `expectTypeOf`:

```ts
import { expectTypeOf } from "vitest";
import type { ProjectId, SessionId } from "@megasaver/shared";

expectTypeOf<ProjectId>().not.toEqualTypeOf<SessionId>();
expectTypeOf<ProjectId>().not.toEqualTypeOf<string>();
```

A compile failure here blocks merge, satisfying TDD discipline at
the type layer.

## 9. Risk level — MEDIUM

Not HIGH because: no crypto, no data deletion, no permission code,
no user-file scale work. Pure types and schemas; runtime side-effects
are limited to Zod parsing.

Not LOW because: this is the first cross-cutting public surface. A
mistake here (wrong brand semantics, leaky type, wrong enum value)
ripples into every v0.1 package and is a breaking change to undo.
Reviewer pass is mandatory.

Per CLAUDE.md §12: full superpowers chain + `code-reviewer` pass.

## 10. Definition of Done

All must hold (CLAUDE.md §9):

- [ ] Spec file exists (this file).
- [ ] Plan file exists at
  `docs/superpowers/plans/2026-05-04-shared-package-plan.md`.
- [ ] TDD: every schema test was written before its production
  module — verified via per-commit chronology.
- [ ] `pnpm verify` (root) green.
- [ ] `pnpm --filter @megasaver/shared build` green; `dist/` contains
  `index.js`, `index.d.ts`, sourcemaps; nothing else.
- [ ] Smoke evidence captured:
  - `dist/index.d.ts` exposes `RiskLevel`, `AgentId`, `ProjectId`,
    `SessionId`, `MemoryEntryId`, plus the matching `*Schema` values.
  - The brand-discrimination `expectTypeOf` test compiles.
- [ ] `code-reviewer` reviewer pass in a fresh context (author ≠
  reviewer).
- [ ] `verifier` agent pass; DoD evidence collected.
- [ ] Zero pending TodoWrite items.
- [ ] Changeset added (new public package, even though `private:
  true` for now — first appearance is a release-relevant event).
- [ ] Wiki updated:
  - `wiki/entities/shared.md` written.
  - `wiki/index.md` `Entities` section unblocked.
  - `wiki/log.md` carries an `ingest` entry for this spec and a
    `schema` entry once the PR merges.
- [ ] Agent files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`)
  unchanged — no convention drift introduced.

## 11. Out of scope (deferred)

- **Util functions** (slugify, deepMerge, deterministic JSON, …) —
  added when at least two packages independently demonstrate the
  need.
- **Constants / defaults** (token budgets, file-name constants) —
  live in the package that owns them, not here.
- **Entity schemas** (`Project`, `Session`, `MemoryEntry`,
  `TokenBudget`, …) — land with the feature that consumes them. Each
  gets its own spec.
- **`packages/shared/i18n`** — v0.2.
- **CJS output** — never (Node 22 + ESM-only repo).
- **Subpath exports** — revisited if shared grows to v0.2 entity
  weight.
- **Public publish to npm** — separate v0.1 release spec.

## 12. Open questions

None. All design questions resolved in the 2026-05-04 brainstorm;
locked decisions in §3.
