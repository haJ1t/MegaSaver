# Context daemon — Phase 5a Plan: registry-keyed daemon routes

**Goal:** Add **registry-keyed** route variants to the daemon that wrap the same
**non-overlay** context-gate orchestrators the `mcp-bridge` `proxy_*` tools call
in-process today, so Phase 5b can wire those tools to forward to the daemon
(no-spawn, in-process fallback). The daemon resolves its **own** warm
`CoreRegistry` from `storeRoot`.

**Spec:** `docs/superpowers/specs/2026-06-25-context-daemon-design.md` §Phasing
item 5a (Option A — registry-keyed routes, decided 2026-06-25).

**Risk:** HIGH (§12) — the daemon gains registry read access + a registry-keyed
`/exec` path that spawns user commands. Full superpowers chain + `architect`
design + `critic` adversarial review + worktree (already on
`worktree-context-daemon-phase5`). No `main` edits.

---

## Why these routes (the blocker, restated)

`mcp-bridge` `proxy_*` tools are **registry-keyed**. Their env is
`{ registry: CoreRegistry, storeRoot, now, newId, originPid }` plus a registry
`sessionId` (branded `SessionId`). They call the **non-overlay** orchestrators:

| Tool (file) | Orchestrator called | Re-exported from |
| --- | --- | --- |
| `proxy_run_command` (`run-command.ts`) | `runOutputExecCommand` | `@megasaver/core` (via `context-gate.js`) |
| `proxy_search_code` (`search-code.ts`) | `runOutputExecCommand` (builds `grep` args, then calls it) | `@megasaver/core` |
| `proxy_read_file` (`read-file.ts`) | `runOutputPipeline` | `@megasaver/core` |
| `proxy_expand_chunk` (`fetch-chunk.ts`) | `fetchChunk` | `@megasaver/core` |
| `mega_recall` (`recall.ts`) | `registry.getSession` + `registry.listMemoryEntries` + `listChunkSets` | `@megasaver/core` / `@megasaver/content-store` |

The daemon's **existing** routes (`/excerpt /expand /exec /search /recall`) are
**overlay-keyed** (`workspaceKey` + `liveSessionId`, calling
`runOverlay*` + `fetchOverlayChunk` + `readOverlayEvents`). They cannot serve the
registry-keyed tools — different key, different chunk store, different stats log.

**Decision (Option A, locked):** add **parallel registry-keyed routes** that
wrap the *same* non-overlay orchestrators, with the daemon owning a warm
`CoreRegistry` built from `storeRoot`. No store migration, no key bridging.

---

## Verified APIs (read from source — exact signatures)

### Orchestrators (re-exported from `@megasaver/core`, also `@megasaver/context-gate`)

`runOutputExecCommand(input: RunOutputExecInput): Promise<RunOutputExecResult>`
— `packages/context-gate/src/run-command.ts:184`
```ts
type RunOutputExecInput = {
  registry: OrchestratorRegistry;   // CoreRegistry structurally satisfies it
  storeRoot: string;
  sessionId: SessionId;             // branded; resolves projectId/projectRoot via resolveEffectiveSettings
  command: string;
  args: readonly string[];
  intent: string;
  originPid: string;
  timeoutMs: number;
  maxBytes: number;                 // raw-capture cap
  spawn?: RunCommandSpawn;
  now?: () => string;
  newId?: () => string;
  loadPermissions?: LoadProjectPermissions;
};
type RunOutputExecResult =
  | { ok: true; result: ExecResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string }
  | { ok: false; reason: "command_denied"; code: PolicyDenyCode }
  | { ok: false; reason: "command_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };
```
`ExecResult = FilterOutputResult & { childExitCode: number | null; terminated?: "timeout" | "max_bytes" }`.
The orchestrator does policy gate (incl. `recursive_megasaver` via `originPid`)
→ spawn → redact (inside `filterOutput`) → save **registry** chunk-set
(`saveChunkSet`, keyed `sessionId+projectId`) → append **registry** stats
(`appendEvent`). Resolves `projectId`/`projectRoot`/`mode`/`maxReturnedBytes`
internally from the session via `resolveEffectiveSettings(registry, sessionId)`.

