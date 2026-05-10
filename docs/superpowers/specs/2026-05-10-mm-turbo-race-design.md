---
title: MM turbo ^build race fix for vitest typecheck — design
risk: LOW
status: active
created: 2026-05-10
updated: 2026-05-10
---

# MM — turbo `^build` dep for vitest typecheck — Design

## §1 Problem statement

`pnpm exec turbo run test --force` intermittently fails in
`@megasaver/cli` vitest typecheck on
`apps/cli/test/known-targets.test-d.ts:22` with:

> Unused `@ts-expect-error` directive.

Source: code-reviewer's verifier soft-flag on PR #57 (GUI v1 / LL),
captured as issue #60.

Standalone `pnpm --filter @megasaver/cli test` and `pnpm verify`
(which orders typecheck before test) pass deterministically — the
race only surfaces under `turbo run test` cold cache, where vitest
typecheck consumes a sibling workspace package's `.d.ts` files
before the producer's `tsup` DTS build has emitted them.

## §2 Root cause

Two compounding issues:

**A — `turbo.json` missing `^build`:** `test.dependsOn` was
`["build"]` — only the package's own build, not workspace deps'
builds. Turbo could therefore schedule `@megasaver/cli:test` before
`@megasaver/connector-generic-cli:build` completed.

**B — connector test scripts embedded `pnpm build`:** The three
connector packages had `"test": "pnpm build && vitest run"`. This
inline build ran `tsup` with `clean: true`, wiping `dist/` inside the
test task itself. Even with `^build` ordering satisfied (Part A), the
embedded rebuild inside `connector-generic-cli:test` re-cleaned and
reconstructed `dist/` concurrently with `cli:test`. The DTS step
takes ~1.5 s; during that window `dist/index.d.ts` is absent.

`pnpm verify` masks both issues because it runs `typecheck` (with
`^typecheck`) before `test`, warming all `.d.ts` files into the
filesystem before any test task starts.

## §3 Fix

Two-part config-only fix:

**Part A — `turbo.json`:** add `^build` to `test` and `test:watch`
`dependsOn`:

```json
{
  "tasks": {
    "test": {
      "dependsOn": ["^build", "build"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "dependsOn": ["^build", "build"],
      "cache": false,
      "persistent": true
    }
  }
}
```

**Part B — connector `package.json` scripts:** remove `pnpm build &&`
prefix from `test` script in three connector packages:
`packages/connectors/generic-cli`, `packages/connectors/claude-code`,
`packages/connectors/shared`. Change from
`"test": "pnpm build && vitest run"` to `"test": "vitest run"`.

Since turbo's `^build` dependency already guarantees `dist/` is fresh
before tests run, the inline rebuild is both redundant and harmful.

## §4 Verification plan

Determinism gate:

```bash
pnpm install
pnpm exec turbo run test --force   # cold run 1
pnpm exec turbo run test --force   # cold run 2
pnpm exec turbo run test --force   # cold run 3
```

All three cold runs must exit 0 with the full task set succeeding
(currently 18 tasks). Plus `pnpm verify` must remain green.

If any cold run fails on the `known-targets.test-d.ts:22`
"Unused `@ts-expect-error`" diagnostic, the fix is **incomplete**
— escalate via a follow-up issue, do not ship.

## §5 Alternatives considered

- **`^build` in `turbo.json` only (no package.json change).** Rejected:
  insufficient on its own. The embedded `pnpm build &&` in connector
  test scripts re-cleans `dist/` inside the test task itself, racing
  with `cli:test` even after `^build` ordering is satisfied.
- **Task `outputs` as cache key only.** Rejected: orthogonal to the
  dependency ordering. `outputs` controls cache invalidation, not
  scheduling.
- **Force vitest typecheck to read source `.ts` instead of `.d.ts`.**
  Rejected: vitest typecheck deliberately exercises the published
  surface; bypassing `.d.ts` would lose the regression value of
  `known-targets.test-d.ts`.
- **Add `^typecheck` to `test.dependsOn`.** Rejected: `typecheck`
  does not emit `dist/`; only `build` (tsup) emits the `.d.ts`
  files that vitest typecheck consumes. `^build` is correct.
- **Package-level turbo pipeline override** (`@megasaver/cli#test`
  depending on `@megasaver/connector-generic-cli#test`). Rejected:
  overly broad — forces all cli tests to wait for all connector tests.
  Removing the redundant inline build is the minimal correct fix.
