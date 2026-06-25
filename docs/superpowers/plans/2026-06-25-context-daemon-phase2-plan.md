# Context daemon — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the daemon its two engine routes — `POST /excerpt` (compress + store an already-captured tool output, return the excerpt) and `POST /expand` (recover a stored raw chunk) — by wrapping the existing `@megasaver/context-gate` orchestrators. No new compression/storage logic.

**Architecture:** `/excerpt` is a thin HTTP wrapper over `context-gate`'s `recordAndFilterOverlayOutput` (which already runs `output-filter` → redact → store an overlay chunk set → append stats). `/expand` wraps a new `fetchOverlayChunk` (overlay twin of the existing `fetchChunk`, since overlay chunk sets are keyed by `workspaceKey`/`liveSessionId` and the non-overlay `fetchChunk`/`loadChunkSet` would fail to parse them). Both routes reuse the Phase 1 server's loopback bind + Bearer-token auth.

**Tech Stack:** Node 22, TypeScript strict ESM, `node:http`, zod, Vitest. Wraps `@megasaver/context-gate`, `@megasaver/content-store`, `@megasaver/output-filter`, `@megasaver/shared`.

**Scope:** Phase 2 of 7 (spec: `docs/superpowers/specs/2026-06-25-context-daemon-design.md`). Builds on Phase 1 (the `@megasaver/daemon` package on this branch). `/exec`, session memory + `/recall`, the mcp-bridge/hook refactors, and the GUI are later phases.

**Key alignment vs spec:** the spec's `/excerpt` contract said `{sessionId, projectId}`; the live token-saver infra (hook + GUI) is keyed by `{workspaceKey, liveSessionId}` (the content-store *overlay* variant). Phase 2 uses the overlay keys to match that infra — `recordAndFilterOverlayOutput` is the overlay orchestrator.

**Risk:** HIGH (touches the compression/store hot path + persisted user output). Worktree only.

---

## Existing APIs this phase wraps (verified in repo)

- `recordAndFilterOverlayOutput(input): Promise<RecordOverlayOutputResult>` — `@megasaver/context-gate`.
  - Input: `{ storeRoot, evidenceStoreRoot?, workspaceKey, liveSessionId, raw, sourceKind, label, mode, storeRawOutput, now?, newId? }`.
  - `sourceKind: OutputSourceKind` = `"file" | "command" | "grep" | "fetch"` (`outputSourceKindSchema`, `@megasaver/output-filter`).
  - `mode: TokenSaverMode` = `"aggressive" | "balanced" | "safe"` (`tokenSaverModeSchema`, `@megasaver/shared`).
  - Result: `{ decision, summary, returnedText, rawBytes, returnedBytes, bytesSaved, savingRatio, chunkSetId? }`. When `decision !== "compressed"` it short-circuits (no store, no `chunkSetId`).
- `loadOverlayChunkSet(input): Promise<OverlayChunkSet>` — `@megasaver/content-store`. Input `{ storeRoot, workspaceKey, liveSessionId, chunkSetId }`; throws `ContentStoreError` (`code: "not_found" | "store_corrupt"`).
- `fetchChunk` / `FetchChunkResult` — `@megasaver/context-gate` (the **non-overlay** template we mirror). Result union: `{ ok: true, chunk } | { ok: false, reason: "chunk_set_not_found" | "chunk_not_found" | "store_corrupt"; detail? }`.
- `Chunk` type — `@megasaver/content-store`.

---

## File structure

```
packages/context-gate/src/fetch-overlay-chunk.ts   # NEW — fetchOverlayChunk
packages/context-gate/src/index.ts                  # export it           (modify)
packages/context-gate/test/fetch-overlay-chunk.test.ts  # NEW

packages/daemon/package.json                        # +4 @megasaver deps  (modify)
packages/daemon/src/body.ts                         # NEW — readJsonBody (size-capped)
packages/daemon/src/handlers.ts                     # NEW — excerptHandler + expandHandler
packages/daemon/src/server.ts                       # wire 2 routes       (modify)
packages/daemon/src/index.ts                        # export handler types (modify)
packages/daemon/test/body.test.ts                   # NEW
packages/daemon/test/handlers.test.ts               # NEW
packages/daemon/test/server.test.ts                 # +excerpt/expand HTTP round-trip (modify)
```

