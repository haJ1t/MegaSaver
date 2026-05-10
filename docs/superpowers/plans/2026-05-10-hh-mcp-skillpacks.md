# HH — mcp-bridge + skill-packs scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan
> task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-05-10
**Risk:** LOW (placeholder packages, no behavior change to
existing code)
**Batch:** HH (workspace slot reservation for v0.3 deferred
subsystems)
**Branch:** `feat/hh-mcp-skillpacks`
**Specs:**
- `docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`
- `docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md`

## Goal

Reserve two `packages/*` slots called out in `CLAUDE.md §2` but
absent from the workspace today:

- `@megasaver/mcp-bridge` — MCP server (placeholder).
- `@megasaver/skill-packs` — pluggable skill bundles
  (placeholder).

Both ship as **placeholders**: public surface locked, every
entrypoint throws `not_implemented`, closed-enum tuple-ordering
pins in place from day one, full Vitest + Biome + tsc
compliance.

## Architecture

Each package mirrors the existing `@megasaver/shared` /
`@megasaver/core` layout (CLAUDE.md §2 + §3):

```
packages/<name>/
├─ package.json            # @megasaver/<name>, private, ESM, tsup
├─ tsconfig.json           # extends ../../tsconfig.base.json
├─ tsconfig.test.json      # vitest run (rooted at ".")
├─ tsconfig.test-d.json    # vitest typecheck mode
├─ tsup.config.ts          # ESM only, dts, sourcemap, es2023
├─ vitest.config.ts        # typecheck.enabled = true
├─ src/                    # source
└─ test/                   # *.test.ts + *.test-d.ts
```

Workspace registration:

- `pnpm-workspace.yaml` already globs `packages/*` — both new
  packages are picked up automatically.
- `turbo.json` task pipeline already covers `build`,
  `typecheck`, `test`, `lint`, `dev`, `clean` — no edit
  required (pipelines are per-task, not per-package).

## Tech Stack

TypeScript strict ESM, Zod (manifest + enum schemas), Vitest
(typecheck mode), Biome, tsup, pnpm workspace protocol.

## File Map

### `packages/mcp-bridge/`

| File | Purpose |
|------|---------|
| `package.json` | Workspace pkg manifest |
| `tsconfig.json` | Build config (extends base) |
| `tsconfig.test.json` | Vitest typecheck root |
| `tsconfig.test-d.json` | `.test-d.ts` typecheck config |
| `tsup.config.ts` | Build config (ESM) |
| `vitest.config.ts` | Test config with typecheck.enabled |
| `src/index.ts` | Public surface re-exports |
| `src/transport.ts` | `McpTransport` enum + schema |
| `src/errors.ts` | `McpBridgeError` + code schema |
| `src/bridge.ts` | `createBridge(config)` factory |
| `test/bridge.test.ts` | Smoke + `not_implemented` proof |
| `test/transport.test-d.ts` | Tuple-ordering pin |
| `test/errors.test-d.ts` | Tuple-ordering pin |

### `packages/skill-packs/`

| File | Purpose |
|------|---------|
| `package.json` | Workspace pkg manifest |
| `tsconfig.json` | Build config |
| `tsconfig.test.json` | Vitest typecheck root |
| `tsconfig.test-d.json` | `.test-d.ts` typecheck config |
| `tsup.config.ts` | Build config |
| `vitest.config.ts` | Test config with typecheck.enabled |
| `src/index.ts` | Public surface re-exports |
| `src/kind.ts` | `SkillPackKind` enum + schema |
| `src/capability.ts` | `SkillPackCapability` enum + schema |
| `src/manifest.ts` | `SkillPackManifest` + schema |
| `src/errors.ts` | `SkillPackError` + code schema |
| `src/load-pack.ts` | `loadPack(path)` factory |
| `test/load-pack.test.ts` | Smoke + `not_implemented` proof |
| `test/manifest.test.ts` | Schema accept/reject smoke |
| `test/kind.test-d.ts` | Tuple-ordering pin |
| `test/capability.test-d.ts` | Tuple-ordering pin |
| `test/errors.test-d.ts` | Tuple-ordering pin |

---

## Tasks

### Task 1 — `@megasaver/mcp-bridge` scaffold

- [ ] Create `packages/mcp-bridge/package.json` mirroring
  `@megasaver/shared` (`zod ^3.24.1` dep; no shared dep
  because mcp-bridge does not import core types in v0.3).
