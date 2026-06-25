# Context daemon — Phase 5b Plan: mcp-bridge forward-or-fallback

**Goal:** Refactor the five `mcp-bridge` `proxy_*` tools to **forward** to the
daemon's registry-keyed routes (added in Phase 5a) via the **no-spawn** client
(`getRunningDaemon`), **falling back** to the existing in-process call on any
error (no daemon, non-2xx, throw, timeout). All ~1800 mcp-bridge tests stay
green — the in-process fallback is the unchanged code those tests already
exercise (no daemon runs in the test env, so `getRunningDaemon` returns `null`
and the in-process path runs verbatim).

**Spec:** `docs/superpowers/specs/2026-06-25-context-daemon-design.md` §Phasing
item 5 (Option A — no-spawn forward + in-process fallback, locked 2026-06-25 in
the Phase 5 plan).

**Risk:** HIGH (§12) — production MCP package, the hot agent↔tool path. Full
superpowers chain + `code-reviewer` AND `critic` (separate passes) + worktree
(already on `worktree-context-daemon-phase5`). No `main` edits.

---

## What Phase 5a already landed (verified, do not redo)

- `packages/daemon/src/handlers-registry.ts` — four handlers, each builds its
  **own** warm `CoreRegistry` from `storeRoot` via
  `createJsonDirectoryCoreRegistry({ rootDir: storeRoot })` (per-call; the
  factory is lazy). Signatures:
  - `execRegistryHandler(storeRoot, body, deps?) → HandlerResponse` — wraps
    `runOutputExecCommand`; serves run-command AND search-code (grep args).
    On ok returns `{ status: 200, json: { ...ExecResult } }`.
  - `readRegistryHandler(storeRoot, body, deps?) → HandlerResponse` — wraps
    `runOutputPipeline`. On ok returns `{ status: 200, json: { ...FilterOutputResult } }`.
  - `expandRegistryHandler(storeRoot, body) → HandlerResponse` — wraps
    `fetchChunk`. On ok returns `{ status: 200, json: { chunk } }`.
  - `recallRegistryHandler(storeRoot, body) → HandlerResponse` — registry
    memory + `listChunkSets`. On ok returns `{ status: 200, json: { memory, chunkSets } }`.
- `packages/daemon/src/server.ts` — POST routes `/exec-registry`,
  `/read-registry`, `/expand-registry`, `/recall-registry` are wired behind the
  same `Bearer ${token}` auth + `127.0.0.1` bind; `recordSession` is correctly
  skipped for registry paths.
- `packages/daemon/src/index.ts` — exports all four registry handlers,
  `getRunningDaemon`, `getDaemon`, `DaemonHandle`.
- `packages/daemon/src/client.ts` — `getRunningDaemon({ storeRoot }) →
  Promise<DaemonHandle | null>`: reads discovery, pings `/status` (1.5s
  timeout), returns a handle or `null`. **Never spawns, never waits the ~5s
  spawn.** `DaemonHandle.request(method, path, body?, signal?) → Promise<Response>`
  sets the `Bearer` header and JSON content-type.
- `@megasaver/daemon` `dist/` is built and exports the above.

**The daemon response shapes already match each tool's return shape** — Phase 5a
was built for exactly this. No daemon-side change is needed in 5b.

---

## Response-shape parity (verified against source)

| Tool in-process return | Daemon route | Daemon `json` on 200 | Parity |
| --- | --- | --- | --- |
| `handleRunCommand → ExecResult` | `/exec-registry` | `{ ...ExecResult }` | **exact** — return body as-is |
| `handleReadFile → FilterOutputResult` | `/read-registry` | `{ ...FilterOutputResult }` | **exact** — return body as-is |
| `handleFetchChunk → { chunkSetId, chunkId, chunk }` | `/expand-registry` | `{ chunk }` | **re-wrap** — tool adds `chunkSetId`+`chunkId` (it has them from args) |
| `handleRecall → { memory, chunkSets }` | `/recall-registry` | `{ memory, chunkSets }` | **exact** — return body as-is |
| `handleSearchCode → SearchCodeResult` | `/exec-registry` (grep) | `{ ...ExecResult }` | **post-map** — tool runs `shapeResult(query, execResult)` on the body |

`ExecResult` / `FilterOutputResult` are plain JSON-serializable objects
(`excerpts: OutputExcerpt[]`, numbers, optional `chunkSetId: string`,
`summary: string`). `readonly` arrays serialize to plain arrays and the tool
return types accept them — JSON round-trip is lossless. `MemoryEntry[]` /
`ChunkSetSummary[]` are likewise plain objects.

