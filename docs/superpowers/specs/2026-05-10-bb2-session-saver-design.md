---
title: mega session saver CLI — BB2 child spec
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB2
---

# BB2 — `mega session saver` CLI surface

> Child spec of `2026-05-10-aa1-context-gate-epic.md`. Implements the
> `mega session saver {enable,disable,status,stats}` subcommand tree
> locked in epic §5a, the `tokenSaver` naming in §2d/§2e, and the
> backward-compat rule in §4c. Risk is **HIGH** per `CLAUDE.md` §12: a
> public CLI surface that mutates persisted user session state
> (`session.tokenSaver`) via `CoreRegistry.updateTokenSaver`. No child
> process, no path read, no secret handling — so not CRITICAL.

## §1 Scope

In scope: four subcommands under `session saver`, their arg
validation, error mapping, exit codes, and text + JSON output shapes.

Out of scope (later sub-PRs): the orchestrator (BB7a), the policy /
output-filter / content-store packages, the stats/content event store
(BB6), the GUI panel (BB10), and the connector CONTEXT_GATE block
(BB11). BB2 writes **only** `session.tokenSaver` via the already-merged
`CoreRegistry.updateTokenSaver` (BB1).

## §2 Dependencies (already merged, BB1)

- `@megasaver/shared`: `tokenSaverModeSchema` (`z.enum(["aggressive",
  "balanced","safe"])`), `TokenSaverMode`, `modeToBudget(mode)` →
  aggressive 4000 / balanced 12000 / safe 32000; `sessionIdSchema`
  (branded UUID), `SessionId`.
- `@megasaver/core` `packages/core/src/token-saver.ts`:
  `tokenSaverSettingsSchema`, `TokenSaverSettings`,
  `defaultTokenSaverSettings(now: () => string)`.
- `CoreRegistry.updateTokenSaver(id: SessionId, settings:
  TokenSaverSettings): Session` — **full replacement** (not partial).
  Throws `CoreRegistryError("session_not_found")` and
  `("session_already_ended")`; both already map through
  `mapErrorToCliMessage(err, { kind: "session", id })`.
- `Session.tokenSaver?: TokenSaverSettings` (optional). Pre-AA sessions
  have `tokenSaver === undefined`.
- CLI plumbing to mirror exactly: `apps/cli/src/commands/session/update.ts`
  (run-fn shape, `defineCommand` args), `apps/cli/src/store.ts`
  (`resolveStorePath`, `ensureStoreReady`), `apps/cli/src/errors.ts`
  (`CliMessage`, `mapErrorToCliMessage`, `*_INVALID_*` prefix consts,
  `invalidRiskMessage` as the sibling pattern).

## §3 Subcommand surface (locked — epic §5a)

```
mega session saver enable  <session-id> --mode safe|balanced|aggressive [--store <dir>] [--json]
mega session saver disable <session-id>                                 [--store <dir>] [--json]
mega session saver status  <session-id>                                 [--store <dir>] [--json]
mega session saver stats   <session-id>                                 [--store <dir>] [--json]
```

- `<session-id>`: positional, required, parsed via `sessionIdSchema` at
  the CLI boundary (mirrors `update.ts:43–49`). Invalid → `mapErrorToCliMessage(err, { kind: "sessionId" })`.
- `--mode`: **required for `enable`, rejected for the other three.**
  - Absent on `enable` → `missingModeMessage()` (exit 1).
  - Present on `disable`/`status`/`stats` → `unexpectedModeMessage()` (exit 1).
  - Present-but-invalid on `enable` → `invalidModeMessage(value)` (exit 1),
    parsed via `tokenSaverModeSchema.parse`.
- `--store`: overrides resolved store dir (mirrors `update.ts:30–39`,
  `resolveStorePath`). Whitespace-only → store validation error via
  `mapErrorToCliMessage(err, { kind: "store" })`.
- `--json`: `{ type: "boolean", default: false }`.

## §4 Behavior per subcommand

All four resolve store → parse `sessionId` → (validate mode flags) →
`ensureStoreReady(rootDir)` → registry op → emit. `now()` is injected
as `() => new Date().toISOString()` at the `defineCommand` boundary
(no module-level `Date.now()`, `CLAUDE.md` §8).

