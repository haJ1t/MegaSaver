---
feature: cache-doctor
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "3 of 20 (wave-2 batch)"
---

# Cache Doctor — `mega doctor --cache` (wave-2 #3, merges B5 + B6)

## Problem

Cache writes are 62–75% of measured baseline cost, and per-turn write cost
is bytes in the new suffix (wiki/syntheses/cache-write-cost-reduction-2026-08-01.md §1).
Every heavy Claude Code user carries hidden churn from their own setup —
hook stacks emitting nondeterministic `additionalContext`, hooks that mutate
files under the agent, CLAUDE.md lines that differ per session, MCP config
duplicated across scopes (§3 B5). Nothing lints for this today:
`auditClaudeCacheSuffix` (packages/connectors/claude-code/src/cache-suffix-audit.ts:101)
checks only duplicate mega hooks and base-URL risks, and it is reachable only
behind the Pro gate of `mega cache --suffix-audit` (apps/cli/src/commands/cache.ts:102-111).

We also inject blocks ourselves. `checkGeneratedOutputByteVariance`
(cache-suffix-audit.ts:123) exists but is wired into **no** CLI command, so
our own byte-stability claim is untested in production (§3 B6 — the dogfood
prerequisite for B5 credibility).

Mechanism honesty (retraction-aware): the "saver rewrites cached history"
mechanism was RETRACTED 2026-07-30 (wiki/syntheses/saver-cache-churn.md).
This linter therefore never claims prefix invalidation. It flags two real,
verifiable churn classes: (1) output that differs run-to-run, (2) hook
commands that mutate files the agent re-reads. Measured numbers are labeled
"correlated", never "caused".

## Goal

`mega doctor --cache`: a free, read-only suffix-stability lint that reports,
in the existing doctor `Check` format (apps/cli/src/commands/doctor.ts:9,108):

- (a) static lint — hook commands with volatile interpolation or file-mutating
  flags; CLAUDE.md byte-instability patterns (ISO datetimes, UUIDs, epoch ms);
  MCP server names duplicated across project/user scopes; plus the existing
  `auditClaudeCacheSuffix` risks.
- (b) measured context — counts-only join against the proxy usage ledger via
  `readProxyUsage` (packages/llm-proxy/src/store.ts:43): how many metered
  calls were cache-creation-heavy, with explicit "correlated, not caused" wording.
- (c) self-audit — our own generated surfaces (managed hook-settings JSON,
  `MEGA SAVER:CONTEXT_GATE` block text) pass `checkGeneratedOutputByteVariance`
  and the same text lint we run on the user (B6, no self-exemption).

## Non-Goals

- No fix application, no writes of any kind — not even a fingerprint cache
  (report-only; reorder-over-time detection needs history and is deferred).
- No USD figures, no hit-rate/miss diagnosis — that is `mega cache`
  (Pro, `@megasaver/pro-analytics`); this command imports none of it.
- No plain-date lint (`2026-08-06` in prose is ubiquitous in real CLAUDE.md
  files, ours included — unacceptable false-positive rate).
- No `--json` in v1 (default `mega doctor` has none; parity kept).
- No per-finding token attribution (ledger rows carry no request-body or
  hook identity; pretending otherwise would be fabricated causality).
- No proxy/hook behavior changes; no new daemon routes.

## Locked Decisions

1. **Flag on doctor, focused output.** `--cache` on the existing `doctor`
   command; when set it runs ONLY the cache section (env+saver checks would
   bury findings). Rendering reuses `renderReport`/`exitCodeFor` verbatim.