---

## Design decision: helper shape + where forwarding lives

### `forwardOrFallback` (new file `packages/mcp-bridge/src/tools/forward.ts`)

```ts
import { getRunningDaemon } from "@megasaver/daemon";

// ponytail: no-spawn path. getRunningDaemon never spawns (≤1.5s ping), so a
// down daemon falls back in-process instantly — correct default on the hot
// MCP tool path (Phase 5 plan Option A).
export async function forwardOrFallback<T>(
  storeRoot: string,
  routePath: string,        // "/exec-registry" | "/read-registry" | ...
  body: unknown,
  inProcess: () => Promise<T>,
  mapResponse: (json: unknown) => T = (j) => j as T,
): Promise<T> {
  let handle: DaemonHandle | null;
  try {
    handle = await getRunningDaemon({ storeRoot });
  } catch {
    return inProcess();          // discovery/ping threw → fallback
  }
  if (handle === null) return inProcess();   // no daemon → fallback

  try {
    const res = await handle.request("POST", routePath, body);
    if (!res.ok) return inProcess();         // non-2xx (incl. 4xx denies) → fallback
    return mapResponse(await res.json());
  } catch {
    return inProcess();          // network/timeout/JSON-parse throw → fallback
  }
}
```

**Why fall back on non-2xx (not re-map the daemon error):** the in-process path
is the authoritative error source. A `command_denied`/`session_not_found` from
the daemon means "the daemon couldn't serve this" — re-running in-process
produces the **same** `McpBridgeError` the existing tests assert (e.g.
`run-command.test.ts` expects `command_denied` with `details.reason`). This
avoids translating daemon error JSON back into `McpBridgeError` codes and
guarantees the error contract is unchanged. It does mean a genuinely-denied
command is evaluated twice (once daemon-side, once in-process) — acceptable: a
denied command never spawns (the policy gate shuts before IO), so the cost is a
second cheap policy evaluation, not a second process. Documented with a
`ponytail:` note on the helper.

> ponytail: skipped — a dedicated error-mapping layer that translates daemon
> JSON `{error, code}` back to McpBridgeError. Falling back in-process re-derives
> the authoritative error for free. Add only if double policy-eval ever shows up
> as a hot-path cost (it won't — denials don't spawn).

### Where it's called: inside each `handle*` tool function

Each tool keeps its current `(env, rawArgs)` signature and its boundary
validation/intent checks (those must run **before** any forward so a malformed
arg or empty intent throws the same `McpBridgeError` regardless of daemon
state). The existing in-process orchestrator call becomes the `inProcess`
closure. `server.ts` dispatch is **unchanged** — no env-shape change, since
`storeRoot` is already in every target tool's env.

This keeps the diff confined to the five tool files + one new helper + one new
test file + `package.json`.

---

## Per-tool wiring (exact, verified line refs)

### 1. `run-command.ts` — `handleRunCommand → /exec-registry`

- Keep schema parse + `intent_required` + `maxBytes > MAX_BYTES_CEILING` guards.
- Replace the `runOutputExecCommand({...})` block (lines 61–99) with:
  ```ts
  return forwardOrFallback(
    env.storeRoot,
    "/exec-registry",
    { sessionId, command, args, intent, ...(maxBytes !== undefined ? { maxBytes } : {}) },
    () => runInProcess(),   // the existing call + outcome-switch, extracted
  );
  ```
  where `runInProcess` is the current body (the `runOutputExecCommand` call and
  the `outcome.ok ? result : switch-throw`). Default `mapResponse` (identity)
  returns the daemon's `ExecResult` JSON directly.
- **Remove** the `ponytail:` deferral comment (lines 49–60).
- Daemon body fields match the route schema exactly (`sessionId`, `command`,
  `args`, `intent`, optional `maxBytes`). `originPid`/`timeoutMs`/capture-factor
  are daemon-internal (route sets `originPid: String(process.pid)` itself).

### 2. `search-code.ts` — `handleSearchCode → /exec-registry` (grep)

