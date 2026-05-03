# Definition of Done

A feature is "done" only when ALL of these hold. No partial credit.

1. Spec exists in `docs/superpowers/specs/`.
2. Plan exists in `docs/superpowers/plans/`.
3. Tests written first (TDD).
4. `pnpm verify` green:
   - `biome check`     (lint + format)
   - `tsc --noEmit`    (type-check, project refs)
   - `vitest run`      (all tests pass)
5. Feature smoke evidence:
   - CLI feature → captured terminal session showing it work.
   - Library API → integration test exercising public surface.
   - Connector  → real agent run captured.
6. External reviewer agent pass (`code-reviewer` or `critic`).
   Author and reviewer NEVER same active context.
7. Verifier agent pass (`omc:verify`) — evidence-based check.
8. Zero pending TodoWrite items for the feature.
9. Changeset added (`.changeset/<descriptor>.md`) if package
   public API changed.
10. `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` updated if
    conventions changed (drift check per `process-discipline.md`).

If any item fails: not done. Iterate.

## Hard rule

Do NOT claim "complete", "fixed", "passing", "shipped" before
items 4–7 pass. Verification before assertion.
