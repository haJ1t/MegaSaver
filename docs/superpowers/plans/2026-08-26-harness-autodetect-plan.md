# Harness Auto-Detect — Implementation Plan

- **Spec:** `docs/superpowers/specs/2026-08-26-harness-autodetect-design.md`
- **Risk:** HIGH — full chain, worktree `feat/harness-autodetect`
- **TDD:** every step red → green. No production code without a failing test.

## Steps

1. **shared: agentIdSchema 8 → 40.**
   - RED: update `packages/shared/test/agent-id.test.ts` member list to 40
     (alphabetic pin, property tests) + `agent-id.test-d.ts` tuple pin
     (shrink to representative-member form to stay maintainable: keep
     explicit-accept tests for new ids; order pin stays full tuple).
   - GREEN: extend `packages/shared/src/agent-id.ts`.
2. **generic-cli: 9 new targets (6 → 15).**
   - RED: `targets.test.ts` pins `builtinTargets` length 15 + each new target
     id/relativePath/agentId + findTarget resolution + header absence.
   - GREEN: add 9 frozen targets in `targets.ts`.
   - Conformance-matrix + byte-equality CLI tests must stay green
     (they iterate KNOWN_TARGETS).
3. **CLI known-targets + GUI mirror 7 → 16.**
   - RED: `apps/cli/test/known-targets.test.ts` grows; add GUI mirror parity
     test if absent (grep first).
   - GREEN: update `apps/cli/src/known-targets.ts` +
     `apps/gui/bridge/known-targets.ts`.
4. **harness-detect package scaffold.**
   - New `packages/harness-detect/` (package.json, tsconfig, tsup, vitest
     config) + pnpm install to link.
5. **harness-detect: catalog.**
   - RED: catalog invariants test — 39 entries, unique ids, every id ∈
     agentIdSchema, connectorTargetId/coveredByTargetId disjoint-or-null,
     target ids reference the real target id set (imported list injected as
     data to avoid a CLI edge), categories closed set.
   - GREEN: `catalog.ts` with the 39 descriptors.
6. **harness-detect: pure engine.**
   - RED: fake-probe tests — all four signal kinds produce matchedSignals;
     effectiveTargetId folding (dedicated > coveredBy > null); absent when no
     signal; `ids` filter; catalog order preserved.
   - GREEN: `detect.ts`.
7. **harness-detect: real probes.**
   - RED: `createNodeProbes` tests with temp dirs + fake PATH env (binary
     lookup incl. win32 PATHEXT simulation via injected platform, extension
     prefix scan, home-relative resolution, project marker under root).
   - GREEN: `probes.ts`.
8. **CLI: `mega detect` command.**
   - RED: text rendering (all 39 lines + summary), `--json` full array, exit 0
     always; command registered in `main.ts`.
   - GREEN: `apps/cli/src/commands/detect.ts` + registration +
     `apps/cli/package.json` devDep + dependency-graph allow-list entry.
9. **CLI: `mega init` harness step.**
   - RED: init tests — step line in the plan header; detected harnesses with
     project → per-unique-target sync invoked; no project → skip line + step
     OK; zero detected → honest line; sync failure → step ✗.
   - GREEN: extend `runInit` (deps.harnessScan) + wire in `initCommand` via
     new `runHarnessAutoConfigure` in `detect.ts`.
10. **Docs + changeset + wiki.**
    - Changeset for shared/generic-cli/harness-detect/cli.
    - Wiki: new `entities/harness-detect` page, index entries, agent-channel
      note, `log.md` timestamped entry.
11. **Verify (DoD).**
    - `pnpm verify` green (lint + typecheck + full suite).
    - Feature evidence: real `mega detect` run on this machine + `mega init
      --yes` smoke in a temp project with ≥2 detected harnesses + seeded
      blocks inspected.
    - External reviewer pass requested (hard gate; author ≠ reviewer).
