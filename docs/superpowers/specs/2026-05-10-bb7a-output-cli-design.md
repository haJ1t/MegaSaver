---
title: BB7a — mega output {file,filter,chunk} CLI (no exec)
status: proposed
risk: HIGH
created: 2026-05-10
parent: aa1-context-gate-epic
sub-pr: BB7a
---

# BB7a — `mega output {file,filter,chunk}` CLI surface

## 1. Scope & non-goals

This sub-PR ships three new `mega output` subcommands in `apps/cli`:

- `mega output file` — read an on-disk file through the two-gate
  path-safety pipeline, run it through `filterOutput`, optionally
  persist the chunk-set.
- `mega output filter` — run an existing log file through the same
  filter pipeline (no path-read policy gate beyond the sandbox
  resolver; useful for `pnpm test > log.txt && mega output filter`).
- `mega output chunk` — return a single stored chunk from a
  previously persisted chunk-set, located by `<chunk-set-id>` alone.

The epic authority is `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`
§5b (BB7a rows only), §3 (workspace layout, dep graph, cycle
guardrails), §9a (`evaluatePathRead`, `PolicyDenyCode`), §10
(content-store), §11 (output-filter). This child spec only
summarises; the epic spec is the source of truth.

**Explicitly OUT of scope (do NOT implement here):**

- `mega output exec` — spawns a child process; lands in **BB7b**
  at **CRITICAL** risk. No `child_process` import anywhere in this
  PR. No `evaluateCommand` call. No `MEGASAVER_ORIGIN_PID` handling.
- The context-gate orchestrator (`packages/core/src/context-gate/`).
- Any new package, MCP tool, or GUI view.
- The v0.9 permissions file.

**No new package.** BB7a adds commands to the existing `apps/cli`
package only. There is therefore no package scaffold, no new
`vitest.config.ts`/`tsup.config.ts`, and no new closed enum
(→ no `*.test-d.ts` tuple pin). The cycle guardrail is enforced by
a new `apps/cli/test/dependency-graph.test.ts` against the §3c
allow-list (the OO `apps/gui/bridge/` precedent cited in §3c).

## 2. Dependency allow-list (§3c, MANDATORY)

`apps/cli` MAY depend on exactly these `@megasaver/*` packages
after BB7a (superset of the pre-BB7a set plus the three BB7a adds):

```
@megasaver/shared
@megasaver/core
@megasaver/policy            ← added by BB7a (evaluatePathRead, PolicyDenyCode)
@megasaver/output-filter     ← added by BB7a (filterOutput, resolveSafeReadPath)
@megasaver/content-store     ← added by BB7a (saveChunkSet, loadChunkSet, listChunkSets)
@megasaver/connectors-shared (pre-existing)
@megasaver/connector-generic-cli (pre-existing)
```

`apps/cli/test/dependency-graph.test.ts` parses
`apps/cli/package.json` `dependencies` and asserts every
`@megasaver/*` key is a member of the allow-list above (non-Mega
deps `citty`, `zod` are ignored by the `@megasaver/` filter, or
allow-listed explicitly). It also asserts **no** dependency on
`@megasaver/mcp-bridge`, `@megasaver/retrieval`, or
`@megasaver/stats` (none are needed by BB7a).

## 3. Public surface (locked)

All three commands follow the existing run-function shape
(`apps/cli/src/commands/session/update.ts:13-28`): a pure
`run*` function takes an explicit input record (cwd/home/
xdgDataHome/stdout/stderr/json plumbing, no `process.*` reads
inside), returns `Promise<0 | 1>`, and a thin `defineCommand`
wrapper reads `process.*` and wires stdout/stderr.

### 3a `apps/cli/src/commands/output/file.ts`

```ts
export type RunOutputFileInput = {
  sessionId: string;
  intentFlag: string | undefined;   // --intent (REQUIRED)
  path: string;                     // positional <path>
  storeFlag: string | undefined;    // --store
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};
export async function runOutputFile(input: RunOutputFileInput): Promise<0 | 1>;
export const outputFileCommand: CommandDef;
```

Pipeline (strict order, all gates must pass before `fs.readFile`):

1. Resolve store root (`resolveStorePath`, mirror update.ts:30-39).
2. Parse `sessionId` via `sessionIdSchema` at the CLI boundary.
3. Require `--intent`: if `intentFlag` is undefined/empty →
   `intent_required` error, exit 1, no read.
