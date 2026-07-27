---
title: Retrieval Windows Test Worker Design
risk: medium
status: approved-by-standing-user-authority
sources:
  - GitHub Actions run 30253983645, Windows job 89938203691
  - packages/retrieval/vitest.config.ts
  - AGENTS.md process-discipline.md
---

# Retrieval Windows Test Worker Design

## Problem

On Windows CI, `@megasaver/retrieval#test` starts two BM25 suites but neither
reaches a test body. Vitest reports `Timeout calling "fetch" with
"[\"/src/errors.ts\",\"ssr\"]"` after 30 seconds. The same package passes in
isolation, and the CI log shows its failure while Turbo is concurrently running
the repository test graph. The failing suites share the transformed
`src/errors.ts` dependency.

## Decision

Keep the repository-wide Turbo parallelism. Vitest 2.1.9 uses its `forks` pool
by default, so configure only the retrieval package's active fork pool as a
single fork. Its seven unit-test files are pure and have no intentional
cross-file parallelism requirement. This removes the nested Vitest worker
fan-out that starves Windows worker module loading, without changing retrieval
production code, test inputs, assertions, timeouts, or test retries.

## Constraints

- Scope is limited to `packages/retrieval/vitest.config.ts` and its regression
  evidence.
- Do not raise timeouts or add retries: those hide a scheduling failure.
- Do not change Turbo-wide concurrency or any unrelated package config.
- Preserve isolated test environments and existing test/typecheck coverage.
- The CI proof must include both Windows and Ubuntu `pnpm verify` plus bundle
  smoke, after the narrow change.

## Verification

The existing Windows CI failure is the red reproduction. Add a configuration
contract test that loads the real Vitest config and requires
`poolOptions.forks.singleFork === true`, then run it red before changing the
config. Run the retrieval suite in its normal command and once with the config
contract. Finally run root `pnpm verify` and require replacement two-platform
CI completion.

## Non-goals

This does not alter BM25 ranking, Zod validation, Vitest versions, global test
parallelism, or production runtime worker behavior.
