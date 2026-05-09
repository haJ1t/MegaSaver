---
title: --json output for connector status
date: 2026-05-10
risk: MEDIUM
status: approved
author: aa2-connector
---

# --json output for `mega connector status`

## Problem

`mega connector status` only emits human-readable columnar text. Scripting
and CI pipelines need machine-readable output to check sync state without
parsing text.

## Goal

Add optional `--json` flag to `connectorStatusCommand`. Default (text) behavior
preserved byte-identical. With `--json`, emit a single compact JSON array to
stdout, one object per target.

## Decisions

**Q1 — JSON shape:** Flat array, one object per target, 1:1 with text lines:
```json
[{"id":"claude-code","relativePath":"CLAUDE.md","status":"missing","session":null}]
```
Fields: `id` (string), `relativePath` (string), `status` (`"in-sync" | "drift" |
"no-block" | "missing" | "error"`), `session` (string | null — `null` for
no-session, NOT the string `"none"`).

**Q2 — Pre-loop failures:** Keep text/stderr + exit 1. `--json` applies only
to per-target loop output. Pre-loop failures (project not found, unknown target,
rootPath missing) short-circuit before the loop — no JSON emitted.

**Q3 — Test placement:** New `describe("connectorStatusCommand — --json
output", ...)` block at end of `connector-status.test.ts`. JSON tests need a
`runStatus` helper that calls `runConnectorStatus` directly with `json: true` —
a fresh describe avoids mutating existing fixture helpers.

## Implementation design

### `RunConnectorStatusInput` change

```ts
export type RunConnectorStatusInput = {
  projectName: string;
  targetFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  json: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};
```

### `runConnectorStatus` change

Collect records instead of calling `input.stdout(formatStatusLine(...))` when
`input.json` is true. After the loop, emit the JSON array:

```ts
type StatusRecord = {
  id: string;
  relativePath: string;
  status: string;
  session: string | null;
};

// In the per-target loop (json mode):
const records: StatusRecord[] = [];
// ... instead of input.stdout(formatStatusLine(target, statusWord, sessionLabel)):
if (input.json) {
  records.push({
    id: target.id,
    relativePath: target.relativePath,
    status: statusWord,
    session: session === null ? null : session.id,
  });
} else {
  input.stdout(formatStatusLine(target, statusWord, sessionLabel));
}

// After the loop:
if (input.json) {
  input.stdout(JSON.stringify(records));
}
```

### `connectorStatusCommand` change

Add `json` arg; pass it through:

```ts
args: {
  // ... existing args ...
  json: { type: "boolean", description: "Emit machine-readable JSON array." },
},
async run({ args }) {
  const code = await runConnectorStatus({
    // ... existing fields ...
    json: args.json === true,
    // ...
  });
}
```

## Files changed

- `apps/cli/src/commands/connector.ts`:
  - `RunConnectorStatusInput`: add `json: boolean`
  - `runConnectorStatus`: collect-then-emit pattern when `json: true`
  - `connectorStatusCommand.args`: add `json` boolean arg
  - `connectorStatusCommand.run`: pass `json: args.json === true`
- `apps/cli/test/connector-status.test.ts`:
  - New `describe("connectorStatusCommand — --json output", ...)` at end

## Behavior contract

- `--json` not passed: text output unchanged byte-for-byte.
- `--json` passed: stdout is exactly one line: compact JSON array with one
  object per target in KNOWN_TARGETS launch order.
- `session` field is `null` when no open session, not the string `"none"`.
- Pre-loop failures: stderr text + exit 1, no JSON to stdout.
- `--json` + `--target <id>`: array has one element.
- Exit code semantics unchanged (0 = all in-sync, 1 = any drift/error).

## Test scenarios (new describe block)

1. All targets missing (empty project) → JSON array with 4 `"missing"` records,
   `session: null`.
2. `--target claude-code` with a synced file → array with 1 element, status
   `"in-sync"`, `session` = session id string.
3. Default (no `--json`) regression → `logSpy` receives text lines, NOT JSON.
