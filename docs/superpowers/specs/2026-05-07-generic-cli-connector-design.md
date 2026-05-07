---
title: generic-cli connector — v0.1 design
date: 2026-05-07
risk: HIGH
status: draft
authors: [claude]
related:
  - docs/superpowers/specs/2026-05-06-claude-code-connector-design.md
  - wiki/entities/connectors-claude-code.md
  - wiki/concepts/agent-agnostic-core.md
---

# generic-cli connector — v0.1 design

## §1 Goal & scope

Ship `@megasaver/connector-generic-cli`: a manifest-driven connector
package that synchronises a Mega Saver managed block into a per-agent
config file. v0.1 lands a single concrete target (Codex, root
`AGENTS.md`); the manifest API is generic so additional targets land
as data + smoke tests in later specs without API change.

The same spec carries two co-changes required to keep the connector
surface coherent:

- **New package** `@megasaver/connectors-shared` extracts the block
  render/parse/upsert/remove helpers and the connector context schema
  out of the existing claude-code connector. Agent-agnostic by
  construction.
- **Refactor** `@megasaver/connector-claude-code` to consume the new
  shared package. Public surface unchanged. Block render output
  bit-identical (snapshot equality required).

CLI integration (`mega connector …`) is **out of scope**; the
connector is a library, mirroring the claude-code precedent.

Risk: **HIGH**. Per `CLAUDE.md` §12 connectors and public surfaces
are HIGH; refactoring an existing HIGH-risk package compounds the
review burden. Worktree mandatory; full superpowers chain plus
`architect` design review and `critic` adversarial review.

## §2 Package topology

Three packages are touched.

```
packages/
├─ connectors/
│  ├─ shared/                    # NEW @megasaver/connectors-shared
│  ├─ claude-code/               # REFACTOR @megasaver/connector-claude-code
│  └─ generic-cli/               # NEW @megasaver/connector-generic-cli
```

| Package | Role |
|---|---|
| `@megasaver/connectors-shared` | Block sentinels, `ConnectorContext` schema, `renderBlock` / `parseBlock` / `upsertBlock` / `removeBlock`, target-agnostic filesystem helpers, base error class. Knows nothing about specific agents. |
| `@megasaver/connector-claude-code` | Thin wrapper: agent-id literal `"claude-code"`, file-name literal `"CLAUDE.md"`, narrowed context schema, error-class alias. No render logic of its own. |
| `@megasaver/connector-generic-cli` | Manifest registry plus thin per-target sync wrapper. v0.1 ships one target (`codexTarget`). |

Dependency direction:

```
generic-cli ──▶ connectors-shared ──▶ core ──▶ shared
claude-code ──▶ connectors-shared ──▶ core ──▶ shared
```

`connectors-shared` depends on `@megasaver/core` for entity schemas
(`ProjectSchema`, `SessionSchema`, `MemoryEntrySchema`) and on
`@megasaver/shared` for branded ids. It does not depend on the CLI
or any other connector. Connectors do not depend on each other.

## §3 `@megasaver/connectors-shared` API

### Constants

```ts
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";
export const MEGA_SAVER_BLOCK_END = "<!-- MEGA SAVER:END -->";
```

These move out of `@megasaver/connector-claude-code`. The claude-code
package re-exports them under their existing names for backwards
compatibility.

### Context schema

```ts
export const ConnectorContextSchema = z
  .object({
    agentId: agentIdSchema,
    project: ProjectSchema,
    session: SessionSchema.nullable(),
    memoryEntries: z.array(MemoryEntrySchema).max(20),
  })
  .strict()
  .superRefine((ctx, issues) => {
    // session.projectId === project.id
    // session.agentId === context.agentId when session !== null
    // memoryEntries[i].projectId === project.id
    // session-scoped memory requires non-null session
    // memoryEntries[i].sessionId === session.id when session-scoped
    // sentinel string substrings rejected in name / title / content
  });

export type ConnectorContext = z.infer<typeof ConnectorContextSchema>;
```