`runOutputPipeline(input: RunOutputInput): Promise<RunOutputResult>`
— `packages/context-gate/src/run.ts:47`
```ts
type RunOutputInput = {
  registry: OrchestratorRegistry;
  storeRoot: string;
  sessionId: SessionId;
  path: string;
  intent: string;
  now?: () => string;
  newId?: () => string;
  loadPermissions?: LoadProjectPermissions;
};
type RunOutputResult =
  | { ok: true; result: FilterOutputResult }
  | { ok: false; reason: "session_not_found" }
  | { ok: false; reason: "policy_load_failed"; detail: string }
  | { ok: false; reason: "path_denied"; detail: string }
  | { ok: false; reason: "path_unsafe"; detail: string }
  | { ok: false; reason: "file_read_failed"; detail: string }
  | { ok: false; reason: "store_write_failed"; detail: string };
```
Runs `runTwoGates` (path-traversal + permissions gate) before `fs.readFile`.

`fetchChunk(input): Promise<FetchChunkResult>`
— `packages/context-gate/src/fetch-chunk.ts:10`
```ts
fetchChunk({ storeRoot, chunkSetId, chunkId }): Promise<
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string }>
```
No `sessionId`/`registry`. Uses `locateChunkSet` which walks
`<store>/content/<projectId>/<sessionId>/<chunkSetId>.json` and returns the
first match (`packages/context-gate/src/locate-chunk-set.ts`).

### Recall data sources

- `registry.getSession(id: SessionId): Session | null` →
  `Session.projectId` (`packages/core/src/registry.ts:72`).
- `registry.listMemoryEntries(projectId: ProjectId): MemoryEntry[]`
  (`packages/core/src/registry.ts:82`). **Only on the full `CoreRegistry`** —
  NOT on the structural `OrchestratorRegistry` port.
- `listChunkSets({ storeRoot, projectId, sessionId }): Promise<ChunkSetSummary[]>`
  from `@megasaver/content-store`.
- In-process filter (mirror `recall.ts:46`):
  `m.approval === "approved" && (m.sessionId === session.id || m.scope === "project")`.

### Warm registry

`createJsonDirectoryCoreRegistry({ rootDir: storeRoot }): CoreRegistry`
— `@megasaver/core` (via `json-directory-registry.js:134`). **Lazy**: the
factory only resolves store paths at construction; each method reads JSON on
call. Cheap to build once per daemon process. (Daemon runs against an
already-initialized store, so no `initStore` needed here — `mega daemon serve`
is started by a client that already initialized the store via the CLI path.)

### Schemas / validation (all already imported somewhere in-repo)

- `sessionIdSchema` from `@megasaver/shared` (`ids.ts:17`) — lowercase-UUID
  branded; **rejects** any non-UUID (so `..`, absolute paths, separators are
  rejected for free). Use it for `sessionId` on `/exec-registry`,
  `/read-registry`, `/recall-registry`.
- `safeSegmentSchema = z.string().min(1).refine(isSafeKeySegment)` — already
  defined in `packages/daemon/src/handlers.ts:20`; `isSafeKeySegment` from
  `@megasaver/core`. Use it for `chunkSetId`/`chunkId` on `/expand-registry`.
- For `proxy_search_code`: keep the `grep`-build + `path_scope` guard
  **in-process in the tool** (Phase 5b) — the tool already calls
  `assertSafePathScope` + `buildGrepArgs` then `runOutputExecCommand`. So
  `/exec-registry` serves search too: the tool POSTs `command:"grep", args`.
  **No separate `/search-registry` route is needed** (confirmed — search-code
  is just exec with a pre-built grep command + an in-tool BM25 re-rank of the
  result, neither of which needs daemon-side help).

---

## Route design (new file `packages/daemon/src/handlers-registry.ts`)

Mirror the structure of `handlers.ts`. Each handler:
`(registry: CoreRegistry, storeRoot: string, body, deps?) → HandlerResponse`
(reuse the existing `HandlerResponse = { status; json }` type from
`handlers.ts`). zod-validate the body at the boundary; map orchestrator result
unions to HTTP status mirroring the overlay handlers' status conventions.