- Keep schema parse + empty-query + `max_tokens` guard + `assertSafePathScope`
  + `buildGrepArgs` (the grep command and path-scope guard stay **in-tool** —
  the daemon only execs what it's told).
- Replace the `runOutputExecCommand({...})` block (lines 196–231) so the
  orchestrator call becomes the `inProcess` closure returning a
  `SearchCodeResult` (current `shapeResult(query, outcome.result)`), and the
  forward maps the daemon `ExecResult` through the **same** `shapeResult`:
  ```ts
  const intent = task !== undefined && task.trim() !== "" ? task : query;
  return forwardOrFallback<SearchCodeResult>(
    env.storeRoot,
    "/exec-registry",
    { sessionId, command: "grep", args: grepArgs, intent,
      ...(max_tokens !== undefined ? { maxBytes: max_tokens } : {}) },
    () => searchInProcess(),                 // existing orchestrator + shapeResult
    (json) => shapeResult(query, json as ExecResult),
  );
  ```
- **Remove** the `ponytail:` deferral comment (lines 187–195). The output
  contract is preserved because BM25 re-rank (`shapeResult`) runs on the daemon
  result the same as on the in-process result.

### 3. `read-file.ts` — `handleReadFile → /read-registry`

- Keep schema parse + `intent_required` + `maxBytes` guard.
- Replace the `runOutputPipeline({...})` block (lines 49–83) with:
  ```ts
  return forwardOrFallback<FilterOutputResult>(
    env.storeRoot,
    "/read-registry",
    { sessionId, path, intent },             // route schema: no maxBytes field
    () => readInProcess(),                    // existing pipeline + outcome-switch
  );
  ```
  Note: the route's `readRegistryRequestSchema` is `{ sessionId, path, intent }`
  `.strict()` — it does **not** accept `maxBytes` (matches `runOutputPipeline`,
  which resolves `maxReturnedBytes` from the session). The tool's `maxBytes`
  ceiling check stays as a boundary reject; do **not** send `maxBytes` in the
  body (`.strict()` would 400 → needless fallback). Default identity map.
- **Remove** the `ponytail:` deferral comment (lines 44–48). This route IS the
  `/read` route that comment said was missing.

### 4. `fetch-chunk.ts` — `handleFetchChunk → /expand-registry`

- Keep schema parse AND the `allowedChunkSetIds` guard (lines 38–43) — this
  guard MUST run in-tool **before** any forward. The daemon `/expand-registry`
  has **no** per-response guard (documented `ponytail:` invariant on that route);
  forwarding an un-guarded id would leak across sessions.
- Replace the `fetchChunk({...})` block (lines 51–63) with:
  ```ts
  return forwardOrFallback<FetchChunkToolResult>(
    env.storeRoot,
    "/expand-registry",
    { chunkSetId, chunkId },
    () => fetchInProcess(),                   // existing fetchChunk + miss-throw
    (json) => ({ chunkSetId, chunkId, chunk: (json as { chunk: Chunk }).chunk }),
  );
  ```
  Re-wrap: the daemon returns `{ chunk }`; the tool re-attaches `chunkSetId` +
  `chunkId` (already in scope from args) to keep `FetchChunkToolResult`.
- **Remove** the `ponytail:` deferral comment (lines 45–50). Keep the guard +
  add a one-line `ponytail:` note that the guard runs before forward (invariant).

### 5. `recall.ts` — `handleRecall → /recall-registry`

- Keep schema parse + `intent_required`.
- Replace the registry-read block (lines 36–56) with:
  ```ts
  return forwardOrFallback<RecallToolResult>(
    env.storeRoot,
    "/recall-registry",
    { sessionId, intent },
    () => recallInProcess(),                  // existing getSession + filter + listChunkSets
  );
  ```
  Default identity map — daemon `{ memory, chunkSets }` == `RecallToolResult`.
- **Remove** the `ponytail:` deferral comment (lines 41–45). The route returns
  the registry-backed shape, not the overlay `{records}` shape, so the contract
  is preserved.

---

## package.json + cycle check

- Add `"@megasaver/daemon": "workspace:*"` to `packages/mcp-bridge/package.json`
  `dependencies`. Run `pnpm install` to update the lockfile.
- **No cycle:** `@megasaver/daemon` does NOT depend on `@megasaver/mcp-bridge`
  (verified — daemon deps are content-store, context-gate, core, output-filter,
  retrieval, shared, stats, evidence-ledger). The `context-gate`
  `dependency-direction.test.ts` forbids context-gate→mcp-bridge; it does not
  constrain mcp-bridge→daemon.
- **No dependency-graph/depcheck test in `packages/mcp-bridge/test`** (verified:
  none exists; the grep hits were `run-command.test.ts` / `fetch-chunk-guard`
  matching the word "allow-list" in prose, not a graph test). No allow-list to
  update. `mcp-bridge/tsconfig.json` has `composite: false` and no project
  references, so the dep is a `package.json`-only change for the build graph.

---

## Why all ~1800 existing tests stay green (the core invariant)

Every existing tool test (`run-command.test.ts`, `fetch-chunk.test.ts`,
`recall.test.ts`, `search-code.test.ts`, `read-file.test.ts`,
`run-command.recursive.test.ts`, the e2e suites) constructs a temp `storeRoot`
with **no `daemon.json`** and no running daemon. `getRunningDaemon({storeRoot})`
reads discovery → `null` → `forwardOrFallback` runs `inProcess()` → the
**identical** orchestrator call + error mapping as today. Throws, return values,
and `McpBridgeError` codes are unchanged.

Even the hypothetical "a daemon IS running against this temp store" case is
safe: those tests seed an **in-memory** registry, so a JSON-directory-backed
daemon wouldn't find the session → 404 → non-2xx → fallback in-process (which
has the in-memory registry) → correct result. The fallback is robust to
store-backing mismatch.

