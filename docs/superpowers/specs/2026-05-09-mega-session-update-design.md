---
title: mega session update + I5 split — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-08-cli-session-crud-design.md
  - wiki/entities/cli.md
  - wiki/entities/core.md
---

# `mega session update` + I5 split — design

## §0 TL;DR

Two coupled deliverables in one slot:

- **`mega session update <sessionId> [--title …] [--risk …] [--agent …]`** — partial update of an open session. At least one mutable flag is required; ended sessions are rejected. Empty `--title ""` clears the title to `null` (matches create's accept-empty semantics). Silent exit `0` on success.
- **I5 split:** `apps/cli/src/commands/session.ts` (511 LOC) is replaced by a `commands/session/` directory with one module per subcommand (`create.ts`, `list.ts`, `show.ts`, `end.ts`, `update.ts`) plus `shared.ts` (helpers) and `index.ts` (parent command + re-exports). Closes the v0.1 backlog item I5 from PR #11's spec.

`@megasaver/core` gains `SessionUpdatePatchSchema` and a new `updateSession(id, patch)` registry method on both the in-memory and JSON-directory implementations. Existing `endSession` / `createSession` / `listSessions` paths remain byte-identical.

## §1 Motivation

`mega session create` and `mega session end` cover open/close. Real-world workflow gap:

- A user opens a session, works for a while, then realises a different label fits ("auth refactor" rather than the auto-generated default).
- Mid-session, the work crosses a risk boundary (LOW → HIGH after touching a security file). The session metadata should reflect the higher risk so the rest of the run inherits it.
- A session was opened against the wrong agent id (e.g. claude-code session that should have been routed via cursor). Re-routing today means closing and reopening; an update path is more direct.

`mega session update` closes that gap with a small, atomic-patch surface.

I5 (`commands/session.ts` 511 LOC > §8 300 threshold) was deferred when session CRUD landed (PR #11) on the explicit condition that the split happens "when `mega session update` lands". This slot is that landing.

## §2 Non-goals

- No `--started-at` mutation. `startedAt` is an audit invariant.
- No `--ended-at` mutation. `mega session end` already handles the close path; reopening is out of scope (would need its own audit semantics discussion).
- No `--project-id` (cross-project move) or `--id` (rename). v0.1 use case is unclear.
- No `mega session reopen` (ended → open). Same audit-semantics reservation.
- No bulk update.
- No update audit log (who changed what when).
- No `--json` flag pass.
- No closure of the open S3–S11 / T1, T3–T8 / U2–U10 critic backlog.

## §3 Surface

### 3.1 Core layer — `@megasaver/core`

**New schema** (`packages/core/src/session.ts`):

```ts
export const SessionUpdatePatchSchema = z
  .object({
    title: z.string().nullable().optional(),
    riskLevel: riskLevelSchema.optional(),
    agentId: agentIdSchema.optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, {
    message: "patch must contain at least one field",
  });

export type SessionUpdatePatch = z.infer<typeof SessionUpdatePatchSchema>;
```

`.strict()` rejects unknown keys (consistent with the rest of Core's schemas — see existing `projectSchema` / `sessionSchema`). The `refine` enforces the "at least one field" invariant at the schema boundary.

**Registry interface** (`packages/core/src/registry.ts`) — new method:

```ts
export interface CoreRegistry {
  // …existing…
  updateSession(id: SessionId, patch: SessionUpdatePatch): Session;
}
```

Behaviour:

- Validate `patch` via `SessionUpdatePatchSchema.parse` at the boundary. Empty patch / unknown keys → throws Zod error (caller responsible for routing).
- `getSession(id) === null` → throws `CoreRegistryError("session_not_found", …)` (existing code).
- `session.endedAt !== null` → throws `CoreRegistryError("session_already_ended", …)` (existing code; same error reused).
- Otherwise: build `nextSession` by spreading `currentSession` then patch keys (only the keys actually present in `patch` overwrite). Persist. Return `nextSession`.

The in-memory implementation (`createInMemoryCoreRegistry`) and the JSON-directory implementation (`createJsonDirectoryCoreRegistry`) both implement this. JSON variant uses the existing atomic-write + lock paths it already uses for `endSession`.

**Public exports** (`packages/core/src/index.ts`):

```ts
export {
  // …existing…
  type SessionUpdatePatch,
  SessionUpdatePatchSchema,
} from "./session.js";
```

`CoreRegistry.updateSession` is part of the existing exported interface; no separate re-export needed.

### 3.2 CLI layer — split refactor

`apps/cli/src/commands/session.ts` (single 511-LOC file) is replaced by:

```
apps/cli/src/commands/session/
  index.ts          # parent sessionCommand + re-exports of every Run*/run*/*Command
  shared.ts         # readTestEnv, formatSessionLine, formatShowLines
  create.ts         # RunSessionCreateInput + runSessionCreate + sessionCreateCommand
  list.ts           # RunSessionListInput + runSessionList + sessionListCommand
  show.ts           # RunSessionShowInput + runSessionShow + sessionShowCommand
  end.ts            # RunSessionEndInput + runSessionEnd + sessionEndCommand
  update.ts         # RunSessionUpdateInput + runSessionUpdate + sessionUpdateCommand
```

`apps/cli/src/main.ts` import path changes from `./commands/session.js` to `./commands/session/index.js` (or relies on TypeScript's automatic index resolution if NodeNext supports it — verify in implementation; if it does, the import literal stays the same).

`apps/cli/test/session.test.ts` is NOT split. Test organisation is by behavioural describe block (one per subcommand + cross-cutting), not by file. Imports update to whichever path the implementation settles on.

Public surface (every `Run*Input` type, every `run*` function, every `*Command` constant) stays exactly as it was. The split is internal-organisation only.

### 3.3 CLI layer — `mega session update`

```
mega session update <sessionId> [--title "…"] [--risk <level>] [--agent <id>] [--store <dir>]
```

Positional:

- `sessionId` (required) — UUID. Validated through `sessionIdSchema`. Invalid id → `error: invalid session id "<value>"`, exit 1.

Flags (all optional individually, BUT at least one of `--title` / `--risk` / `--agent` is required):

- `--title <string>` — set the title. Empty string `""` clears to `null` (matches `mega session create --title ""`).
- `--risk <level>` — `low | medium | high | critical`. Validated by `riskLevelSchema`.
- `--agent <id>` — `claude-code | codex | cursor | generic-cli`. Validated by `agentIdSchema`. Help text mirrors session create's "Keep in sync with agentIdSchema" comment so the next enum widening catches both.
- `--store <dir>` — store override (existing semantics).

Behaviour:

1. Resolve store path (existing `resolveStorePath`).
2. Parse session id via `sessionIdSchema`.
3. Build `patch` from provided flags. If no mutable flag was provided, emit `error: nothing to update`, exit 1.
4. `--title ""` (empty) → `patch.title = null`. Any other string → `patch.title = string`. Flag absent → key not in patch.
5. Init store if needed (existing `ensureStoreReady` path; matching one-time stderr notice on first init).
6. Call `registry.updateSession(parsedId, patch)`. Errors funnel through `mapErrorToCliMessage` with appropriate `kind`.

On success: silent stdout, `process.exitCode === 0`. (Q6-A.)

### 3.4 CLI errors module

`apps/cli/src/errors.ts` minor extensions:

- New `kind: "session_update"` ZodContext variant — routes Zod errors raised by `SessionUpdatePatchSchema.parse` into a clean CLI message (e.g. `error: invalid risk level "foo", expected: low | medium | high | critical`).
- New helper `nothingToUpdateMessage(): CliMessage` returning `{ message: "error: nothing to update", exitCode: 1 }`. Pure function; no schema, no Zod.
- ConnectorError-style mapper additions are NOT needed — all error codes come from existing `CoreRegistryError` (`session_not_found`, `session_already_ended`).

`apps/cli/test/errors.test.ts` gains 1–2 tests: `nothingToUpdateMessage` returns the expected shape; `kind: "session_update"` smoke test for at least one Zod error mapping.

## §4 Output format

`mega session update <id> --title "auth refactor"` on success:

```text
$ mega session update 33333333-3333-4333-8333-333333333333 --title "auth refactor"
$ echo $?
0
```

(empty stdout, exit 0)

`mega session update <id>` (no flags):

```text
$ mega session update 33333333-3333-4333-8333-333333333333
error: nothing to update
$ echo $?
1
```

`mega session update <ended-id> --title "x"`:

```text
$ mega session update 33333333-3333-4333-8333-333333333333 --title "x"
error: session "33333333-3333-4333-8333-333333333333" already ended at 2026-05-09T01:00:00.000Z
$ echo $?
1
```

`mega session update <id> --risk invalid`:

```text
$ mega session update 33333333-3333-4333-8333-333333333333 --risk invalid
error: invalid risk level "invalid", expected: low | medium | high | critical
$ echo $?
1
```

(Final wording matches whatever the existing `sessionCreate` `--risk` validation produces today; the goal is consistency, not new wording.)

## §5 File LOC after split

Estimated post-split per-file LOC:

| File          | LOC est.   |
|---------------|-----------|
| `index.ts`    | ~30       |
| `shared.ts`   | ~80       |
| `create.ts`   | ~110      |
| `list.ts`     | ~90       |
| `show.ts`     | ~95       |
| `end.ts`      | ~90       |
| `update.ts`   | ~140      |

All files are under §8's 300-LOC threshold. I5 closes.

## §6 Test plan

**Core** (`packages/core/test/`) — ~6 new tests for `updateSession`:

1. Happy path: open session, `updateSession(id, { title: "x" })` returns mutated session with `title === "x"`.
2. `title` clear: `updateSession(id, { title: null })` returns session with `title === null`.
3. Multi-field: `updateSession(id, { title: "x", riskLevel: "high", agentId: "cursor" })` mutates all three atomically.
4. Empty patch: `updateSession(id, {})` throws Zod-level error (refine).
5. `session_not_found`: unknown id throws `CoreRegistryError("session_not_found", …)`.
6. `session_already_ended`: ended session throws `CoreRegistryError("session_already_ended", …)`.

These run against BOTH the in-memory registry (`registry.test.ts`) and the JSON-directory registry (`json-directory-registry.test.ts`) — duplication is intentional, matches `endSession` test pattern. Net: ~12 new core tests (6 × 2 registries).

**CLI** (`apps/cli/test/session.test.ts`) — ~11 new tests for `mega session update`:

1. `--title "foo"` → DB title = "foo", silent stdout, exit 0.
2. `--title ""` → DB title = null.
3. `--risk high` → DB riskLevel = "high".
4. `--agent cursor` → DB agentId = "cursor".
5. `update <id>` (no flags) → exit 1, stderr `error: nothing to update`, no DB mutation.
6. `--title "x" --risk high --agent cursor` → all three persist atomically.
7. `update <invalid-uuid>` → exit 1, "invalid session id" stderr.
8. `update <missing-id>` → exit 1, `session_not_found`-mapped stderr.
9. `update <ended-id>` → exit 1, `session_already_ended`-mapped stderr.
10. `update <id> --risk bogus` → exit 1, lists 4 valid risks.
11. `update <id> --agent unknown` → exit 1, lists 4 valid agents.

**CLI errors** (`apps/cli/test/errors.test.ts`) — 1–2 new tests:

12. `nothingToUpdateMessage` returns `{ message: "error: nothing to update", exitCode: 1 }`.
13. `mapErrorToCliMessage(zodErr, { kind: "session_update" })` returns a clean string for at least one synthetic Zod issue.

**Snapshot test for `--agent` description** (`apps/cli/test/session.test.ts`) — ALREADY EXISTS from PR #17 U1 fix. Update it to also assert the new `sessionUpdateCommand.args.agent.description` includes every agentIdSchema member (parallel coverage). Net: +1 assertion in an existing test, OR +1 new test if cleaner.

**Test count delta:**

- Core: +12 (6 in-memory + 6 JSON-directory) → 116 → 128.
- CLI session: +11.
- CLI errors: +2.
- CLI total: 128 → 141.
- Project total: 395 → 420.

## §7 Risk

**MEDIUM**. Three packages-worth of work, but additive everywhere:

- `@megasaver/core` — new schema (`SessionUpdatePatchSchema`), new interface method (`updateSession`). Existing methods byte-identical. Public API additive.
- `@megasaver/cli` — directory split + new subcommand + `errors.ts` extensions. Existing CLI surface byte-identical (every subcommand keeps its public exports). `main.ts` import path updates.
- `@megasaver/shared` — UNCHANGED.
- Connectors — UNCHANGED.

HIGH not warranted: no Core schema break, no destructive ops, no migration path needed (existing sessions parse cleanly under unchanged `sessionSchema`).

Full superpowers chain (TDD, code-reviewer, critic v0.2 followup pass) before merge.

## §8 Out of scope (explicit)

See §2. Specifically called out items NOT in this slot:

- `mega session reopen`, `--started-at`, `--ended-at` mutation, `--project-id` mutation, `--id` rename.
- `--json` flag pass.
- Aider YAML connector target.
- README refresh, U2-U10 cursor backlog, S3-S11 status backlog, T1+T3-T8 followup-of-followup backlog.
- Update audit log.
- Bulk update.

## §9 Migration / compatibility

No migration. Existing `sessions.json` files parse cleanly because no field is added, removed, or constrained. The new `updateSession` method is purely additive — code that doesn't call it is unaffected. CLI consumers with no `mega session update` calls see no behaviour change.

If a user has a CI pipeline that scrapes the `mega session create` description string, the post-PR-#17 string is stable; no regression.