- [ ] Copy `tsconfig.json`, `tsconfig.test.json`,
  `tsconfig.test-d.json`, `tsup.config.ts`, `vitest.config.ts`
  from `packages/shared/` (path-identical contents — extends
  point upward one fewer dir? No — `packages/mcp-bridge`
  sits at the same depth as `packages/shared`; the
  `../../tsconfig.base.json` reference works identically).
- [ ] Write `src/transport.ts` — Zod enum
  `["stdio", "sse"]` with WHY comment per AA3.
- [ ] Write `src/errors.ts` — `McpBridgeError` + Zod enum
  `["not_implemented"]`.
- [ ] Write `src/bridge.ts` — `createBridge(config)` factory:
  validate `config.transport`; return `{ transport, start, stop }`
  where both methods throw `McpBridgeError("not_implemented", ...)`.
- [ ] Write `src/index.ts` — re-export everything public.
- [ ] Write `test/bridge.test.ts` — smoke + assertion that
  `start()` rejects with the expected code.
- [ ] Write `test/transport.test-d.ts` — tuple-ordering pin
  `readonly ["stdio", "sse"]`.
- [ ] Write `test/errors.test-d.ts` — tuple-ordering pin
  `readonly ["not_implemented"]`.

### Task 2 — `@megasaver/skill-packs` scaffold

- [ ] Create `packages/skill-packs/package.json` mirroring
  `@megasaver/shared`.
- [ ] Copy config files (same as Task 1).
- [ ] Write `src/kind.ts` — Zod enum
  `["prompt", "skill", "workflow"]` with WHY comment
  (alphabetic).
- [ ] Write `src/capability.ts` — Zod enum
  `["network", "read-memory", "write-memory"]`.
- [ ] Write `src/errors.ts` — `SkillPackError` + Zod enum
  `["not_implemented"]`.
- [ ] Write `src/manifest.ts` — `skillPackManifestSchema`
  (name kebab regex, version semver-ish string, kind, skills
  array, capabilities array, description nullable).
- [ ] Write `src/load-pack.ts` — `async loadPack(path)`:
  validate path is string; throw `SkillPackError("not_implemented", ...)`.
- [ ] Write `src/index.ts` — re-export everything public.
- [ ] Write `test/load-pack.test.ts` — smoke + rejection
  assertion.
- [ ] Write `test/manifest.test.ts` — accepts a minimal valid
  manifest; rejects empty object.
- [ ] Write `test/kind.test-d.ts` — tuple-ordering pin.
- [ ] Write `test/capability.test-d.ts` — tuple-ordering pin.
- [ ] Write `test/errors.test-d.ts` — tuple-ordering pin.

### Task 3 — workspace wiring + verify

- [ ] Confirm `pnpm-workspace.yaml` already globs
  `packages/*` (no edit).
- [ ] Confirm `turbo.json` pipelines cover all tasks
  (no edit).
- [ ] Run `pnpm install` to register the new packages in the
  workspace.
- [ ] Run `pnpm --filter @megasaver/mcp-bridge build` —
  expect green.
- [ ] Run `pnpm --filter @megasaver/skill-packs build` —
  expect green.
- [ ] Run `pnpm --filter @megasaver/mcp-bridge test` —
  expect green (smoke + tuple pins).
- [ ] Run `pnpm --filter @megasaver/skill-packs test` —
  expect green.
- [ ] Run `pnpm exec vitest run --no-coverage` from the
  worktree root — expect ALL existing tests still green
  (587 baseline) + new tests.
- [ ] Run `pnpm lint` — expect green.
- [ ] Run `pnpm typecheck` — expect green.

### Task 4 — wiki + commit

- [ ] Append entry to `wiki/log.md`:
  `## [2026-05-10] schema | HH mcp-bridge + skill-packs scaffolded`
- [ ] Single commit: `feat(packages): mcp-bridge + skill-packs scaffolding (HH)`.
- [ ] Push branch + open PR.

---

## Verification

- `pnpm exec vitest run --no-coverage` from worktree root —
  ALL existing tests still pass (587 baseline) + new tests
  (mcp-bridge ≥ 3 + skill-packs ≥ 5).
- `pnpm lint` green.
- `pnpm typecheck` green.
- New packages appear in `pnpm list -r --depth -1`.
- `dist/index.d.ts` of each new package contains the locked
  public surface (`createBridge` and `loadPack` exports).