### §4a enable

1. Require `--mode`; parse via `tokenSaverModeSchema`.
2. `getSession(id)`; if null → `session_not_found` (exit 1).
3. Compute next settings (full object for `updateTokenSaver`):
   - `enabled: true`
   - `mode` = parsed mode
   - `maxReturnedBytes = modeToBudget(mode)`
   - `storeRawOutput`, `redactSecrets`, `autoRepair` from
     `defaultTokenSaverSettings(now)` (the documented defaults; true/true/true)
   - `createdAt` = existing `session.tokenSaver?.createdAt` if present,
     else `now()`
   - `updatedAt = now()`
4. `registry.updateTokenSaver(id, settings)`.

### §4b disable

1. Reject `--mode`.
2. `getSession(id)`; if null → `session_not_found`.
3. Base settings = existing `session.tokenSaver` if present, else
   `defaultTokenSaverSettings(now)`. Next = `{ ...base, enabled: false,
   updatedAt: now() }` (createdAt preserved from base).
4. `registry.updateTokenSaver(id, next)`.

### §4c status

1. Reject `--mode`. `getSession(id)`; if null → `session_not_found`.
2. If `session.tokenSaver === undefined` → report **not-configured CTA**
   (text: `Mega Saver Mode not configured for <id> — run: mega session saver enable <id> --mode <mode>`).
3. Else report current `enabled`/`mode`/`maxReturnedBytes`.
4. Read-only: never calls `updateTokenSaver`.

### §4d stats — ambiguity resolution (epic §5a, §1 BB6 mapping)

**The stats/content event store does NOT exist yet — it is BB6.** BB2
MUST NOT invent a data source, MUST NOT create a partial stats store,
MUST NOT half-implement event aggregation (`CLAUDE.md` §13).

Locked decision: `stats` is a **settings/state reporter plus a BB6
signal**. It reads `session.tokenSaver` (the same source as `status`)
and reports the current configuration, then explicitly states that
per-event byte-savings statistics arrive with BB6.

- Reject `--mode`. `getSession(id)`; if null → `session_not_found`.
- If `tokenSaver === undefined` → same not-configured CTA as `status`.
- Else text: one summary line of current settings + the literal
  sentence: `Event stats (bytes saved per call) arrive with BB6.`
- JSON: `{ sessionId, tokenSaver, eventStats: null }` — `eventStats:
  null` is the explicit, honest "not yet available" marker. No invented
  numeric fields, no zero-filled placeholder counters.
- Read-only: never calls `updateTokenSaver`.

This keeps BB2 fully implemented under §13 (no half-implementation):
everything it reports is real, and the one unavailable thing is
reported as `null` rather than faked.

## §5 Output shapes (locked)

### §5a Text mode (one line to stdout)

- enable:  `Mega Saver Mode enabled for <id> (<mode>; <maxReturnedBytes> B)`
- disable: `Mega Saver Mode disabled for <id>`
- status (configured):     `Mega Saver Mode <enabled|disabled> for <id> (<mode>; <maxReturnedBytes> B)`
- status/stats (unconfigured): `Mega Saver Mode not configured for <id> — run: mega session saver enable <id> --mode <mode>`
- stats (configured): the status line, then `Event stats (bytes saved per call) arrive with BB6.`

### §5b JSON mode (single line to stdout)

- enable / disable / status: `{ "sessionId": "<id>", "tokenSaver": <TokenSaverSettings | null> }`
  (`null` only for the unconfigured status case).
- stats: `{ "sessionId": "<id>", "tokenSaver": <TokenSaverSettings | null>, "eventStats": null }`

JSON is emitted ONLY on success. On any failure path, stderr carries a
plain-text `error: …` line and stdout stays empty (mirrors the
`json-failure-paths.test.ts` contract: every stderr line fails
`JSON.parse`).

## §6 Errors & exit codes

