---
title: PP — Hoist titleSchema to @megasaver/shared (CLI + bridge dedup)
risk: MEDIUM
status: approved
issue: 59
author: executor
date: 2026-05-10
---

# PP — Hoist `titleSchema` to `@megasaver/shared`

## §1 Problem

Two functionally identical Zod schemas for session titles exist in
the repo today:

- `apps/cli/src/commands/session/shared.ts` — `titleSchema`
  (NFC + control-char ban, message `NAME_CONTROL_CHARS_MESSAGE`).
- `apps/gui/bridge/zod-schemas.ts` — `TITLE_SCHEMA` (same regex,
  same NFC transform, no inline message).

The bridge inlined its copy because importing from `@megasaver/cli`
would invert the dependency direction. Code-reviewer finding M2 on
PR #57 (GUI v1 / LL) called the silent-drift risk: either side can
evolve its rules without the other noticing, producing inconsistent
title validation across the CLI and the HTTP bridge surface.

## §2 Canonical source

Extract from CLI's `apps/cli/src/commands/session/shared.ts` byte-for-byte:

```ts
z.string()
  .trim()
  .min(1)
  .regex(/^[^\x00-\x1f\x7f-\x9f  ]+$/, "title must not contain control characters")
  .transform((value) => value.normalize("NFC"));
```

The error message literal is intentionally the same string value as
`NAME_CONTROL_CHARS_MESSAGE` in `apps/cli/src/errors.ts`. The CLI
error-mapper (`mapErrorToCliMessage` at `errors.ts:92`) discriminates
the control-char case by equality on this string, so behaviour
preservation requires byte-equality.

Note: the regex includes U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH
SEPARATOR), which JS engines treat as line terminators and which break
the CLI's line-oriented output protocol. The bridge's inline copy
already had these characters; the hoist preserves them.

## §3 Destination

New module `packages/shared/src/title.ts` exports:

- `titleSchema: ZodEffects<…, string, string>` — the canonical schema.
- `Title` — `z.infer<typeof titleSchema>` (resolves to `string`).

Re-exported from `packages/shared/src/index.ts` via:

```ts
export * from "./title.js";
```

The `.js` suffix on the relative import matches the existing pattern
in `index.ts` (NodeNext ESM).

## §4 Consumers

### CLI — `apps/cli/src/commands/session/shared.ts`

Delete the local `titleSchema` and the now-unused
`NAME_CONTROL_CHARS_MESSAGE` import. Add
`import { titleSchema } from "@megasaver/shared";` and re-export
it so `create.ts` and `update.ts` (which import from `./shared.js`)
keep compiling without edit.

### Bridge — `apps/gui/bridge/zod-schemas.ts`

Delete the local `TITLE_SCHEMA` definition. Import the canonical
schema as `titleSchema` and rename the two in-file references
(`CREATE_SESSION_BODY.title`, `PATCH_SESSION_BODY.title`) to use
the new name. `routes/sessions.ts` consumes only the composed
bodies (`CREATE_SESSION_BODY`, `PATCH_SESSION_BODY`), so no edits
beyond `zod-schemas.ts` are required.

No alias (`titleSchema as TITLE_SCHEMA`) — renaming the two
consumers is one line of churn each and eliminates the
SCREAMING_SNAKE confusion (only true constants should use that
casing per CLAUDE.md §8).

## §5 Tests

New `packages/shared/test/title.test.ts` covers the schema in
isolation:

- Happy: accepts `"a"` (min length).
- Happy: accepts a multi-word title with spaces.
- Happy: trims leading/trailing whitespace, then accepts.
- Happy: normalises decomposed Unicode to NFC (e.g. `"é"` → `"é"`).
- Sad: rejects empty string.
- Sad: rejects whitespace-only string (after trim → empty).
- Sad: rejects C0 control characters (`\x00`–`\x1f`, e.g. `\n`, `\t`).
- Sad: rejects DEL `\x7f`.
- Sad: rejects C1 control characters (`\x80`–`\x9f`).
- Sad: rejects U+2028 LINE SEPARATOR.
- Sad: rejects U+2029 PARAGRAPH SEPARATOR.
- Property: any string built only from printable ASCII (33–126) is
  accepted after trim.
- Surface pin: the control-char error message is exactly
  `"title must not contain control characters"` — so CLI's
  error-mapper can keep discriminating on equality.

The pinned message string is the cross-package consistency contract.
If anyone changes it on either side, this test goes red and the CLI
error-mapper logic must be revisited.

## §6 Cross-package consistency

Type system + single canonical source carry the contract:

- CLI's `apps/cli/src/commands/session/shared.ts` re-exports the
  same `titleSchema` it imports from `@megasaver/shared`.
- Bridge's `apps/gui/bridge/zod-schemas.ts` composes the same
  imported `titleSchema` into its body schemas.
- The shared package test pins the regex message so CLI's
  error-mapper equality check (`firstIssue?.message ===
  NAME_CONTROL_CHARS_MESSAGE`) stays in sync.

The 855+ test suite (CLI 301 + GUI 165 + core/shared/connectors)
exercises the schema through both surfaces end-to-end; any
divergence surfaces immediately.

No new cross-package consistency test file is added. The pattern in
`apps/cli/test/connector-byte-equality.test.ts` is for byte-stream
contracts (newline format, BOM behaviour) that two writers must
match; here both consumers import the same module symbol, so the
type system already enforces identity.

## §7 Alternatives considered

- **Keep inlined copies** — rejected. M2's drift risk is precisely
  what this issue exists to close.
- **Hoist `NAME_CONTROL_CHARS_MESSAGE` too** — rejected as scope
  creep. The constant is also used by `commands/memory/shared.ts`,
  `commands/project.ts`, `commands/shared/schemas.ts`, and
  `errors.test.ts`. Hoisting it forces touching CLI-only schemas
  this spec does not own. The CLI keeps its constant; the shared
  schema repeats the same string literal. Test pins the string.
- **Add a runtime Zod-equality check** — rejected as overkill. Both
  consumers import the same symbol; there is nothing to compare.
- **Alias `titleSchema as TITLE_SCHEMA`** at the bridge import — rejected
  as it preserves the SCREAMING_SNAKE casing for what is not a true
  constant (Zod schemas are objects with methods).

## §8 Migration safety

- **TypeScript catches missed imports** — CLI re-export keeps
  `create.ts`/`update.ts` compiling unchanged.
- **CLI tests catch behavioural drift** — 301 tests exercise the
  schema through `runSessionCreate` and `runSessionUpdate`,
  including the "title must not contain control characters" and
  "title must not be empty" message-equality assertions.
- **GUI tests catch bridge drift** — 165 tests cover POST/PATCH
  `/api/sessions` with empty / invalid titles.
- **No new deps** — `zod` is already in `packages/shared`.
- **Public surface** — `@megasaver/shared` is a private workspace
  package; no changeset required.
