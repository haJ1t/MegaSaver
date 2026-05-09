---
title: MemoryEntry CLI — design
risk: MEDIUM
status: draft
created: 2026-05-09
updated: 2026-05-09
related:
  - docs/superpowers/specs/2026-05-04-core-package-design.md
  - docs/superpowers/specs/2026-05-08-cli-session-crud-design.md
  - docs/superpowers/specs/2026-05-09-mega-session-update-design.md
  - wiki/entities/cli.md
  - wiki/entities/core.md
---

# MemoryEntry CLI — design

## §0 TL;DR

Add a new top-level subcommand `mega memory` with three append-only
operations: `create`, `list`, `show`. The CoreRegistry surface
(`createMemoryEntry` / `getMemoryEntry` / `listMemoryEntries`) is
already complete on both in-memory and JSON-directory
implementations; this slot is purely the CLI thin layer + Zod
boundary validation. No Core change.

`mega memory create` accepts `<projectName>` positional + required
`--scope <project|session>` + required `--content "…"` + optional
`--session <uuid>` (required when `--scope session`, rejected when
`--scope project`). Empty content rejected; control-character /
newline content rejected at the CLI boundary via a new
`contentSchema` (mirrors the `titleSchema` pattern from PR #18).

`mega memory list <projectName>` emits one line per entry under
the project: `<id>  <scope>  <session|->  <content-truncated>`,
content truncated to 59 chars + `…` when longer.

`mega memory show <memoryEntryId>` emits a six-line `key=value`
view (12-char key column, 2-space gutter), mirroring `mega session
show`.

## §1 Motivation

`@megasaver/core` shipped MemoryEntry schema + registry methods in
its v0.1 slice (PR #4). The connector block render path reserves a
`memoryEntries: []` slot and `mega connector sync` writes that
list into every agent file. Without a CLI ingestion path the list
is permanently empty and the connector block always renders zero
memories — the v0.1 product story ("Project + Session +
MemoryEntry triad") is two-thirds delivered.

Closing the gap with read-add operations (no delete, no update —
matches Core's append-only registry) puts the third entity on the
CLI surface. A future slot ("MemoryEntry connector wiring") will
flip the connector context's empty-list to `registry.listMemory
Entries(project.id)` so block content matches reality. That slot
is explicitly out of scope here (Q1 user choice "A only, no
Bonus").

## §2 Non-goals

- No `mega memory delete` — Core registry has no `deleteMemoryEntry`
  method. Adding one is a separate scope decision (audit /
  cascade behaviour around session-scoped memory when the parent
  session ends).
- No `mega memory update` — append-only ledger. Update conflicts
  with the immutability invariant.
- No connector context wiring — `mega connector sync` / `status`
  continue to pass `memoryEntries: []` to `buildConnectorContext`.
  Separate slot.
- No `--json` flag pass.
- No memory entry search / filter (e.g. `mega memory list
  --scope project`).
- No TTL / expires field on the schema (not in Core's v0.1).
- No closure of the open V1-V4 / V6-V9 (PR #18) / U2-U10 (PR #17)
  / S3-S11 (PR #15) / T1, T3-T8 (PR #16) backlog.

## §3 Surface

### 3.1 CLI subcommands

```
mega memory create <projectName> --scope <project|session> --content "…" [--session <uuid>] [--store <dir>]
mega memory list <projectName> [--store <dir>]
mega memory show <memoryEntryId> [--store <dir>]
```

Parent command `mega memory` registered as a top-level subcommand
in `apps/cli/src/main.ts` alongside `project`, `session`,
`connector`, `doctor`.

### 3.2 `mega memory create`

Positional + flags:

- `<projectName>` (required) — resolved against the store via
  `registry.listProjects().find((p) => p.name === parsedName)`.
  Validated through the existing `projectNameSchema` (NFC + control
  char rejection from prior session/project commands).
- `--scope <project|session>` (required) — closed enum. Bad value
  → `error: invalid scope "<value>", expected: project | session`.
- `--content "…"` (required) — non-empty string after `.trim()`.
  Validated through new `contentSchema` (defined in
  `apps/cli/src/commands/memory/shared.ts`):

  ```ts
  export const contentSchema = z
    .string()
    .trim()
    .min(1)
    // C0/C1 control chars and DEL break the line-oriented output protocol.
    .regex(/^[^\x00-\x1f\x7f-\x9f]+$/, NAME_CONTROL_CHARS_MESSAGE)
    .transform((value) => value.normalize("NFC"));
  ```

  Empty `--content ""` rejects with the existing `min(1)` Zod
  message routed through `kind: "memory_create"`. Newline content
  (`--content $'a\nb'`) rejects with the control-char message.

- `--session <uuid>` (optional) — required when `--scope session`,
  rejected when `--scope project`. Validated through the existing
  `sessionIdSchema`. Cross-field guard runs at the CLI boundary
  before any registry call:
  - `--scope session` + missing `--session` →
    `error: --session is required when --scope is session`.
  - `--scope project` + present `--session` →
    `error: --session is not allowed when --scope is project`.

  When `--scope session` provides a `--session <uuid>`, a
  pre-flight `registry.getSession(sessionId) === null` check rejects
  with `error: session "<uuid>" not found` BEFORE
  `createMemoryEntry` is called. Belt-and-suspenders against
  registry-level cross-row drift (Core's `memoryEntrySchema` only
  validates the cross-field shape, not session existence).

- `--store <dir>` (optional) — store override (mevcut paterne uygun).

Behaviour:

1. Resolve store path (existing `resolveStorePath`).
2. Parse `<projectName>` via `projectNameSchema`.
3. Parse `--scope` via `memoryScopeSchema` (re-export from
   `@megasaver/core`).
4. Cross-field check: scope+session.
5. Parse `--content` via `contentSchema`.
6. (Pre-flight) Init store via `ensureStoreReady`. Resolve project
   by name; missing → `projectNotFoundMessage`.
7. (Pre-flight) When `--scope session`: `registry.getSession(parsed
   SessionId)`; missing → `error: session "<id>" not found`.
8. Build `MemoryEntry`:
   ```ts
   const entry: MemoryEntry = memoryEntrySchema.parse({
     id: input.newId(), // crypto.randomUUID()
     projectId: project.id,
     sessionId: parsedSession ?? null,
     scope: parsedScope,
     content: parsedContent,
     createdAt: input.now(),
   });
   ```
9. `registry.createMemoryEntry(entry)`.
10. Print `entry.id` on stdout. Exit 0.

Test injection: same `MEGA_TEST_MEMORY_ENTRY_ID` / `MEGA_TEST_NOW`
NODE_ENV-gated env-vars as session/project (delegate to the existing
`readTestEnv` helper).

### 3.3 `mega memory list <projectName>`

Resolves project by name. Calls `registry.listMemoryEntries(project
.id)`. Empty project → empty stdout, exit 0.

Output line shape:

```
<id>  <scope-padded-7>  <session-padded-36>  <content-truncated-60>
```

- `id` field full UUID (36 chars).
- `scope` field padded right to 7 chars (`project` 7, `session` 7
  matches).
- `session` field full UUID (36 chars) when present, `-` padded to
  36 chars when null.
- `content` field truncated to 59 chars + `…` (single Unicode
  U+2026 character, total 60 char visual width, 1 codepoint
  pad) when content is longer than 60 chars; else printed as-is.
  Truncation is char-count not byte-count; control chars are
  already rejected at create time so multi-byte but no
  multi-line.

Two-space gutter between every field. Lines emitted in registry
declaration order (insertion order — same as the existing in-memory
`Map` iteration).

Worked example:

```
01abc...  project  -                                     user prefers TS over JS
02def...  session  03ghi-...                              checked CSRF token expiry; needs follow-up next sprint…
04jkl...  project  -                                     run pnpm verify before all merges
```

### 3.4 `mega memory show <memoryEntryId>`

Positional `<memoryEntryId>`, validated through
`memoryEntryIdSchema`. Bad UUID → `error: invalid memory entry id
"<value>"`, exit 1. `registry.getMemoryEntry(id) === null` →
`error: memory entry "<id>" not found`, exit 1.

Output: 6-line `key=value`, 12-char key column, 2-space gutter
(mirrors `session show`'s 7-line shape minus the `endedAt`
column):

```
id          <uuid>
project     <uuid>
session     <uuid|->
scope       project|session
content     <free text>
createdAt   <RFC 3339>
```

`session` line renders `-` when `sessionId === null` (project-scoped
memory). `content` is rendered as-is — control chars are guaranteed
absent by the create-time guard, so this single line is safe.

### 3.5 Errors module extensions

`apps/cli/src/errors.ts` adds:

- New ZodContext variants:
  - `{ kind: "memory_create" }` — Zod issue routing for
    `contentSchema.parse`, `memoryScopeSchema.parse`, and the
    cross-field guard.
  - `{ kind: "memoryEntryId" }` — id parse errors.
- New helpers (parallel to existing pattern):
  - `memoryEntryNotFoundMessage(id: string): CliMessage` —
    `error: memory entry "<id>" not found`, exit 1.
  - `invalidScopeMessage(value: string): CliMessage` —
    `error: invalid scope "<value>", expected: project | session`,
    exit 1.
  - `scopeProjectWithSessionMessage(): CliMessage` —
    `error: --session is not allowed when --scope is project`,
    exit 1.
  - `scopeSessionWithoutSessionMessage(): CliMessage` —
    `error: --session is required when --scope is session`, exit 1.
- New drift-guard constant:
  - `KNOWN_SCOPE_IDS = ["project", "session"] as const satisfies
    readonly MemoryScope[]` — keeps the CLI's accepted-list
    in lockstep with `memoryScopeSchema` from Core.
- `mapErrorToCliMessage` extends to route `CoreRegistryError("memory
  _entry_not_found", …)` (raised by `registry.getMemoryEntry`
  through `runMemoryShow` if it ever needs to call into Core for
  resolution) through `memoryEntryNotFoundMessage`. Today the
  `registry.getMemoryEntry` returns null rather than throwing, so
  the show command does the null-check itself; this branch is
  defensive against a future API shift.

### 3.6 File layout

`apps/cli/src/commands/memory/` (new directory mirroring the
post-PR-#18 `commands/session/` layout):

| File          | LOC est. |
|---------------|----------|
| `index.ts`    | ~30      |
| `shared.ts`   | ~80      |
| `create.ts`   | ~150     |
| `list.ts`     | ~80      |
| `show.ts`     | ~85      |

Each module exports its own `Run*Input`, `run*`, `*Command` triple.
`shared.ts` houses `contentSchema`, `formatMemoryListLine`,
`formatMemoryShowLines`, plus a small `padField(value, width)`
helper if the existing list/show helpers in
`commands/session/shared.ts` are not directly reusable. (They are
not: session list pads at 36 chars; memory list pads at multiple
widths.)

`apps/cli/src/main.ts` registers `memory: memoryCommand` as the
fifth top-level subcommand.

## §4 Output format examples

`mega memory create demo --scope project --content "user prefers TS"`:
```
$ mega memory create demo --scope project --content "user prefers TS"
01abcdef-abcd-4abc-8abc-abcdefabcdef
$ echo $?
0
```

`mega memory list demo` with three entries:
```
01abcdef-abcd-4abc-8abc-abcdefabcdef  project  -                                     user prefers TS
02bcdefa-bcde-4bcd-8bcd-bcdefabcdefa  session  03cdefab-cdef-4cde-8cde-cdefabcdefab  checked CSRF token expiry; needs follow-up nextspr…
04defabc-defa-4def-8def-defabcdefabc  project  -                                     run pnpm verify before merges
```

`mega memory show 01abcdef-abcd-4abc-8abc-abcdefabcdef`:
```
id          01abcdef-abcd-4abc-8abc-abcdefabcdef
project     11111111-1111-4111-8111-111111111111
session     -
scope       project
content     user prefers TS
createdAt   2026-05-09T14:23:01.000Z
```

## §5 Test plan

New tests (CLI only — no Core change):

**`apps/cli/test/memory.test.ts` (new file):**

`describe("memoryCreateCommand")`:
1. project-scoped happy path: `--scope project --content "..."` → DB has 1 entry, sessionId null.
2. session-scoped happy path: `--scope session --content "..." --session <uuid>` → DB has 1 entry, sessionId === uuid.
3. id stamped from `MEGA_TEST_MEMORY_ENTRY_ID` (NODE_ENV=test).
4. createdAt stamped from `MEGA_TEST_NOW` (NODE_ENV=test).
5. project not found → exit 1, `error: project "<name>" not found`, no DB write.
6. unknown session id (with `--scope session --session <bogus>`) → exit 1, `error: session "<uuid>" not found`, no DB write.
7. `--content ""` → exit 1, Zod error via `kind: "memory_create"`.
8. `--content $'a\nb'` (newline) → exit 1, control-char error.
9. `--scope bogus` → exit 1, `error: invalid scope "bogus", expected: project | session`.
10. `--scope project --session <uuid>` → exit 1, scopeProjectWithSession message.
11. `--scope session` (no `--session`) → exit 1, scopeSessionWithoutSession message.

`describe("memoryListCommand")`:
12. Empty project → empty stdout, exit 0.
13. Single project-scoped entry → one line, scope=project, session=`-`, content full.
14. Mixed entries (project + session-scoped) → multiple lines, declaration order, fields padded.
15. Long content (>60 chars) → truncated with `…`.

`describe("memoryShowCommand")`:
16. project-scoped show → 6 lines, session=`-`, content rendered.
17. session-scoped show → 6 lines, session=`<uuid>`, content rendered.
18. unknown id → exit 1, `error: memory entry "<id>" not found`.
19. invalid uuid id → exit 1, invalid memory entry id error.

**`apps/cli/test/errors.test.ts` (extension):**
20. `memoryEntryNotFoundMessage("X")` returns `{ message: 'error: memory entry "X" not found', exitCode: 1 }`.
21. `invalidScopeMessage("bogus")` returns the documented shape.
22. `scopeProjectWithSessionMessage()` shape.
23. `scopeSessionWithoutSessionMessage()` shape.
24. `mapErrorToCliMessage(zodErr, { kind: "memory_create" })` smoke.

Total new tests: **24** (19 memory + 5 errors). CLI 142 → 166. Total
project 421 → 445.

## §6 Risk

**MEDIUM**. Single-package change (`apps/cli`). Core schema
unchanged. Errors module additive. Existing `mega project` /
`mega session` / `mega connector` / `mega doctor` paths
byte-identical.

Full superpowers chain (TDD, code-reviewer, critic v0.2 followup
pass) before merge.

## §7 Out of scope (explicit)

- `mega memory delete` — needs Core extension.
- `mega memory update` — append-only design.
- Connector context wiring (sync / status read real
  `listMemoryEntries`).
- `--json` flag pass.
- Search / filter on list.
- TTL / expires field.
- Critic backlog (V1-V4, V6-V9 / U2-U10 / S3-S11 / T1, T3-T8) —
  separate slots.

## §8 Migration / compatibility

No migration. CLI consumers without `mega memory` calls see no
behaviour change. Existing `memoryEntries.json` (or whatever the
JSON-directory registry uses) parses cleanly because no schema
field is added.

If a user had pre-existing memory entries written through Core
directly (e.g. via a test harness), `mega memory list` /
`mega memory show` will read them. No collision.