`agentId` is part of `ConnectorContext` so that `renderBlock` can
emit `Agent: <agent-id>` deterministically without an extra
parameter and without depending on whether a session is present.
Per-target packages narrow `agentId` to the literal they support
(`"claude-code"` for the claude-code wrapper; `target.agentId` for
generic-cli wrappers).

### Pure render / parse / upsert helpers

```ts
export function renderBlock(context: ConnectorContext): string;

export function parseBlock(content: string): {
  before: string;
  block: string | null;
  after: string;
};

export function upsertBlock(args: {
  existingContent: string;
  context: ConnectorContext;
}): string;

export function removeBlock(content: string): string;
```

`renderBlock` produces the canonical block, identical in shape to
claude-code's current render. The block content is:

```md
<!-- MEGA SAVER:BEGIN -->
# Mega Saver Context

Agent: <agent-id>
Project: <name> (<id>)
Session: <title-or-id-or-"none">
Risk: <risk-or-"none">

## Memory

- [project:<entry-id>] <content>
- [session:<entry-id>] <content>
<!-- MEGA SAVER:END -->
```

`<agent-id>` is read from `context.agentId` (always present per the
schema). Render is deterministic and contains no per-target
customisation hooks; customisation is explicitly deferred (R2/R3 in
§7).

`parseBlock` walks the input by sentinel pair. Behaviour:

- Zero begin sentinels and zero end sentinels →
  `{ before: content, block: null, after: "" }`.
- Exactly one begin sentinel and exactly one end sentinel where
  begin precedes end → `{ before, block, after }` with `block`
  containing the sentinels and the content between them.
- Any other shape (two-or-more begin sentinels, mismatched count
  between begin and end sentinels, end sentinel before begin
  sentinel) → throws `ConnectorError("block_conflict", null)`.

`upsertBlock` replaces an existing block in place when present,
preserving surrounding whitespace; otherwise appends the rendered
block to the file with a single blank-line separator. The exact
spacing rules are inherited verbatim from the current claude-code
helpers and are covered by the bit-identical regression suite.

`removeBlock` strips the block plus the immediately surrounding blank
line if it became dangling. No-op when no block is present.

### Filesystem helpers

```ts
export async function readTargetFile(absPath: string): Promise<string | null>;
// → null when ENOENT; throws ConnectorError("file_read_failed", absPath) otherwise.

export async function writeTargetFile(args: {
  absPath: string;
  content: string;
}): Promise<void>;
// → temp-file + rename; throws ConnectorError("file_write_failed", absPath).

export async function syncTargetBlock(args: {
  absPath: string;
  context: ConnectorContext;
}): Promise<void>;
// → readTargetFile → upsertBlock → writeTargetFile.
```

When `readTargetFile` returns `null` (file does not yet exist),
`syncTargetBlock` substitutes an empty string, runs `upsertBlock`
(which appends the rendered block to empty content), and creates the
file via `writeTargetFile`. The parent directory must exist; missing
directories surface as `file_write_failed`.

Concurrency note: `syncTargetBlock` is last-write-wins. No locking,
matching claude-code's accepted residual risk.

### Errors

```ts
export const connectorErrorCodeSchema = z.enum([
  "context_invalid",
  "block_conflict",
  "file_read_failed",
  "file_write_failed",
  "target_path_invalid",
]);
export type ConnectorErrorCode = z.infer<typeof connectorErrorCodeSchema>;

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly filePath: string | null;
  constructor(code: ConnectorErrorCode, filePath: string | null);
}
```

Per-target packages may re-export this class as-is, or wrap it in a
narrower class with a narrower code union (claude-code does the
latter for backwards compatibility; generic-cli does the latter to
add `target_unknown`).

## §4 `@megasaver/connector-claude-code` refactor

The public surface is **unchanged**. The package becomes a thin
wrapper:

| Existing export | After refactor |
|---|---|
| `MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END` | re-exports from `connectors-shared` |
| `CLAUDE_CODE_AGENT_ID` (`"claude-code"`) | unchanged literal |
| `CLAUDE_MD_FILE` (`"CLAUDE.md"`) | unchanged literal |
| `ClaudeCodeContextSchema` | `ConnectorContextSchema` narrowed via refinement: `agentId === "claude-code"` (and the inherited shared rule already enforces `session.agentId === agentId` when session is present) |
| `assertClaudeCodeContext(input)` | `ClaudeCodeContextSchema.parse` |
| `renderClaudeCodeContext(context)` | thin call into `renderBlock` |
| `parseClaudeMd(content)` | thin call into `parseBlock` |
| `upsertMegaSaverBlock(args)` | thin call into `upsertBlock` |
| `removeMegaSaverBlock(content)` | thin call into `removeBlock` |
| `readClaudeMd(projectRoot)` | join `projectRoot` + `CLAUDE.md` → `readTargetFile` |
| `writeClaudeMd({ projectRoot, content })` | join + `writeTargetFile` |
| `syncClaudeMdContext({ projectRoot, context })` | join + `syncTargetBlock` |
| `claudeCodeConnectorErrorCodeSchema` | union: `claude_md_context_invalid`, `claude_md_block_conflict`, `claude_md_read_failed`, `claude_md_write_failed`, `project_root_invalid` |
| `ClaudeCodeConnectorErrorCode` | inferred type |
| `ClaudeCodeConnectorError` | wraps `ConnectorError`. Maps shared codes → claude-code codes 1:1 (`context_invalid` → `claude_md_context_invalid`, `block_conflict` → `claude_md_block_conflict`, `file_read_failed` → `claude_md_read_failed`, `file_write_failed` → `claude_md_write_failed`, `target_path_invalid` → `project_root_invalid`). |

The wrapper layer catches every `ConnectorError` thrown from
`connectors-shared`, maps the code, and re-throws a
`ClaudeCodeConnectorError`. Callers see no surface change.

### Bit-identical render guarantee

The block rendered through the new code path against the same input
must be byte-identical to the block rendered by the pre-refactor
code. This is enforced by:

- Existing render snapshot tests in `connector-claude-code` continue
  to pass without snapshot updates.
- A regression test imports a fixture context and asserts the
  rendered block matches a frozen byte-string captured before the
  refactor.

If any snapshot needs updating, the refactor is wrong.

## §5 `@megasaver/connector-generic-cli` API

### Manifest type

```ts
export interface ConnectorTarget {
  readonly id: string;            // stable target id, e.g. "codex"
  readonly agentId: AgentId;       // brand from @megasaver/shared
  readonly relativePath: string;   // project-root-relative POSIX path
}
```

Pure data: no render function, no per-target sentinel override. The
shared render is constant; per-target customisation is explicitly
deferred.

### v0.1 builtin target

```ts
export const codexTarget: ConnectorTarget = {
  id: "codex",
  agentId: "codex",
  relativePath: "AGENTS.md",
};

export const builtinTargets = Object.freeze([codexTarget] as const);
```

`AgentId` in `@megasaver/shared` is currently
`z.enum(["claude-code", "generic-cli"])`. This spec extends it to
`z.enum(["claude-code", "codex", "generic-cli"])` so that the Codex
target carries its own agent identity rather than collapsing into a
shared `"generic-cli"` bucket. The extension is the only `@megasaver/shared`
change required by this spec.

### Public surface