4. `ensureStoreReady(rootDir)` → `registry.getSession(sessionId)`.
   `null` → `session_not_found`, exit 1. From the session derive
   `projectId` and read `session.tokenSaver` settings (mode,
   maxReturnedBytes, redactSecrets, storeRawOutput). When
   `session.tokenSaver` is `undefined` (pre-AA session, §4c), fall
   back to `defaultTokenSaverSettings` semantics: mode `"balanced"`,
   `storeRawOutput: true`, `redactSecrets: true` (no write to the
   session record — read-only derivation).
5. Resolve `projectRoot` from `registry.getProject(projectId)`
   `.rootPath`.
6. **Gate A — policy:** `evaluatePathRead({ path, project: projectId })`.
   `{ allowed: false, reason }` → `path_denied: <reason>` (reason is
   a `PolicyDenyCode`), exit 1, no read.
7. **Gate B — sandbox:** `resolveSafeReadPath({ path, projectRoot })`.
   Throws `OutputFilterError("path_unsafe", msg)` → `path_unsafe: <msg>`,
   exit 1, no read.
8. `fs.readFile(resolved.absolute, "utf8")`. ENOENT / read error →
   `file_read_failed: <message>`, exit 1.
9. `filterOutput({ raw, intent, mode, maxReturnedBytes, source: { kind: "file", path } })`.
10. If `storeRawOutput`: build a `ChunkSet` (chunkSetId via injected
    id generator; `source: { kind: "file", path }`; `redacted` =
    `result.warnings` contained a redaction notice; chunks derived
    from `result.excerpts` — see §5) and `saveChunkSet`. On success,
    set `result.chunkSetId` on the emitted JSON.
11. Output (§4).

### 3b `apps/cli/src/commands/output/filter.ts`

```ts
export type RunOutputFilterInput = {
  sessionId: string;
  intentFlag: string | undefined;   // --intent (REQUIRED)
  fileFlag: string | undefined;     // --file <log-path> (REQUIRED)
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};
export async function runOutputFilter(input: RunOutputFilterInput): Promise<0 | 1>;
export const outputFilterCommand: CommandDef;
```

Same pipeline as `file` with two differences:

- The path comes from `--file` (a required flag), not a positional.
  Missing `--file` → `file_required` error, exit 1.
- The log file is treated as already-captured tool output. It still
  passes **both** gates (policy `evaluatePathRead` + sandbox
  `resolveSafeReadPath`) — `filter` is the no-spawn variant, not the
  no-safety variant. `source` is `{ kind: "file", path }` (the log is
  a file on disk; there is no separate "log" source kind in
  `OutputSourceKind`).

### 3c `apps/cli/src/commands/output/chunk.ts`

```ts
export type RunOutputChunkInput = {
  chunkSetId: string;               // positional <chunk-set-id>
  chunkId: string;                  // positional <chunk-id>
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};
export async function runOutputChunk(input: RunOutputChunkInput): Promise<0 | 1>;
export const outputChunkCommand: CommandDef;
```

No `--session-id`, no `--intent` (per §5b). Pipeline:

1. Resolve store root.
2. Validate `chunkSetId` and `chunkId` are non-empty, single path
   segments (reuse the `assertSafeSegment` invariant conceptually;
   a malformed id → `invalid_chunk_set_id` / `invalid_chunk_id`,
   exit 1).
3. **Locate** the owning chunk-set by id alone (see §3d). Miss →
   `chunk_set_not_found`, exit 1.
4. `loadChunkSet({ storeRoot, projectId, sessionId, chunkSetId })`
   using the located project/session. `ContentStoreError("not_found")`
   → `chunk_set_not_found`, exit 1. `store_corrupt`/`schema_invalid`
   → `store_corrupt: <message>`, exit 1.
5. Find the chunk with `chunk.id === chunkId` in `chunkSet.chunks`.
   Miss → `chunk_not_found`, exit 1.
6. Output (§4).

### 3d Chunk-set locator (new helper)

