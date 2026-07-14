# Plan: Proxy First-Party Cache Parity

Spec: `docs/superpowers/specs/2026-07-14-proxy-first-party-cache-parity-design.md`

1. Worktree `fix/connector-first-party-cache-parity` off `main`.
   → verify: `git worktree list` shows it; `pnpm verify` green at base.
2. Failing tests in `packages/connectors/claude-code/test/proxy-route.test.ts`:
   - apply + assumeFirstParty writes both env keys.
   - apply without option writes only `ANTHROPIC_BASE_URL` (back-compat).
   - removeExpected drops both keys, leaves foreign env keys intact.
   - removeExpected with foreign base URL touches nothing (flag survives only with route).
   - inspect + assumeFirstParty: route present but flag missing → `"absent"` (self-heal).
   - inspect without option: unchanged semantics.
   → verify: `vitest run` red on exactly the new tests.
3. Implement `proxy-route.ts` adapter opts; wire `supervise.ts`
   (`upstream === DEFAULT_UPSTREAM`) and `commands.ts` (`true`, comment WHY).
   → verify: `vitest run` green, `pnpm verify` green.
4. Changeset (patch: `@megasaver/connector-claude-code`, `@megasaver/cli`).
5. Reviews: `code-reviewer` + `critic` agents, fresh contexts. Address findings.
6. Merge to `main`, reinstall global CLI, restart proxy, confirm settings healed
   (flag present next to route).
   → verify: `python3 -c "...settings.json..."` shows both keys; probe plain≈2.
7. Benchmark rerun with saver enabled + fixed routing; report table.
8. Wiki: update `wiki/` pages + `wiki/log.md` entry; conventions untouched (no drift).