```ts
export {
  codexTarget,
  builtinTargets,
  type ConnectorTarget,
};

export function findTarget(id: string): ConnectorTarget | null;

export const GenericCliContextSchema: ZodType<ConnectorContext>;
export function assertGenericCliContext(
  input: unknown,
  target: ConnectorTarget,
): ConnectorContext;

export async function syncGenericCliTarget(args: {
  projectRoot: string;
  target: ConnectorTarget;
  context: ConnectorContext;
}): Promise<void>;

export async function readGenericCliTarget(args: {
  projectRoot: string;
  target: ConnectorTarget;
}): Promise<string | null>;

export async function writeGenericCliTarget(args: {
  projectRoot: string;
  target: ConnectorTarget;
  content: string;
}): Promise<void>;

export const genericCliConnectorErrorCodeSchema: ZodType<GenericCliConnectorErrorCode>;
export type GenericCliConnectorErrorCode =
  | "target_unknown"
  | "context_invalid"
  | "block_conflict"
  | "file_read_failed"
  | "file_write_failed"
  | "project_root_invalid";

export class GenericCliConnectorError extends Error {
  readonly code: GenericCliConnectorErrorCode;
  readonly filePath: string | null;
}
```

`assertGenericCliContext(input, target)` runs `ConnectorContextSchema.parse(input)`
and additionally enforces `context.agentId === target.agentId`. The
shared schema already enforces `session.agentId === context.agentId`
when a session is present, so target/session alignment is
transitive.

`syncGenericCliTarget` validates `projectRoot` (must be an absolute
path, must exist as a directory) and joins it with `target.relativePath`,
then delegates to `connectors-shared` `syncTargetBlock`. All shared
errors are mapped through to `GenericCliConnectorError`:

- `context_invalid` → `context_invalid`
- `block_conflict` → `block_conflict`
- `file_read_failed` → `file_read_failed`
- `file_write_failed` → `file_write_failed`
- `target_path_invalid` → `project_root_invalid`

`target_unknown` is generic-cli-only and is thrown by `findTarget`
callers when an unknown id is supplied (e.g. via a future CLI).
`findTarget` itself returns `null`; the error is the responsibility
of the caller that decided to fail rather than fall back.

### Validation rules summary

- `context.project.id` matches every `memoryEntry.projectId` and the
  optional `session.projectId`.
- `memoryEntries.length` ≤ 20.
- Sentinel strings (`<!-- MEGA SAVER:BEGIN -->`, `<!-- MEGA SAVER:END -->`)
  are not substrings of any rendered field (project name, session
  title, memory content).
- `context.agentId === target.agentId`.
- `session.agentId === context.agentId` when session is present
  (already enforced by the shared schema).
- `projectRoot` is absolute and points to an existing directory at
  write time.

## §6 Test strategy

### `@megasaver/connectors-shared`

| File | Coverage |
|---|---|
| `test/context.test.ts` | Project/session/memory cross-id matching, max-20 cap, session-scoped memory without session, sentinel substring rejection across name/title/content. |
| `test/render.test.ts` | Deterministic snapshot for: no session, session, no memory, project-only memory, mixed scopes, every-field-present. |
| `test/parse.test.ts` | No block, single block, two blocks → `block_conflict`, malformed sentinels (begin without end, end without begin). |
| `test/upsert.test.ts` | Insert into empty file, insert into pre-existing user content, replace existing block, preserve surrounding whitespace, leading/trailing blank-line normalisation. |
| `test/remove.test.ts` | Block removed cleanly, surrounding content preserved, no-op when no block, dangling blank-line handling. |
| `test/filesystem.test.ts` | `readTargetFile` returns `null` on ENOENT and `file_read_failed` on other read errors, `writeTargetFile` does temp-file + rename, EACCES → `file_write_failed`, `syncTargetBlock` round-trip in tmp dir. |
| `test/public-export.test.ts` | Built-package smoke against `dist/index.js`: every named export present and callable. |

### `@megasaver/connector-claude-code`

- All 44 existing tests pass without modification (the public
  surface is preserved).
- Add `test/regression.test.ts`: a frozen byte-string captured from
  the pre-refactor render output is asserted against the new render
  for one canonical context. This is the bit-identical guarantee
  from §4.

### `@megasaver/connector-generic-cli`