---

## Task 1: `fetchOverlayChunk` in context-gate

**Files:**
- Create: `packages/context-gate/src/fetch-overlay-chunk.ts`
- Modify: `packages/context-gate/src/index.ts`
- Test: `packages/context-gate/test/fetch-overlay-chunk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OverlayChunkSet, saveOverlayChunkSet } from "@megasaver/content-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchOverlayChunk } from "../src/fetch-overlay-chunk.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "ctxgate-ovl-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const sample: OverlayChunkSet = {
  chunkSetId: "cs1",
  workspaceKey: "ws",
  liveSessionId: "live1",
  createdAt: "2026-06-25T00:00:00.000Z",
  source: { kind: "command", command: "ls", args: [] },
  rawBytes: 5,
  redacted: false,
  chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 5, text: "hello" }],
};

describe("fetchOverlayChunk", () => {
  it("returns the stored chunk", async () => {
    await saveOverlayChunkSet({ storeRoot: store, chunkSet: sample });
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "cs1",
      chunkId: "0",
    });
    expect(res).toEqual({ ok: true, chunk: sample.chunks[0] });
  });

  it("reports a missing chunk set", async () => {
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "nope",
      chunkId: "0",
    });
    expect(res).toEqual({ ok: false, reason: "chunk_set_not_found" });
  });

  it("reports a missing chunk id within an existing set", async () => {
    await saveOverlayChunkSet({ storeRoot: store, chunkSet: sample });
    const res = await fetchOverlayChunk({
      storeRoot: store,
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "cs1",
      chunkId: "99",
    });
    expect(res).toEqual({ ok: false, reason: "chunk_not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/fetch-overlay-chunk.test.ts`
Expected: FAIL — cannot find module `../src/fetch-overlay-chunk.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/context-gate/src/fetch-overlay-chunk.ts`:
```ts
import { type Chunk, ContentStoreError, loadOverlayChunkSet } from "@megasaver/content-store";

export type FetchOverlayChunkResult =
  | { ok: true; chunk: Chunk }
  | { ok: false; reason: "chunk_set_not_found" }
  | { ok: false; reason: "chunk_not_found" }
  | { ok: false; reason: "store_corrupt"; detail: string };

// Overlay twin of fetchChunk: overlay chunk sets are keyed by
// (workspaceKey, liveSessionId) and use a different schema, so the non-overlay
// locate+loadChunkSet path would mis-parse them. The caller already knows the
// live keys, so no locate scan is needed — load directly.
export async function fetchOverlayChunk(input: {
  storeRoot: string;
  workspaceKey: string;
  liveSessionId: string;
  chunkSetId: string;
  chunkId: string;
}): Promise<FetchOverlayChunkResult> {
  let chunkSet: Awaited<ReturnType<typeof loadOverlayChunkSet>>;
  try {
    chunkSet = await loadOverlayChunkSet({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      liveSessionId: input.liveSessionId,
      chunkSetId: input.chunkSetId,
    });
  } catch (err) {
    if (err instanceof ContentStoreError) {
      if (err.code === "not_found") return { ok: false, reason: "chunk_set_not_found" };
      return { ok: false, reason: "store_corrupt", detail: err.message };
    }
    throw err;
  }
  const chunk = chunkSet.chunks.find((c) => c.id === input.chunkId);
  if (chunk === undefined) return { ok: false, reason: "chunk_not_found" };
  return { ok: true, chunk };
}
```

- [ ] **Step 4: Export from `packages/context-gate/src/index.ts`**

Add after the existing `fetchChunk` export line:
```ts
export { fetchOverlayChunk, type FetchOverlayChunkResult } from "./fetch-overlay-chunk.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/context-gate exec vitest run test/fetch-overlay-chunk.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/context-gate/src/fetch-overlay-chunk.ts packages/context-gate/src/index.ts packages/context-gate/test/fetch-overlay-chunk.test.ts
git commit -m "feat(context-gate): fetchOverlayChunk for overlay-keyed expand"
```

---

## Task 2: daemon deps + JSON body reader

**Files:**
- Modify: `packages/daemon/package.json`
- Create: `packages/daemon/src/body.ts`
- Test: `packages/daemon/test/body.test.ts`

