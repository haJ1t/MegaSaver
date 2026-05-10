---
title: --json write-side flag (5 commands) — plan
risk: MEDIUM
status: active
created: 2026-05-10
updated: 2026-05-10
related: docs/superpowers/specs/2026-05-10-json-write-side-design.md
---

# `--json` Write-Side — Plan

5 commands × {add flag, thread input.json, emit JSON branch, T6 for
sync, tests}. Each step is TDD: failing test → impl → green.

## Step 1 — `mega session create`

Files:
- `apps/cli/src/commands/session/create.ts`
- `apps/cli/test/session.test.ts`

1. Add to `RunSessionCreateInput`: `json: boolean`.
2. Add to citty args: `json: { type: "boolean", default: false, description: "Emit JSON output." }`.
3. Wire `json: !!args.json` in run-handler.
4. In `runSessionCreate`: `input.stdout(input.json ? JSON.stringify(created) : created.id);`.
5. Tests: success JSON shape pin (full `Session` shape), failure-path
   (--json text stderr exit 1), default text unchanged.

## Step 2 — `mega session end`

Files:
- `apps/cli/src/commands/session/end.ts`
- `apps/cli/test/session.test.ts`

1. Add `json: boolean` to `RunSessionEndInput`.
2. Citty args + wire `json: !!args.json`.
3. In `runSessionEnd`: silent on success today; with `--json` emit
   `JSON.stringify(ended)`. Text path stays silent (byte-compat).
4. Tests: --json emits ended Session with `endedAt` set; default
   silent unchanged.

## Step 3 — `mega session update`

Files:
- `apps/cli/src/commands/session/update.ts`
- `apps/cli/test/session.test.ts`

1. Add `json: boolean`.
2. Citty + wire.
3. With `--json`: emit updated Session post-patch. Text path silent.
4. Tests: --json emits updated Session; default silent unchanged.

## Step 4 — `mega memory create`

Files:
- `apps/cli/src/commands/memory/create.ts`
- `apps/cli/test/memory.test.ts`

1. Add `json: boolean`.
2. Citty + wire.
3. `input.stdout(input.json ? JSON.stringify(entry) : entry.id);`.
4. Tests: --json emits full MemoryEntry; default text unchanged.

## Step 5 — `mega connector sync` (T6 + JSON)

Files:
- `apps/cli/src/commands/connector/sync.ts`
- `apps/cli/test/connector.test.ts`

1. Add `json: boolean` to `RunConnectorSyncInput`.
2. Citty args + wire.
3. T6: change `formatStatusLine(target, status)` to
   `formatStatusLine(target, status, session)` for ALL paths in sync
   (currently no session). The shared `formatStatusLine` from
   `connector/shared.ts` already supports the optional session arg.
4. Per-target JSON record: `{id, relativePath, status, session}`.
   With `--json`, accumulate records and emit a single
   `JSON.stringify(records)` at end (mirror connector status).
5. Pre-loop failures: text stderr unchanged.
6. Tests: T6 text-mode regression (each line has `session=...`),
   --json success shape, default text byte-compat.

## Step 6 — Citty-wrapper drift guards

File: `apps/cli/test/project/list.test.ts` (DD1 lives there).

1. Extend `describe.each` array to include the 5 new commands:
   `sessionCreateCommand`, `sessionEndCommand`, `sessionUpdateCommand`,
   `memoryCreateCommand`, `connectorSyncCommand`.
2. Now covers 5 (read-side, DD1) + 5 (write-side, this PR) = 10
   commands × 3 assertions = 30 drift-guard tests total.

## Step 7 — Verify + PR

1. `pnpm exec vitest run --no-coverage` — all GREEN.
2. `pnpm verify` — full pipeline GREEN.
3. Commit per logical step (5 commits + drift-guard).
4. Open PR.
