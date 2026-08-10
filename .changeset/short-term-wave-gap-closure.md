---
"@megasaver/stats": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
"@megasaver/daemon": minor
"@megasaver/core": patch
"@megasaver/policy": patch
"@megasaver/mcp-bridge": minor
---

Short-term wave gap closure — cache-churn, session-mesh, mistake-airlock (10 tasks, consolidation supersedes 3 drafts).

Closes the plan↔code gaps found 2026-08-10 across the three short-term improvement waves — no new invention, only wiring, bug fixes and hardening (TDD + `pnpm verify` green):

- **`@megasaver/stats` canonical CacheChurn** — replace toy `0.05/0.8` constants with real `invalidatedCount/totalEvents` rate, `bytes/4`→`deltaTokens` pricing via `INPUT_PRICE_PER_MTOK_USD`, threshold table `bypass_compression (>0.5 && avgSavingRatio<0.2)` / `increase_floor (>0.3 && len≥5)` / `keep_enabled`, empty guard, `perTool` breakdown.
- **`@megasaver/cli` `mega cache-doctor` (free) + `mega audit --cache` alias** — thin adapter over `analyzeCacheChurn` with injectable `readEvents`, `--json` → `CacheChurnResult`, `--store` override; no entitlement gate.
- **`@megasaver/gui` `GET /api/stats/cache-churn`** — live handler `readEvents→analyzeCacheChurn` alongside the existing static `0.94` cache status.
- **`@megasaver/daemon` `SessionMeshHub` IPC** — `net.createServer` on `~/.megasaver/mesh.sock` (0600, `withFileLock` race-safe, `chmod 0600` on start, unlink on stop), 200 ms connect timeout → silent disk fallback, Windows `\\.\pipe\megasaver-mesh` branch, heartbeat `Map<agentId,Memo>` + NDJSON broadcast (`memory_added|task_step_completed|gotcha_discovered|handoff_ready`).
- **`@megasaver/mcp-bridge` `mesh_broadcast`/`mesh_query` + `get_applicable_rules` airlock merge** — Zod strict schemas under `Record<McpToolName>` compile lock; `get_applicable_rules` now returns `{ rules, airlockRules }` via lazy `readRules(storeRoot,sessionId)`.
- **`@megasaver/core` `airlock-ledger` + `mistake-synthesizer` harden** — `appendRule/readRules/pruneExpired/clearRules` atomic JSONL (`tmp+fsync+rename` + `withFileLock`, `isSafeKeySegment`, TTL 3600 fail-closed, expired filtered on read), `escapeRegExp` + anchored `^tool(?:\s+.*)?--flag(?:\b|$)` pattern (ReDoS-safe).
- **`@megasaver/policy` TTL + try/catch** — `evaluateCommand` now takes `airlockRules?: readonly AirlockNegativeRule[]` + `now?: number`; expired rules skipped via `Date.parse+ttl*1000<now`, broken regex swallowed with `try/catch`, word-boundary enforced.
- **`@megasaver/cli` `mega firewall airlock list/clear` + `mega session mesh status/log`** — ledger-backed and mesh-backed thin adapters (`--json` everywhere, `--store`/`--session`/`--tail`).
- **Bug fixes** — `mcp-bridge/server.ts` missing `storeRoot` wiring for airlock; `cli/firewall.ts` citty parent double-output (upsell over `[]`).
