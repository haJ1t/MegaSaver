# Plan: Proxy First-Party Cache Parity

Spec: `docs/superpowers/specs/2026-07-14-proxy-first-party-cache-parity-design.md`

1. Worktree `fix/connector-first-party-cache-parity` off `main`.
   → verify: `git worktree list` shows it; `pnpm verify` green at base.
2. Failing tests in `packages/connectors/claude-code/test/proxy-route.test.ts`:
   - apply + assumeFirstParty writes both env keys.
   - apply without option writes only `ANTHROPIC_BASE_URL` (back-compat).
   - removeExpected drops both keys, leaves foreign env keys intact.
   - removeExpected with foreign base URL touches nothing (flag survives only with route).
   - inspect + assumeFirstParty stays URL-only (`"exact"` without the flag); monitor
     self-heals through idempotent `apply` so remove/rollback paths remain sound.
   - inspect without option: unchanged semantics.
   → verify: `vitest run` red on exactly the new tests.
3. Implement `proxy-route.ts` adapter opts; wire `supervise.ts`
   (default-origin comparison) and `commands.ts` (persisted upstream origin gate).
   → verify: `vitest run` green, `pnpm verify` green.
4. Changeset (`@megasaver/connector-claude-code` minor for the optional public adapter
   API; `@megasaver/proxy-control` minor for the changed exported adapter contract;
   `@megasaver/cli` patch).
5. Reviews: `code-reviewer` + `critic` agents, fresh contexts. Address findings.
6. Merge to `main`, reinstall global CLI, restart proxy, confirm settings healed
   (flag present next to route).
   → verify: `python3 -c "...settings.json..."` shows both keys; probe plain≈2.
7. Benchmark rerun with saver enabled + fixed routing; report table.
8. Wiki: update `wiki/` pages + `wiki/log.md` entry; conventions untouched (no drift).

Review amendments:
- `mega proxy start --restart-supervisor` explicitly force-restarts only the loaded
  managed LaunchAgent; the new monitor then heals older installations. URL equality
  alone never authorizes an in-process settings migration.
- Production-adapter tests cover default-origin normalization and custom-upstream
  stale-flag removal.
- Benchmark settings snapshots are created after hook installation and the treatment
  snapshot is rejected when the saver hook is absent.