---

## Ordered TDD steps (red → green per step)

Build first if `@megasaver/daemon` dist is stale: `pnpm build`.

### Step 0 — package.json dep + new test file scaffold
- Add `@megasaver/daemon` dep; `pnpm install`. (No test; enables the import.)

### Step 1 — `forward.ts` helper (new `packages/mcp-bridge/test/tools/forward.test.ts`)
- RED:
  1. `getRunningDaemon` returns `null` (inject via a real temp store with no
     daemon, OR `vi.mock("@megasaver/daemon")`) → `inProcess` called, its value
     returned, daemon never requested.
  2. Handle present, `request` resolves `{ ok: true, json: () => payload }` →
     returns `mapResponse(payload)`; `inProcess` NOT called.
  3. Handle present, `request` resolves `{ ok: false, status: 400 }` →
     `inProcess` called (fallback), its value returned.
  4. Handle present, `request` rejects (network/timeout) → `inProcess` called.
  5. `getRunningDaemon` itself throws → `inProcess` called.
  6. `mapResponse` default is identity (returns the JSON unchanged).
- GREEN: implement `forward.ts` as above.
- Use `vi.mock("@megasaver/daemon", ...)` to inject a fake `getRunningDaemon`
  returning a fake `DaemonHandle` whose `request` is a `vi.fn()` — no real
  socket, deterministic.

### Step 2 — wire `recall.ts` (simplest contract, exact shape)
- RED (extend `recall.test.ts`): with a mocked daemon handle returning
  `{ memory:[...], chunkSets:[...] }` on `/recall-registry`, `handleRecall`
  returns that body and does NOT call the registry; on `handle === null`, the
  existing in-process assertions still pass (already covered).
- GREEN: wire `forwardOrFallback`, remove deferral comment.
- Regression: the four existing `recall.test.ts` cases must still pass (they run
  the null-daemon fallback path).

### Step 3 — wire `fetch-chunk.ts` (guard-before-forward is load-bearing)
- RED (extend `fetch-chunk.test.ts`):
  - guard still fires **before** forward: `expansion_blocked` is thrown even
    when a daemon handle is present (mock handle whose `request` would 200 — it
    must NOT be reached).
  - daemon 200 `{ chunk }` → result re-wrapped to
    `{ chunkSetId, chunkId, chunk }`.
  - daemon non-2xx → in-process fallback (seed a real chunk-set, assert hit).
- GREEN: wire forward after the guard; remove deferral comment, add the
  guard-before-forward `ponytail:` invariant note.
- Regression: all 8 existing `fetch-chunk.test.ts` cases + the guard e2e suites
  (`fetch-chunk-guard.*.test.ts`) stay green (null-daemon fallback).

### Step 4 — wire `read-file.ts`
- RED (extend `read-file.test.ts`): mocked daemon 200 `{ ...FilterOutputResult }`
  → returned as-is; body sent is `{ sessionId, path, intent }` (no `maxBytes`);
  non-2xx → in-process fallback.
- GREEN: wire forward; remove deferral comment.

### Step 5 — wire `run-command.ts`
- RED (extend `run-command.test.ts`): mocked daemon 200 `{ ...ExecResult }`
  → returned as-is; denied command with daemon present → daemon 400 →
  **fallback** → in-process throws `command_denied` (unchanged assertion).
- GREEN: extract `runInProcess`, wire forward; remove deferral comment.
- Regression: `run-command.recursive.test.ts` (`recursive_megasaver` via foreign
  `originPid`) stays green — no daemon in that test → in-process path.