### `execRegistryHandler` — wraps `runOutputExecCommand` (serves run-command AND search-code)

Request body:
```ts
{ sessionId: sessionIdSchema, command: z.string().min(1),
  args: z.array(z.string()), intent: z.string().min(1),
  maxBytes: z.number().int().positive().optional() }  // .strict()
```
Constants mirror `run-command.ts`: `MAX_BYTES_CEILING = 64_000`,
`SPAWN_TIMEOUT_MS = 5*60*1000`, `MAX_CAPTURE_FACTOR = 64`. Reject
`maxBytes > MAX_BYTES_CEILING` → 400. Call:
```ts
runOutputExecCommand({
  registry, storeRoot, sessionId: parsed.sessionId,
  command, args, intent,
  originPid: String(process.pid),
  timeoutMs: SPAWN_TIMEOUT_MS,
  maxBytes: (maxBytes ?? MAX_BYTES_CEILING) * MAX_CAPTURE_FACTOR,
  ...(deps?.spawn ? { spawn } : {}), ...(deps?.now ? { now } : {}), ...(deps?.newId ? { newId } : {}),
});
```
Status map (mirror overlay `execHandler`):
`command_denied → 400 {error:"command_denied", code}`;
`policy_load_failed → 400 {error, detail}`;
`session_not_found → 404 {error}` (registry path CAN hit this, unlike overlay);
`command_failed → 502 {error, detail}`;
`store_write_failed → 500 {error, detail}`;
ok → `200 { ...result }` (ExecResult: excerpts, chunkSetId, metrics, summary,
childExitCode, terminated?).

> **search-code parity:** the tool builds the grep command in-process
> (`buildGrepArgs`, `assertSafePathScope`) and POSTs `command:"grep", args` to
> `/exec-registry`; it shapes the `ExecResult` (BM25 re-rank) on the response.
> So `/exec-registry` is the single registry exec route.

### `readRegistryHandler` — wraps `runOutputPipeline`

Request body:
```ts
{ sessionId: sessionIdSchema, path: z.string().min(1),
  intent: z.string().min(1),
  maxBytes: z.number().int().positive().optional() }  // .strict()
```
`MAX_BYTES_CEILING` guard as in `read-file.ts` (note: `runOutputPipeline` takes
no `maxBytes` arg — `maxReturnedBytes` is resolved from the session; the ceiling
check is a boundary reject only, matching the tool). Call
`runOutputPipeline({ registry, storeRoot, sessionId, path, intent, ...deps })`.
Status map (mirror `read-file.ts` + overlay conventions):
`session_not_found → 404`; `policy_load_failed → 400 {error, detail}`;
`path_denied → 400 {error:"path_denied", detail}`;
`path_unsafe → 400 {error:"path_unsafe", detail}` (validation_failed-class);
`file_read_failed → 502 {error, detail}`; `store_write_failed → 500`;
ok → `200 { ...result }` (FilterOutputResult).

> `proxy_read_file`'s deferral comment (read-file.ts:44) said "the daemon has no
> /read route". This route IS that route. Phase 5b deletes that comment when it
> wires the tool.

### `expandRegistryHandler` — wraps `fetchChunk`

Request body:
```ts
{ chunkSetId: safeSegmentSchema, chunkId: safeSegmentSchema }  // .strict()
```
No `sessionId`/`registry` needed (`fetchChunk` uses `locateChunkSet`). Call
`fetchChunk({ storeRoot, chunkSetId, chunkId })`. Status map:
`chunk_set_not_found → 404 {error}`; `chunk_not_found → 404 {error}`;
`store_corrupt → 500 {error}`; ok → `200 { chunk }`.

> **Per-session expansion guard stays in-process.** `fetch-chunk.ts:38` enforces
> `allowedChunkSetIds` BEFORE any call — the daemon has no per-response set and
> must NOT be the guard. Phase 5b runs `allowedChunkSetIds` in-tool first, then
> forwards. Documented as a `ponytail:` note on the route.

### `recallRegistryHandler` — wraps registry memory