2. **Exit semantics: users warn, we fail.** Findings in the user's own
   config are `pass: true` with a `warn:` reason (precedent:
   `checkSettingsPermissions`, doctor.ts:87-95 — "doctor's exit code gates
   the environment, not their permission policy"). Only self-audit
   byte-variance rows are `pass: false` — our bug, our exit 1.
3. **Free tier.** Static lint + self-audit + counts are free (B5:
   "nobody sells this" — acquisition surface). The Pro boundary is USD and
   pro-analytics compute; the `mega cache` entitlement gate is untouched.
4. **Closed vocabulary, extended append-only.** New codes join
   `CACHE_SUFFIX_RISK_CODES` at the END (enum order is a contract):
   `hook_command_volatile_output`, `hook_command_file_mutator`,
   `mcp_server_duplicate_scope`. Text-lint codes are a new closed const
   `MANAGED_TEXT_PATTERN_CODES = ["iso_datetime", "uuid", "epoch_millis"]`.
   Per the 2026-08-02 amendment (cache-suffix-audit.ts:3-5): surfaces are
   positional (`"SessionStart[0]"`, `count=N`, line numbers) — never command
   text, file content, or rendered bytes.
5. **Detectors live in the connector.** Settings/CLAUDE.md/.mcp.json are
   Claude Code concepts → `@megasaver/connector-claude-code` (§1: no
   agent-specific logic in core). The CLI composes and renders only.
6. **Ledger join is counts-only.** A metered call is cache-creation-heavy
   when `cacheCreationTokens > cacheReadTokens && cacheCreationTokens >= 1024`
   (1024 = the min cacheable prefix floor; below it the signal is noise).
   Report `heavy/total` and share; wording fixed: "findings above are
   correlated with this churn, receipts cannot prove they caused it".
7. **No self-exemption (anti-cheat).** The context-gate block embeds
   `Session:`/`Project:` UUIDs by design (connectors/shared/src/context-gate-block.ts:37-38);
   our text lint WILL hit them. Reported as an `info:` reason, not hidden:
   the block regenerates only at session boundaries where the prefix is cold,
   so it cannot churn a warm prefix — determinism (same fields → same bytes)
   is the hard gate, and that one fails the command.

## Architecture

```
mega doctor --cache
  apps/cli/src/commands/doctor.ts          (flag + dispatch, existing renderer)
    -> apps/cli/src/commands/doctor-cache.ts   runDoctorCacheChecks(deps) -> Check[]
         reads (all injected, cli-test-pattern):
           ~/.claude/settings.json   -> auditClaudeCacheSuffix + lintHookCommandChurn
           ./.mcp.json + ~/.claude.json -> lintMcpScopeOverlap
           ./CLAUDE.md, ~/.claude/CLAUDE.md -> lintManagedTextVolatility
           (in-process)              -> checkGeneratedOutputByteVariance(defaultByteVarianceRenderers())
           <store>/proxy-usage       -> readProxyUsage (counts only)
  new detector code: packages/connectors/claude-code/src/suffix-churn-lint.ts
                     packages/connectors/claude-code/src/byte-variance-probes.ts
```

Dependency edges: CLI→`@megasaver/llm-proxy` already exists and is allowed
(apps/cli/src/commands/audit/usage.ts:9; forbidden list is retrieval+stats,
apps/cli/test/dependency-graph.test.ts:52). No new workspace edges; no pnpm
catalog (repo has none — `workspace:*` protocol).

## Components

1. **`lintHookCommandChurn(settings: unknown): CacheSuffixRisk[]`** — walks
   the same hooks shape as `duplicateHookRisks` (cache-suffix-audit.ts:37).
   Closed pattern registries: `VOLATILE_COMMAND_PATTERNS` (`$(date`,
   backtick `date`, `date +`, `$RANDOM`, `uuidgen`, `$(hostname`) →
   `hook_command_volatile_output`; `FILE_MUTATOR_PATTERNS` (`--write`,
   `--fix`, `sed -i`) → `hook_command_file_mutator`. Surface `"<event>[<i>]"`.
2. **`lintManagedTextVolatility(content: string): ManagedTextFinding[]`** —
   pure text scan, `{ code, line }` only, deduped per (line, code), ordered
   by line then code.
3. **`lintMcpScopeOverlap({ projectMcp, userMcp }): CacheSuffixRisk[]`** —
   `mcpServers` key intersection across scopes → one risk, surface `count=N`
   (names never echoed; duplicate scopes make merged server order
   writer-dependent, a suffix-order hazard). ASSUMPTION: user-scope MCP
   servers live in `~/.claude.json` (not `~/.claude/settings.json`), so the
   CLI's default `readUserMcp` reads that file, tolerant (missing/unparsable
   → absent). Verify against a real Claude Code install during
   implementation; readers are injected, so a wrong default is a one-line fix.
4. **`defaultByteVarianceRenderers(): ByteVarianceRenderers`** — fixture-fed
   probes: hook-settings JSON via `addPreToolUseHook`/`addPostToolUseHook`
   over `{}` with `DEFAULT_HOOK_COMMAND`/`SAVER_HOOK_COMMAND`; context-gate
   text via `renderContextGateBlockText` with fixed UUID fields and
   `mode: "balanced"`. `ByteVarianceRenderers` gains optional
   `contextGateBlockRenderer` (appended; surface `"context-gate-block"`).