| Condition                          | Message fn / path                                  | Exit |
|------------------------------------|----------------------------------------------------|------|
| store path invalid                 | `mapErrorToCliMessage(err, { kind: "store" })`     | 1    |
| session id not a UUID              | `mapErrorToCliMessage(err, { kind: "sessionId" })` | 1    |
| `--mode` missing on enable         | `missingModeMessage()`                             | 1    |
| `--mode` invalid on enable         | `invalidModeMessage(value)`                        | 1    |
| `--mode` present on disable/status/stats | `unexpectedModeMessage()`                    | 1    |
| session not found                  | `mapErrorToCliMessage(err, { kind: "session", id })` → `sessionNotFoundMessage(id)` | 1 |
| session already ended              | `mapErrorToCliMessage(err, { kind: "session", id })` | 1  |

New error helpers in `apps/cli/src/errors.ts` (siblings of
`invalidRiskMessage`):

```ts
export const MODE_INVALID_MESSAGE_PREFIX = "error: invalid mode";
export function invalidModeMessage(value: string): CliMessage {
  return {
    message: `${MODE_INVALID_MESSAGE_PREFIX} "${value}", expected: ${tokenSaverModeSchema.options.join(" | ")}`,
    exitCode: 1,
  };
}
export function missingModeMessage(): CliMessage {
  return { message: "error: --mode is required for enable", exitCode: 1 };
}
export function unexpectedModeMessage(): CliMessage {
  return { message: "error: --mode is only valid for enable", exitCode: 1 };
}
```

`tokenSaverModeSchema` is imported from `@megasaver/shared` in
`errors.ts` (alongside the existing `riskLevelSchema` import). Exit code
2 is not reachable here: every modeled failure is exit 1; an unexpected
`Error` still routes through `mapErrorToCliMessage` (exit 1) per the
existing precedent — there is no exit-2 path in the current `errors.ts`.

## §7 Backward compatibility (epic §4c)

- Pre-AA sessions (`tokenSaver === undefined`) are first-class:
  - `status` / `stats` → not-configured CTA (no crash).
  - `enable` → writes a full fresh settings object (`createdAt = now()`).
  - `disable` → bases on `defaultTokenSaverSettings(now)` then
    `enabled:false`; writes a full object (so a previously-undefined
    session becomes explicitly-disabled, which is correct and idempotent).
- No migration, no version bump. `updateTokenSaver` does the full
  `sessionSchema.parse` round-trip already.

## §8 File map

New:
- `apps/cli/src/commands/session/saver/enable.ts`
- `apps/cli/src/commands/session/saver/disable.ts`
- `apps/cli/src/commands/session/saver/status.ts`
- `apps/cli/src/commands/session/saver/stats.ts`
- `apps/cli/src/commands/session/saver/index.ts` (barrel + `sessionSaverCommand` with the 4 subCommands)
- `apps/cli/test/session-saver.test.ts`

Modified:
- `apps/cli/src/commands/session/index.ts` — add `saver: sessionSaverCommand` to `sessionCommand.subCommands` (+ re-export run-fns/command).
- `apps/cli/src/errors.ts` — add `MODE_INVALID_MESSAGE_PREFIX`, `invalidModeMessage`, `missingModeMessage`, `unexpectedModeMessage`, and the `tokenSaverModeSchema` import.
- `apps/cli/test/json-failure-paths.test.ts` — extend with saver enable invalid-mode, enable missing-mode, disable not-found.

Each file ≤ 300 LOC, kebab-case, one responsibility (`CLAUDE.md` §8).
The four run-fns share the shape of `RunSessionUpdateInput`
(`sessionId`, `storeFlag`, `cwd`, `home`, `xdgDataHome`, `stdout`,
`stderr`, `json`); `enable` adds `modeFlag`, the others add nothing
(but accept `modeFlag` so the "unexpected mode" check is testable).

## §9 Acceptance criteria

- `pnpm --filter @megasaver/cli test` green; `pnpm verify` green.
- `mega session saver enable/disable/status/stats` wired and reachable
  from `mega session saver --help`.
- enable persists the exact settings of §4a (verified by reading back
  via registry / status); `maxReturnedBytes === modeToBudget(mode)`.
- `--mode` required-on-enable, rejected-on-others enforced with the §6
  messages.
- JSON success shape matches §5b; all failure paths emit non-JSON
  stderr + empty stdout + exit 1 (extends `json-failure-paths.test.ts`).
- stats reports `eventStats: null` and the BB6 sentence; no invented
  store, no placeholder counters.
- Pre-AA (undefined `tokenSaver`) session handled by all four commands.