Request body:
```ts
{ sessionId: sessionIdSchema, intent: z.string().min(1) }  // .strict()
```
Logic (mirror `recall.ts:36-56`):
```ts
const session = registry.getSession(parsed.sessionId);   // sessionId already branded by schema
if (session === null) return { status: 404, json: { error: "session_not_found" } };
const memory = registry.listMemoryEntries(session.projectId)
  .filter(m => m.approval === "approved" && (m.sessionId === session.id || m.scope === "project"));
const chunkSets = await listChunkSets({ storeRoot, projectId: session.projectId, sessionId: session.id });
return { status: 200, json: { memory, chunkSets } };
```
Returns the **registry-backed `{ memory, chunkSets }`** shape — identical to the
tool's `RecallToolResult`, so Phase 5b forwarding does NOT change the contract
(unlike the overlay `/recall` which returns `{ records }`).

---

## Server wiring (`packages/daemon/src/server.ts`)

1. Build the warm registry once at startup (after `storeRoot` is known):
   ```ts
   const registry = createJsonDirectoryCoreRegistry({ rootDir: opts.storeRoot });
   ```
   `// ponytail: one warm registry per daemon process; factory is lazy (reads JSON per call), so this is cheap.`
2. Add the four new paths to the POST allow-list condition:
   `/exec-registry /read-registry /expand-registry /recall-registry`
   (behind the **same** `Bearer ${token}` auth + loopback bind — no new auth).
3. Dispatch (after the existing overlay branches):
   ```ts
   else if (path === "/exec-registry")    result = await execRegistryHandler(registry, opts.storeRoot, body, hasDeps ? deps : undefined);
   else if (path === "/read-registry")    result = await readRegistryHandler(registry, opts.storeRoot, body, hasDeps ? deps : undefined);
   else if (path === "/expand-registry")  result = await expandRegistryHandler(opts.storeRoot, body);
   else /* /recall-registry */            result = await recallRegistryHandler(registry, opts.storeRoot, body);
   ```
4. **Do NOT call `recordSession(body)` for registry routes** — `recordSession`
   keys off `workspaceKey`+`liveSessionId`, which these bodies don't carry. It
   already no-ops when those fields are absent, so it's harmless, but gate it to
   the overlay paths for clarity (the registry routes have no `/status` session
   surface in this phase).
5. Export the new handlers from `packages/daemon/src/index.ts` (public surface,
   consistent with existing handler exports) so tests and Phase 5b can import.

---

## Ordered TDD steps (red → green per step)

Tests live in `packages/daemon/test/handlers-registry.test.ts` (handler-level,
inject `spawn`/`now`/`newId`, real temp `storeRoot` seeded with
`createJsonDirectoryCoreRegistry` + a project/session) and
`packages/daemon/test/server-registry.test.ts` (HTTP round-trip through
`startDaemonServer`, mirroring `server.test.ts`).

1. **expandRegistryHandler** (simplest — no registry, no spawn).
   - RED: test that a seeded registry chunk-set
     (`runOutputExecCommand` with injected `spawn` to mint one, OR write a
     chunk-set fixture) is fetchable by `{chunkSetId, chunkId}`; bad chunkSetId →
     404; `chunkId` not found → 404; `chunkSetId:"../escape"` → 400 (schema).
   - GREEN: implement `expandRegistryHandler`.
2. **recallRegistryHandler.**
   - RED: seed a project+session+approved memory entry via the registry; assert
     `{memory, chunkSets}` returned; unknown sessionId → 404; non-UUID
     sessionId → 400 (schema); pending/rejected memory filtered out;
     other-session non-project memory filtered out.
   - GREEN: implement.
3. **execRegistryHandler** (inject `spawn` — never spawn a real process, §12).
   - RED: seed a session; inject a fake `spawn` emitting stdout; assert
     `200 {excerpts, chunkSetId, metrics...}` + a **registry** chunk-set written
     under `content/<projectId>/<sessionId>/`; `maxBytes > 64_000` → 400;
     unknown sessionId → 404; a denied command (e.g. one not in the policy
     allow-list) → 400 `command_denied` with `code` and **spawn not called**;
     non-UUID sessionId → 400 (schema).
   - GREEN: implement, threading `originPid: String(process.pid)`.