5. **`runDoctorCacheChecks(deps): Promise<Check[]>`** — CLI composition;
   emits rows `cache-settings`, `cache-mcp-scopes`, `cache-claude-md-project`,
   `cache-claude-md-user`, `cache-self-audit`, `cache-receipts`. Reuses
   `ClaudeSettingsReadResult`/`defaultReadClaudeSettings`/`OWNED_ROUTE_BASE_URL`
   from cache.ts (exported: cache.ts:24,38,84).
6. **doctor.ts wiring** — `cache` boolean arg + `store` override (consulted
   on the cache path only); handler goes async (citty precedent: cache.ts).

## Error handling

- Settings absent/unreadable/malformed → the discriminated read from cache.ts
  (absent = clean row; unreadable/malformed = their existing risk codes).
- CLAUDE.md / .mcp.json missing or unreadable → row value `absent`, pass.
- `readProxyUsage` throw → `cache-receipts` value `unreadable`, pass with
  warn; `skippedLines > 0` surfaces in the reason (torn-line honesty,
  store.ts:40-42). No usage log → pass with the `mega proxy` hint.
- Renderer throw inside a probe → skipped by `checkGeneratedOutputByteVariance`
  (existing behavior, cache-suffix-audit.ts:134); never crashes the report.
- The command itself never throws; exit 1 only via failing self-audit rows.

## Security & privacy

- Read-only: reads settings.json (contains `env.ANTHROPIC_API_KEY` — parsed,
  values never serialized; same discipline as the suffix audit), CLAUDE.md,
  .mcp.json, `~/.claude.json`, usage.jsonl. Writes nothing.
- Closed risk vocabulary + positional surfaces only (amendment §2): no
  command text, no file content, no server names, no rendered bytes, no
  digests in any output.
- No network, no LLM calls, no entitlement state changes.

## Testing

| Unit | Test |
|---|---|
| lintHookCommandChurn | volatile/mutator patterns flag positionally; serialized risks never contain command text; clean settings → `[]`; non-object → `[]` |
| lintManagedTextVolatility | ISO datetime/UUID/epoch flagged with line numbers; plain prose dates NOT flagged; dedupe + ordering |
| lintMcpScopeOverlap | overlap → `count=N` only; disjoint/absent scopes → `[]` |
| byte-variance probes | `defaultByteVarianceRenderers()` passes clean (B6 gate); forced-unstable context-gate renderer reports appended surface only |
| enum contract | first six `CACHE_SUFFIX_RISK_CODES` keep their positions; new codes appended |
| runDoctorCacheChecks | temp store + injected readers (cli-test-pattern): warn rows stay `pass: true`; forced variance → `pass: false`; heavy-turn counting incl. 1024 floor; "correlated" wording; absent-everything → all-pass |
| doctor wiring | `--cache` renders via `renderReport`; exit 0 with user findings; smoke capture of built CLI |

No timing-tight tests — all assertions structural (repo lesson, wiki/log 33469463).

## Risk & process

**MEDIUM, LOW side** (§12): read-only reporting; no core-path, proxy, or
storage-format changes. Full superpowers chain; required reviewer
`code-reviewer`. Escalation trigger: if implementation ends up touching hook
handlers, the proxy request path, or the entitlement gate → stop, re-classify
HIGH. Regression evidence: `mega cache --suffix-audit` output unchanged.

## Dependencies / build order

Wave-2 #3 of 20; independent of the other wave-2 features (no shared files).
Consumes only shipped code: cache-suffix-audit, llm-proxy reader, doctor
frame. Internal order: connector detectors → probes → CLI composition → flag
wiring. Changeset required (connector + CLI public surface, DoD #9).

## Open questions

1. `--json` for scripting parity with `mega cache --json`? (Deferred; doctor
   has no JSON today.)
2. Should scope widen to `settings.local.json` / managed policy files in a
   follow-up? (Same detectors would apply unchanged.)
3. Reorder-over-time detection needs a stored fingerprint — conflicts with
   read-only. Opt-in cache in a later spec?
4. Should `mega cache --suffix-audit` later delegate to the same lint set so
   Pro output supersets the free doctor? (Dedup concern only.)