| File | Coverage |
|---|---|
| `test/targets.test.ts` | `findTarget("codex")` returns `codexTarget`; `findTarget("unknown")` returns `null`; `builtinTargets` is frozen; `codexTarget` field values. |
| `test/context.test.ts` | `assertGenericCliContext` rejects mismatched `session.agentId`; passes for `agentId === target.agentId`; surfaces wrapped `context_invalid`. |
| `test/sync.test.ts` | Against tmp dir: empty `AGENTS.md` → block inserted; user content preserved; second sync replaces block; two-block file → `block_conflict`. |
| `test/errors.test.ts` | Error class shape, code union exhaustiveness, `filePath` nullability, code mapping from shared errors. |
| `test/public-export.test.ts` | Built-package smoke: `dist/index.js` import + tmp-dir `syncGenericCliTarget` round-trip prints `true`. |

### Aggregate gate

`pnpm verify` runs across the workspace. Expected counts: ≥250
total tests across 5 packages (`shared`, `core`, `cli`,
`connectors-shared`, `connector-claude-code`, `connector-generic-cli`).
Lint and typecheck across all five must be clean.

## §7 Risk, boundary, residual

### HIGH-risk gating

This change is HIGH per `CLAUDE.md` §12: a new public surface, plus
a refactor of an existing HIGH-risk package, plus user-file writes.
Required:

- Worktree (`.worktrees/generic-cli-connector`).
- Full superpowers chain.
- `architect` design review before plan finalisation.
- `code-reviewer` plus `critic` both Approved on the final commit.
- Author and reviewer agents in separate active contexts.

### Boundary rules

- `connectors-shared` knows no agent identity: the `agentId` field
  is data carried through `Session`, never a literal embedded in
  helper code.
- `connector-generic-cli` does not depend on `connector-claude-code`,
  and vice versa. The shared package is the only common dependency.
- Connectors do not call into the CLI; the CLI does not call into
  connectors yet.
- No singletons. Each `syncGenericCliTarget` invocation is
  self-contained and stateless beyond filesystem I/O.

### Accepted residual risks (out of scope, deferred)

- **R1** No optimistic concurrency or file locking on managed-block
  writes. Last-write-wins, matching claude-code v0.1.
- **R2** No `.cursor/rules/*.mdc` target. Cursor support requires a
  manifest-level slot for frontmatter (e.g. globs); revisit when
  Cursor is the next concrete target.
- **R3** No Aider `.aider.conf.yml` or YAML target. YAML cannot host
  HTML comment sentinels; would require a per-target block-format
  slot.
- **R4** No `.claude/CLAUDE.md` or `~/.claude/CLAUDE.md` (still
  out of scope on the claude-code side too).
- **R5** No CLI integration. `mega connector sync` is a future
  feature spec that will cover both connectors uniformly.
- **R6** No file mode or xattr preservation guarantees on writes
  (claude-code aligned).
- **R7** No optimistic schema migration if `AGENTS.md` is a
  symlink, hard-linked, or owned by a different user. Best-effort
  rename within the same directory is the only filesystem
  guarantee.

### Changesets

- `@megasaver/connectors-shared`: **major** (initial publish).
- `@megasaver/connector-claude-code`: **patch** (refactor, no public
  delta).
- `@megasaver/connector-generic-cli`: **major** (initial publish).
- `@megasaver/core`: unchanged.
- `@megasaver/shared`: **patch** — adds `"codex"` to the `AgentId`
  enum.

### Definition of done

`CLAUDE.md` §9 plus:

- Bit-identical render evidence committed (regression snapshot byte
  string).
- Tmp-dir smoke evidence for `syncGenericCliTarget` covering insert,
  preserve-surrounding-content, and replace.
- Wiki updated: `wiki/entities/connectors-shared.md` (new),
  `wiki/entities/connectors-generic-cli.md` (new),
  `wiki/entities/connectors-claude-code.md` (refactor delta noted),
  `wiki/index.md` and `wiki/log.md` entries.