4. **readRegistryHandler.**
   - RED: seed a session whose project root contains a temp file; assert
     `200 {excerpts, chunkSetId...}`; `path` outside root / `..` → 400
     `path_unsafe`; unknown sessionId → 404; missing file → 502
     `file_read_failed`.
   - GREEN: implement.
5. **server wiring (`server-registry.test.ts`).**
   - RED: start a daemon with an injected `spawn`; POST `/exec-registry` with the
     `Bearer` token → 200; POST without/with-wrong token → 401 (existing auth);
     POST `/expand-registry`, `/read-registry`, `/recall-registry` round-trip;
     unknown path still → 404.
   - GREEN: wire routes + warm registry + index exports.
6. **search-code parity smoke (server-registry.test.ts).**
   - RED: POST `/exec-registry` with `command:"grep", args:[...]` (injected
     spawn returns grep-shaped lines) → 200 with `excerpts` the tool can shape.
     Confirms no separate search route is needed.
   - GREEN: already covered by step 3+5; this is an assertion, not new code.

---

## Tests (summary)

- `handlers-registry.test.ts`: per-handler unit tests (validation rejects,
  result-union → status map, registry chunk-set/stats written, spawn-never-called
  on denial, path-traversal rejects for sessionId/chunkSetId/path).
- `server-registry.test.ts`: HTTP round-trip for all four routes, token auth
  (401), unknown path (404), search-via-exec parity.
- All injected `spawn`/`now`/`newId` — no real process, deterministic ids/time.
- `pnpm build` first if `@megasaver/*` dist is stale, then
  `pnpm --filter @megasaver/daemon test` + `pnpm verify`.

---

## Risks

1. **HIGH — registry write surface on the daemon.** `runOutputExecCommand` /
   `runOutputPipeline` already `saveChunkSet` + `appendEvent` into the registry
   store; the daemon now does the same out-of-process. These are the **same**
   append-/write orchestrators the CLI and mcp-bridge run today, so no new
   corruption vector — but the daemon process now holds the registry. Mitigation:
   the factory's `withDirLock` already serializes writes across processes; the
   daemon reuses it.
2. **Path traversal.** `sessionId` (request-controlled) → `sessionIdSchema`
   rejects non-UUID, so it can never be `..`/absolute/separator. `chunkSetId`/
   `chunkId` → `safeSegmentSchema` (`isSafeKeySegment`). `path` on
   `/read-registry` → `runTwoGates` inside `runOutputPipeline` enforces the
   project-root containment gate (same gate the tool relies on). `command/args`
   on `/exec-registry` → the policy allow-list + `recursive_megasaver` gate
   inside `runOutputExecCommand`.
3. **Per-response expansion guard moves off the hot path is NOT allowed.**
   `/expand-registry` has no `allowedChunkSetIds` set. Phase 5b MUST run that
   guard in-tool **before** forwarding (documented on the route). A daemon that
   expanded any chunk-set for any caller would leak across sessions — so this is
   a `ponytail:` invariant comment, not a TODO.
4. **`projectId` collisions in `locateChunkSet`.** It returns the first match by
   scanning dirs; chunk-set ids are globally unique (§3d) so this is safe — same
   assumption the in-process `fetchChunk` already makes. No new risk.
5. **Warm-registry staleness.** The lazy factory reads JSON per call, so a
   session created after daemon start IS visible (no cache). No staleness risk;
   the only cost is re-reading `sessions.json`/`projects.json` per request —
   identical to the in-process path today.
6. **Scope creep guard.** This phase adds routes ONLY. It does NOT touch
   `mcp-bridge` (that's 5b) and does NOT remove the overlay routes. The
   `proxy_*` tool deferral comments stay until 5b wires them.

---

## Out of scope (5b and later)

- Reintroducing `forward.ts` / `forwardOrFallback` in `mcp-bridge` and wiring
  `proxy_*` tools to POST to these routes via `getRunningDaemon` (no-spawn,
  Option A) with in-process fallback.
- Deleting the per-tool deferral `ponytail:` comments.
- Any `/status` surfacing of registry-keyed sessions.