`loadChunkSet` requires `projectId` + `sessionId`, but `mega output
chunk` is given **only** `<chunk-set-id>` (§5b: "globally unique;
the content-store enforces ownership via the project/session
embedded path"). The on-disk layout is
`<store>/content/<projectId>/<sessionId>/<chunkSetId>.json` (§10a).

BB7a adds a small CLI-local locator
(`apps/cli/src/commands/output/locate-chunk-set.ts`):

```ts
export type LocatedChunkSet = { projectId: ProjectId; sessionId: SessionId };
export function locateChunkSet(input: {
  storeRoot: string;
  chunkSetId: string;
}): LocatedChunkSet | null;
```

It walks `<store>/content/*/*/` looking for
`<chunkSetId>.json`, returning the first `{ projectId, sessionId }`
match (chunk-set ids are globally unique, so at most one match). It
performs **no** parse beyond the directory-segment extraction —
ownership and schema validation are delegated to `loadChunkSet` in
step 4. A missing `<store>/content` directory → `null` (treated as
`chunk_set_not_found`). This helper lives in `apps/cli` (not
content-store) because it is a CLI-only affordance; promoting it to
content-store as `findChunkSetById` is a follow-up (§9) if a second
consumer appears.

### 3e Command registration

`apps/cli/src/commands/output/index.ts` defines `outputCommand`
with subcommands `file`, `filter`, `chunk` and re-exports the three
`run*` functions + input types (mirror
`apps/cli/src/commands/session/index.ts`). `apps/cli/src/main.ts`
adds `output: outputCommand` to `mainCommand.subCommands`.

## 4. Output shapes (locked, §5b)

### Text mode (default)

- `file` / `filter`:
  `Filtered <path> for sess_<id> (<returnedBytes> B kept, <bytesSaved> B saved, <ratio>%)`
  plus `chunkSetId=<id>` when stored.
- `chunk`:
  `Chunk <chunkId> of <chunkSetId> (lines <startLine>-<endLine>, <bytes> B)`
  followed by the chunk `text`.

### JSON mode (`--json`) — single line, locked

- `file` / `filter` →
  `{ "sessionId": "...", "result": <FilterOutputResult> }`
  (`result.chunkSetId` present iff stored).
- `chunk` →
  `{ "chunkSetId": "...", "chunkId": "...", "chunk": <Chunk> }`.

**`--json` failure invariant (§5a, §5b):** on ANY failure path the
command prints a plain-text `error: …` line to **stderr**, writes
**nothing** to stdout, and exits 1. JSON is never emitted on
failure. `apps/cli/test/json-failure-paths.test.ts` is extended
with one case per error code below.

## 5. ChunkSet construction (file/filter store step)

`filterOutput` is synchronous and does **not** persist; it returns
`FilterOutputResult` with `chunkSetId` left `undefined`
(`packages/output-filter/src/types.ts:73-114`). When
`storeRawOutput` is true, the command constructs the `ChunkSet`:

```ts
const chunkSet: ChunkSet = {
  chunkSetId,                                   // injected id generator
  sessionId, projectId,
  createdAt: now(),                             // injected clock
  source: { kind: "file", path },
  rawBytes: result.rawBytes,
  redacted: (result.warnings ?? []).some((w) => w.startsWith("redacted")),
  chunks: result.excerpts.map((e, i) => ({
    id: String(i),
    startLine: e.startLine,
    endLine: e.endLine,
    bytes: Buffer.byteLength(e.text, "utf8"),
    text: e.text,
  })),
};
await saveChunkSet({ storeRoot, chunkSet });
```

`chunkSetId` and `createdAt` use injected generators on the
`run*` input (added to the input records as optional
`now?: () => string` and `newId?: () => string`, defaulting to
`new Date().toISOString()` / `crypto.randomUUID()` inside the
`defineCommand` wrapper) so tests are deterministic — mirrors the
`now: () => string` injection convention (§4a, token-saver.ts:25-28).

## 6. Error codes (locked)

CLI-boundary messages live in `apps/cli/src/errors.ts` (extend, do
not rewrite). Every message is `exitCode: 1`. New `ZodContext`
members and message builders:

| Error code (text prefix)        | Trigger                                                        | Source |
|---------------------------------|---------------------------------------------------------------|--------|
| `intent_required`               | `--intent` missing/empty on `file`/`filter`                   | CLI boundary |
| `file_required`                 | `--file` missing on `filter`                                  | CLI boundary |
| `session_not_found`             | `getSession` returns null (reuse existing `sessionNotFoundMessage`) | core |
| `path_denied: <PolicyDenyCode>` | `evaluatePathRead` returns `allowed: false`                   | policy |
| `path_unsafe: <message>`        | `resolveSafeReadPath` throws `OutputFilterError("path_unsafe")` | output-filter |
| `file_read_failed: <message>`   | `fs.readFile` throws (ENOENT, EACCES, …)                      | fs |
| `invalid_chunk_set_id`          | empty / non-segment `<chunk-set-id>`                          | CLI boundary |
| `invalid_chunk_id`              | empty `<chunk-id>`                                            | CLI boundary |
| `chunk_set_not_found`           | locator miss OR `loadChunkSet` `not_found`                    | locator / content-store |
| `chunk_not_found`               | `chunkId` absent from located chunk-set                       | CLI boundary |
| `store_corrupt: <message>`      | `loadChunkSet` `store_corrupt`/`schema_invalid`               | content-store |

No new **closed enum** is introduced (these are CLI message
prefixes, not a Zod `z.enum`), so no `*.test-d.ts` tuple pin is
required by §17. `PolicyDenyCode` is consumed, not defined here.

## 7. Validation at boundaries (Zod, §8)

- `sessionId` → `sessionIdSchema.parse` at boundary (mirror
  update.ts:43-49).
- `--store` → existing `resolveStorePath` (whitespace-only rejected).
- `--intent` / `--file` presence checks are plain string guards
  (Citty delivers `string | undefined`); a present-but-empty
  `--intent` is treated as missing.
- `<chunk-set-id>` / `<chunk-id>` → non-empty single-segment guard.
- The file content fed to `filterOutput` is validated inside
  output-filter (`filterOutputInputSchema`); the CLI does not
  re-validate (trust the internal package boundary, §8).

## 8. Risk justification (HIGH)

- Reads arbitrary on-disk paths → two-gate defence (policy denylist
  + sandbox resolver) is the security-critical invariant. Both gates
  MUST run before any `fs.readFile`; a test asserts read is never
  attempted when either gate denies (no fs spy call).
- Writes to the content store (chunk-set persistence) via the atomic
  writer in content-store.
- No child-process spawn, no command evaluation (that is BB7b /
  CRITICAL) — keeping the spawn boundary out of BB7a is what holds
  this PR at HIGH rather than CRITICAL.

Per §12, HIGH requires: full superpowers chain + `architect` design
+ `critic` review + worktree (already isolated). Evidence-preserving
only.

## 9. Open questions / follow-ups

- `locateChunkSet` lives in `apps/cli` for BB7a. If BB7b (`exec`) or
  the MCP `mega_fetch_chunk` tool needs id-only lookup, promote it to
  `content-store` as `findChunkSetById` (a content-store child spec
  owns that move; do not pre-build it now — §13 no premature
  abstraction).
- `filter` reuses `source: { kind: "file" }`. If a future PR wants to
  distinguish piped-log input from real files in stats, a `log`
  member would have to be added to `OutputSourceKind` (BB5 owner) —
  out of scope for BB7a.

## 10. Acceptance criteria

1. `apps/cli/package.json` declares the three new `@megasaver/*`
   deps (`policy`, `output-filter`, `content-store`) as
   `workspace:*`; `pnpm install` re-run; workspace links resolve.
2. `apps/cli/test/dependency-graph.test.ts` green: deps ⊆ §3c
   allow-list, no mcp-bridge/retrieval/stats.
3. `mega output file` enforces the two-gate order; denial on either
   gate prevents the read (asserted) and exits 1 with the locked
   message.
4. `mega output filter` runs an existing log through the pipeline
   (no spawn) and produces the locked JSON/text shape.
5. `mega output chunk` locates a stored chunk-set by id alone and
   returns one chunk; misses produce the locked not-found codes.
6. `--intent` required for `file`/`filter`; absent → `intent_required`.
7. `json-failure-paths.test.ts` extended with the new failure codes;
   every failure path: text stderr, empty stdout, exit 1.
8. No `child_process` import anywhere in the PR (asserted by a grep
   test or absence check).
9. `pnpm verify` (lint + typecheck + test, whole monorepo) green
   with honest captured output.