### Step 6 — wire `search-code.ts`
- RED (extend `search-code.test.ts`): mocked daemon 200 `{ ...ExecResult }` for
  `/exec-registry` with `command:"grep"` → tool runs `shapeResult` on it →
  `SearchCodeResult` with grouped files + `index_enrichment`; non-2xx →
  in-process fallback (existing real-temp-dir assertions).
- GREEN: extract `searchInProcess`, wire forward with `mapResponse =
  (j) => shapeResult(query, j as ExecResult)`; remove deferral comment.

### Step 7 — full suite + verify
- `pnpm --filter @megasaver/mcp-bridge test` (all ~1800 green).
- `pnpm verify` (biome + tsc -b + vitest across the workspace).
- Smoke evidence (DoD §5, connector path): start a real daemon
  (`startDaemonServer` against a JSON-directory store seeded with a
  project/session), point a `handleRunCommand` call at that `storeRoot` with the
  daemon up, assert the result came from the daemon (e.g. the daemon wrote the
  chunk-set / a spy on `runOutputExecCommand` in-process was NOT called). One
  integration test in `packages/mcp-bridge/test/tools/forward.e2e.test.ts`.

---

## Tests (summary)

- **New** `packages/mcp-bridge/test/tools/forward.test.ts` — the 6 helper cases
  (null daemon, 2xx, non-2xx, request-throw, getRunningDaemon-throw, identity
  map). `vi.mock("@megasaver/daemon")` for the handle.
- **New** `packages/mcp-bridge/test/tools/forward.e2e.test.ts` — one real-daemon
  round-trip proving forwarding actually hits the daemon (DoD smoke evidence).
- **Extended** `run-command.test.ts`, `search-code.test.ts`, `read-file.test.ts`,
  `fetch-chunk.test.ts`, `recall.test.ts` — one daemon-present forward case +
  one daemon-non-2xx fallback case each; existing cases unchanged.
- **Unchanged & must stay green:** all other mcp-bridge tests
  (`run-command.recursive`, `fetch-chunk-guard.*`, `server.e2e`, `bridge`,
  naming, memory/rules/task tools, etc.) — they run the null-daemon fallback.

---

## Risks

1. **HIGH — silent contract drift via forwarding.** If a daemon route's JSON
   ever diverged from the tool's return type, agents would get a different shape
   only when a daemon is up. Mitigation: Phase 5a built the routes to return the
   exact shapes (verified in the parity table); the forward e2e test asserts the
   daemon-path result equals the in-process-path result for the same input.
2. **Double policy evaluation on denial** (run-command/search-code): a denied
   command is evaluated daemon-side (400) then again in-process (throw). No
   second spawn (gate shuts before IO). Acceptable; documented `ponytail:`.
3. **`allowedChunkSetIds` guard must precede the forward** (fetch-chunk). The
   daemon `/expand-registry` has no per-session guard. If the guard ran after
   forward, a daemon could expand any chunk-set for any caller. Mitigation: Step
   3 RED test asserts `expansion_blocked` fires with a daemon handle present and
   the handle's `request` is never called. This is the single highest-leverage
   security assertion in the phase.
4. **`.strict()` body schema rejects extra fields.** Sending `maxBytes` to
   `/read-registry` (whose schema omits it) would 400 → needless fallback every
   call. Mitigation: read-file omits `maxBytes` from the body (verified against
   `readRegistryRequestSchema`). exec/search/recall/expand bodies are built to
   match their `.strict()` schemas field-for-field.
5. **Stale daemon dist.** mcp-bridge imports `@megasaver/daemon` from `dist`.
   Mitigation: `pnpm build` before tsc/test if dist is stale (already the repo
   convention); daemon dist is currently built and exports `getRunningDaemon`.
6. **Spawn latency regression.** Using `getDaemon` (spawns, ≤5s) instead of
   `getRunningDaemon` would stall the hot path. Mitigation: the helper imports
   ONLY `getRunningDaemon`; a grep in review confirms `getDaemon` is not used in
   mcp-bridge.
7. **Scope creep.** 5b touches ONLY the five tool files + `forward.ts` +
   `package.json` + tests. It does NOT change `server.ts` dispatch, the tool env
   shapes, or any daemon-side code.

---

## Out of scope (later)

- Caching the `DaemonHandle` across tool calls (each call re-pings). The ping is
  loopback + 1.5s-bounded; cache only if profiling shows it matters.
  `ponytail:` candidate, not done now.
- Hook path forwarding (already shipped in Phase 6).
- `/status` surfacing of registry-keyed sessions.
- Removing the overlay routes or the llm-proxy.