- [ ] **Step 1: Add dependencies to `packages/daemon/package.json`**

Add to `dependencies` (alongside the existing `zod`):
```json
    "@megasaver/content-store": "workspace:*",
    "@megasaver/context-gate": "workspace:*",
    "@megasaver/output-filter": "workspace:*",
    "@megasaver/shared": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: exit 0; the four workspace deps link into `packages/daemon`.

- [ ] **Step 3: Write the failing test**

`packages/daemon/test/body.test.ts`:
```ts
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { readJsonBody } from "../src/body.js";

// Minimal IncomingMessage stand-in: emits data/end like a real request stream.
function fakeReq(body: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  queueMicrotask(() => {
    if (body.length > 0) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

describe("readJsonBody", () => {
  it("parses a JSON body", async () => {
    await expect(readJsonBody(fakeReq('{"a":1}'))).resolves.toEqual({ a: 1 });
  });

  it("resolves an empty body to {}", async () => {
    await expect(readJsonBody(fakeReq(""))).resolves.toEqual({});
  });

  it("rejects invalid JSON", async () => {
    await expect(readJsonBody(fakeReq("not json"))).rejects.toBeInstanceOf(Error);
  });

  it("rejects a body over the size cap", async () => {
    const huge = `{"x":"${"a".repeat(40)}"}`;
    await expect(readJsonBody(fakeReq(huge), 8)).rejects.toThrow(/too large/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/body.test.ts`
Expected: FAIL — cannot find module `../src/body.js`.

- [ ] **Step 5: Write minimal implementation**

`packages/daemon/src/body.ts`:
```ts
import type { IncomingMessage } from "node:http";

// 16 MiB default cap: tool outputs can be large (the whole point), but an
// unbounded reader is a trivial local DoS. Empty body → {} so zod surfaces a
// structured validation error instead of a JSON.parse throw.
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

export function readJsonBody(req: IncomingMessage, maxBytes = DEFAULT_MAX_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/body.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/package.json packages/daemon/src/body.ts packages/daemon/test/body.test.ts pnpm-lock.yaml
git commit -m "feat(daemon): json body reader + engine deps"
```

---

## Task 3: excerpt + expand handlers

**Files:**
- Create: `packages/daemon/src/handlers.ts`
- Test: `packages/daemon/test/handlers.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/daemon/test/handlers.test.ts`:
```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { excerptHandler, expandHandler } from "../src/handlers.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-handlers-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join(
  "\n",
);

describe("excerptHandler", () => {
  it("400s on an invalid body", async () => {
    const res = await excerptHandler(store, { workspaceKey: "ws" });
    expect(res.status).toBe(400);
  });

  it("compresses + stores a large output and returns a chunkSetId", async () => {
    const res = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe("compressed");
    expect(typeof res.json.chunkSetId).toBe("string");
    expect(res.json.returnedBytes).toBeLessThan(res.json.rawBytes);
  });
});

describe("expandHandler", () => {
  it("round-trips a stored chunk produced by excerpt", async () => {
    const ex = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: ex.json.chunkSetId,
      chunkId: "0",
    });
    expect(res.status).toBe(200);
    expect(res.json.chunk.text).toContain("line 0");
  });

  it("404s on a missing chunk set", async () => {
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "missing",
      chunkId: "0",
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/handlers.test.ts`
Expected: FAIL — cannot find module `../src/handlers.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/daemon/src/handlers.ts`:
```ts
import { fetchOverlayChunk, recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { outputSourceKindSchema } from "@megasaver/output-filter";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";

export type HandlerResponse = { status: number; json: Record<string, unknown> };

const excerptRequestSchema = z
  .object({
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().min(1),
    raw: z.string(),
    sourceKind: outputSourceKindSchema,
    label: z.string(),
    mode: tokenSaverModeSchema,
    storeRawOutput: z.boolean(),
  })
  .strict();

export async function excerptHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = excerptRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const result = await recordAndFilterOverlayOutput({ storeRoot, ...parsed.data });
  return { status: 200, json: { ...result } };
}

const expandRequestSchema = z
  .object({
    workspaceKey: z.string().min(1),
    liveSessionId: z.string().min(1),
    chunkSetId: z.string().min(1),
    chunkId: z.string().min(1),
  })
  .strict();

export async function expandHandler(storeRoot: string, body: unknown): Promise<HandlerResponse> {
  const parsed = expandRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, json: { error: parsed.error.message } };
  const res = await fetchOverlayChunk({ storeRoot, ...parsed.data });
  if (res.ok) return { status: 200, json: { chunk: res.chunk } };
  if (res.reason === "store_corrupt") return { status: 500, json: { error: res.reason } };
  return { status: 404, json: { error: res.reason } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/handlers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/daemon/src/handlers.ts packages/daemon/test/handlers.test.ts
git commit -m "feat(daemon): excerpt + expand handlers over context-gate"
```

---

## Task 4: wire routes into the server

**Files:**
- Modify: `packages/daemon/src/server.ts`
- Modify: `packages/daemon/src/index.ts`
- Test: `packages/daemon/test/server.test.ts`

- [ ] **Step 1: Add the failing HTTP round-trip test**

Append to `packages/daemon/test/server.test.ts` (inside the existing `describe`, reuse its `store`/`daemon` setup):
```ts
  it("excerpt → expand round-trips over HTTP with the token", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const auth = { authorization: "Bearer secret", "content-type": "application/json" };
    const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor`).join("\n");

    const exRes = await fetch(`${daemon.url}/excerpt`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        raw: bigRaw,
        sourceKind: "command",
        label: "run tests",
        mode: "aggressive",
        storeRawOutput: true,
      }),
    });
    expect(exRes.status).toBe(200);
    const ex = (await exRes.json()) as { chunkSetId: string; decision: string };
    expect(ex.decision).toBe("compressed");

    const expRes = await fetch(`${daemon.url}/expand`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        workspaceKey: "ws",
        liveSessionId: "live1",
        chunkSetId: ex.chunkSetId,
        chunkId: "0",
      }),
    });
    expect(expRes.status).toBe(200);
    const exp = (await expRes.json()) as { chunk: { text: string } };
    expect(exp.chunk.text).toContain("line 0");
  });

  it("excerpt without a token is rejected (401)", async () => {
    daemon = await startDaemonServer({ storeRoot: store, port: 0, token: "secret" });
    const res = await fetch(`${daemon.url}/excerpt`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/server.test.ts`
Expected: FAIL — `/excerpt` currently 404s (route not wired), so the round-trip assertions fail.

- [ ] **Step 3: Wire the routes in `packages/daemon/src/server.ts`**

Add the imports at the top:
```ts
import { excerptHandler, expandHandler } from "./handlers.js";
import { readJsonBody } from "./body.js";
```

Replace the request handler's routing block (the `if (req.method === "GET" && req.url === "/status")` … `res.writeHead(404)` section) with a pathname-parsed version that adds the two POST routes. Keep the token check exactly as-is above it:
```ts
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

    if (req.method === "GET" && path === "/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, sessions: [], totals: {} }));
      return;
    }
    if (req.method === "POST" && path === "/shutdown") {
      res.writeHead(202);
      res.end();
      void close();
      return;
    }
    if (req.method === "POST" && (path === "/excerpt" || path === "/expand")) {
      void (async () => {
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : "bad body" }));
          return;
        }
        const result =
          path === "/excerpt"
            ? await excerptHandler(opts.storeRoot, body)
            : await expandHandler(opts.storeRoot, body);
        res.writeHead(result.status, { "content-type": "application/json" });
        res.end(JSON.stringify(result.json));
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal" }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
```

Note: the `createServer` callback must be able to `await`-dispatch — the inner `void (async () => {...})()` keeps the outer callback synchronous while handling the async body read. Do not change the surrounding `createServer((req, res) => { ... })` signature.

- [ ] **Step 4: Export handler types from `packages/daemon/src/index.ts`**

Add:
```ts
export { type HandlerResponse, excerptHandler, expandHandler } from "./handlers.js";
export { readJsonBody } from "./body.js";
```

- [ ] **Step 5: Run the server test to verify it passes**

Run: `pnpm --filter @megasaver/daemon exec vitest run test/server.test.ts`
Expected: PASS — the existing Phase 1 tests plus the new round-trip + 401 test.

- [ ] **Step 6: Run the full package suite + typecheck + biome**

Run:
```bash
pnpm --filter @megasaver/daemon test
pnpm --filter @megasaver/daemon exec tsc -b --noEmit
pnpm exec biome check packages/daemon packages/context-gate
```
Expected: all green / clean.

- [ ] **Step 7: Commit**

```bash
git add packages/daemon/src/server.ts packages/daemon/src/index.ts packages/daemon/test/server.test.ts
git commit -m "feat(daemon): wire POST /excerpt + /expand routes"
```

---

## Task 5: Phase verification

- [ ] **Step 1: Build + full verify**

Run:
```bash
pnpm build
pnpm verify
```
Expected: build succeeds for all packages (incl. context-gate + daemon rebuilt); `pnpm verify` green (lint, typecheck, all tests, conventions).

- [ ] **Step 2: End-to-end over the real CLI daemon**

Run (rebuild the CLI first so its bundle has the new daemon + context-gate code):
```bash
pnpm --filter @megasaver/daemon build && pnpm --filter @megasaver/cli build
rm -rf /tmp/mega-daemon-p2
node apps/cli/dist/cli.js daemon serve --store /tmp/mega-daemon-p2 &
SRV=$!
for i in $(seq 1 20); do [ -f /tmp/mega-daemon-p2/daemon/daemon.json ] && break; sleep 0.3; done
PORT=$(node -e 'console.log(require("/tmp/mega-daemon-p2/daemon/daemon.json").port)')
TOKEN=$(node -e 'console.log(require("/tmp/mega-daemon-p2/daemon/daemon.json").token)')
RAW=$(node -e 'console.log(Array.from({length:400},(_,i)=>`line ${i} lorem ipsum`).join("\n"))')
CS=$(curl -s -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"workspaceKey\":\"ws\",\"liveSessionId\":\"live1\",\"raw\":$(node -e 'console.log(JSON.stringify(process.argv[1]))' "$RAW"),\"sourceKind\":\"command\",\"label\":\"t\",\"mode\":\"aggressive\",\"storeRawOutput\":true}" \
  http://127.0.0.1:$PORT/excerpt | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.error("decision",j.decision,"saved",j.bytesSaved);console.log(j.chunkSetId)})')
curl -s -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d "{\"workspaceKey\":\"ws\",\"liveSessionId\":\"live1\",\"chunkSetId\":\"$CS\",\"chunkId\":\"0\"}" \
  http://127.0.0.1:$PORT/expand | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("expand ok, text starts:",j.chunk.text.slice(0,12))})'
kill $SRV
```
Expected: excerpt reports `decision compressed` + a positive `bytesSaved` + a `chunkSetId`; expand returns the chunk whose text starts with `line 0`.

- [ ] **Step 3: Final phase commit (if verify needed fixes)**

```bash
git add -A
git commit -m "chore(daemon): phase 2 verification fixes"
```

---

## Self-review (completed by plan author)

- **Spec coverage (Phase 2 slice):** `/excerpt` ✓ (Task 3/4 via `recordAndFilterOverlayOutput`), `/expand` ✓ (Task 1 `fetchOverlayChunk` + Task 3/4), engine reuse (no new compression) ✓, loopback+token inherited from Phase 1 ✓. `/exec`, `/recall`, session memory, client/hook refactor, GUI — explicitly Phases 3–7.
- **Type consistency:** `HandlerResponse {status, json}` defined Task 3, consumed in Task 4 server wiring. `FetchOverlayChunkResult` (Task 1) consumed by `expandHandler` (Task 3). Request schemas use `outputSourceKindSchema`/`tokenSaverModeSchema` — the exact enums `recordAndFilterOverlayOutput` expects.
- **Placeholder scan:** none — all code/tests/commands concrete.
- **Deviations from spec (intentional):** overlay keys (`workspaceKey`/`liveSessionId`) instead of `projectId`/`sessionId`, to match the live token-saver infra the daemon serves; evidence-ledger wiring (`evidenceStoreRoot`) left unset in Phase 2 — the full redacted output is still stored recoverably by `recordAndFilterOverlayOutput`, so no evidence is lost; structured evidence rows are a later concern.
```
