# Memory Graph — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the first visible Memory Graph — a pure typed projection of the existing memory/evidence/session/project/chunk data (plus computed conflict edges) into nodes+edges, served by the GUI bridge + a CLI, and rendered as a cytoscape network in `apps/gui`.

**Architecture:** A new **leaf** package `@megasaver/memory-graph` owns the graph model + a pure `buildGraph(input)` projection. It defines its OWN minimal input shapes (no `@megasaver/core` import → leaf rule preserved), so the projection is unit-tested entirely with fixtures. The **loader** (bridge + CLI) maps real store entities (`readOverlayMemory`, `listEvidenceByWorkspace`, `checkConflicts`, registry) into those shapes and calls `buildGraph`. The GUI fetches the graph JSON and renders it with cytoscape.js.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, tsup, Biome; React 18 + Vite + Tailwind (`apps/gui`); cytoscape.js; raw-`node:http` bridge.

**Spec:** `docs/superpowers/specs/2026-06-18-memory-graph-design.md`. Phase 1 scope = node kinds `project · session · memory · evidence · chunkset`; edge kinds `contains · scope · project-memory · cites · chunk-of · from-session · conflict · supersede · duplicate`. (file/symbol/wiki nodes + code-link/wiki edges + live SSE are Phase 2/3.)

---

## File structure

**New leaf package `packages/memory-graph/`:**
- `src/model.ts` — `GraphNode`, `GraphEdge`, `nodeKindSchema`, `edgeKindSchema`, `Graph` zod schemas.
- `src/inputs.ts` — minimal input shapes (`MemoryInput`, `EvidenceInput`, `SessionInput`, `ProjectInput`, `ChunkSetInput`, `ConflictPair`, `GraphInput`).
- `src/build-graph.ts` — pure `buildGraph(input: GraphInput): Graph`.
- `src/index.ts` — public re-exports.
- `test/build-graph.test.ts`, `test/model.test.ts`, `test/dependency-graph.test.ts`.
- Config: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json`, `tsup.config.ts`, `vitest.config.ts`.

**Loader (bridge):**
- `apps/gui/bridge/routes/memory-graph.ts` — `loadGraphInput(...)` + `handleGetMemoryGraph(...)`.
- `apps/gui/bridge/handler.ts` — register the route.
- `apps/gui/test/bridge/memory-graph-route.test.ts`.

**Loader (CLI):**
- `apps/cli/src/commands/memory/graph.ts` — `mega memory graph --json`.
- register in `apps/cli/src/commands/memory/index.ts`.
- `apps/cli/test/memory-graph.test.ts`.

**GUI:**
- `apps/gui/src/lib/claude-sessions-client.ts` — add `MemoryGraphData` type + `fetchSessionMemoryGraph`.
- `apps/gui/src/views/cockpit/memory-graph-panel.tsx` — cytoscape panel.
- `apps/gui/src/cockpit/panels/session-overlay-panels.tsx` + `panel-registry.ts` — register panel.
- `apps/gui/package.json` — add `cytoscape` + `@types/cytoscape`.
- `apps/gui/test/components/memory-graph-panel.test.tsx`.

---

## Task 1: Scaffold the `@megasaver/memory-graph` leaf package

**Files:** Create `packages/memory-graph/{package.json,tsconfig.json,tsconfig.test.json,tsconfig.test-d.json,tsup.config.ts,vitest.config.ts,src/index.ts,test/dependency-graph.test.ts}` (templated from `packages/policy/`).

- [ ] **Step 1: Create `packages/memory-graph/package.json`**
```json
{
  "name": "@megasaver/memory-graph",
  "version": "1.0.0",
  "private": true,
  "description": "Pure memory-graph model + projection for Mega Saver.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": { "@megasaver/shared": "workspace:*", "zod": "^3.24.1" },
  "devDependencies": { "@types/node": "^22.19.17", "fast-check": "^3.23.2" }
}
```

- [ ] **Step 2: Copy config files verbatim from `packages/policy/`** — `tsconfig.json`, `tsconfig.test.json`, `tsconfig.test-d.json`, `tsup.config.ts`, `vitest.config.ts` (identical content; read `packages/policy/<file>` and write to `packages/memory-graph/<file>`).

- [ ] **Step 3: Create `packages/memory-graph/src/index.ts`** (placeholder, expanded in later tasks)
```typescript
export {};
```

- [ ] **Step 4: Create `packages/memory-graph/test/dependency-graph.test.ts`** (leaf cycle-guard, templated from `packages/policy/test/dependency-graph.test.ts`)
```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED_DEPENDENCIES = ["@megasaver/shared", "zod"];
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  dependencies?: Record<string, string>;
};

describe("@megasaver/memory-graph dependency graph (cycle guard)", () => {
  it("declares exactly the allow-listed dependencies", () => {
    const deps = Object.keys(packageJson.dependencies ?? {}).sort();
    expect(deps).toEqual([...ALLOWED_DEPENDENCIES].sort());
  });
  it("does not depend on @megasaver/core", () => {
    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@megasaver/core");
  });
});
```

- [ ] **Step 5: Install + verify** — Run: `pnpm install && pnpm --filter @megasaver/memory-graph build && pnpm --filter @megasaver/memory-graph test`. Expected: build emits `dist/index.js`; dependency-graph test passes (2 tests).

- [ ] **Step 6: Commit** — `git add packages/memory-graph && git commit -m "chore(memory-graph): scaffold leaf package"`

## Task 2: Graph model (zod schemas)

**Files:** Create `packages/memory-graph/src/model.ts`, `test/model.test.ts`; modify `src/index.ts`.

- [ ] **Step 1: Write the failing test** `test/model.test.ts`
```typescript
import { describe, expect, it } from "vitest";
import { graphSchema, nodeKindSchema, edgeKindSchema } from "../src/model.js";

describe("memory-graph model", () => {
  it("accepts every Phase 1 node + edge kind", () => {
    for (const k of ["project", "session", "memory", "evidence", "chunkset"]) {
      expect(nodeKindSchema.parse(k)).toBe(k);
    }
    for (const k of ["contains","scope","project-memory","cites","chunk-of","from-session","conflict","supersede","duplicate"]) {
      expect(edgeKindSchema.parse(k)).toBe(k);
    }
  });
  it("validates a minimal graph", () => {
    const g = graphSchema.parse({
      nodes: [{ id: "m1", kind: "memory", label: "X", meta: {} }],
      edges: [],
      stats: { nodeCount: 1, edgeCount: 0 },
    });
    expect(g.nodes[0]?.kind).toBe("memory");
  });
  it("rejects an unknown node kind", () => {
    expect(() => nodeKindSchema.parse("banana")).toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @megasaver/memory-graph test -- model` (module missing).

- [ ] **Step 3: Implement `src/model.ts`**
```typescript
import { z } from "zod";

export const nodeKindSchema = z.enum([
  "project", "session", "memory", "evidence", "chunkset",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const edgeKindSchema = z.enum([
  "contains", "scope", "project-memory", "cites", "chunk-of",
  "from-session", "conflict", "supersede", "duplicate",
]);
export type EdgeKind = z.infer<typeof edgeKindSchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  kind: nodeKindSchema,
  label: z.string(),
  meta: z.record(z.string(), z.unknown()),
}).strict();
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  kind: edgeKindSchema,
  from: z.string().min(1),
  to: z.string().min(1),
}).strict();
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphSchema = z.object({
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  stats: z.object({ nodeCount: z.number().int(), edgeCount: z.number().int() }),
}).strict();
export type Graph = z.infer<typeof graphSchema>;
```

- [ ] **Step 4: Re-export from `src/index.ts`**
```typescript
export {
  nodeKindSchema, edgeKindSchema, graphNodeSchema, graphEdgeSchema, graphSchema,
  type NodeKind, type EdgeKind, type GraphNode, type GraphEdge, type Graph,
} from "./model.js";
```

- [ ] **Step 5: Run → PASS** — `pnpm --filter @megasaver/memory-graph test -- model`.

- [ ] **Step 6: Commit** — `git commit -am "feat(memory-graph): graph node/edge model"`

## Task 3: Input shapes + `buildGraph` pure projection

**Files:** Create `packages/memory-graph/src/inputs.ts`, `src/build-graph.ts`, `test/build-graph.test.ts`; modify `src/index.ts`.

- [ ] **Step 1: Implement `src/inputs.ts`** (the leaf's own minimal shapes — no core import)
```typescript
import { z } from "zod";

export const memoryInputSchema = z.object({
  id: z.string(),
  scope: z.enum(["project", "session"]),
  sessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  memoryType: z.string(),
  title: z.string(),
  approval: z.string(),
  confidence: z.string(),
  source: z.string(),
  stale: z.boolean(),
  evidenceIds: z.array(z.string()),
});
export type MemoryInput = z.infer<typeof memoryInputSchema>;

export const evidenceInputSchema = z.object({
  evidenceId: z.string(),
  sourceKind: z.string(),
  sessionId: z.string().nullable(),
  chunkSetIds: z.array(z.string()),
  status: z.string(),
});
export type EvidenceInput = z.infer<typeof evidenceInputSchema>;

export const sessionInputSchema = z.object({ id: z.string(), projectId: z.string().nullable() });
export type SessionInput = z.infer<typeof sessionInputSchema>;

export const projectInputSchema = z.object({ id: z.string(), name: z.string() });
export type ProjectInput = z.infer<typeof projectInputSchema>;

export const chunkSetInputSchema = z.object({ chunkSetId: z.string(), label: z.string(), redacted: z.boolean() });
export type ChunkSetInput = z.infer<typeof chunkSetInputSchema>;

export const conflictPairSchema = z.object({
  from: z.string(), to: z.string(), kind: z.enum(["conflict", "supersede", "duplicate"]),
});
export type ConflictPair = z.infer<typeof conflictPairSchema>;

export const graphInputSchema = z.object({
  projects: z.array(projectInputSchema),
  sessions: z.array(sessionInputSchema),
  memories: z.array(memoryInputSchema),
  evidence: z.array(evidenceInputSchema),
  chunkSets: z.array(chunkSetInputSchema),
  conflicts: z.array(conflictPairSchema),
});
export type GraphInput = z.infer<typeof graphInputSchema>;
```

- [ ] **Step 2: Write the failing test** `test/build-graph.test.ts` (one assertion per edge kind + node coverage + dedupe)
```typescript
import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/build-graph.js";
import type { GraphInput } from "../src/inputs.js";

const EMPTY: GraphInput = { projects: [], sessions: [], memories: [], evidence: [], chunkSets: [], conflicts: [] };

function base(): GraphInput {
  return {
    ...EMPTY,
    projects: [{ id: "p1", name: "demo" }],
    sessions: [{ id: "s1", projectId: "p1" }],
    memories: [
      { id: "m1", scope: "session", sessionId: "s1", projectId: "p1", memoryType: "decision", title: "D1", approval: "approved", confidence: "high", source: "agent", stale: false, evidenceIds: ["e1"] },
      { id: "m2", scope: "project", sessionId: null, projectId: "p1", memoryType: "bug", title: "B1", approval: "suggested", confidence: "low", source: "agent", stale: false, evidenceIds: [] },
    ],
    evidence: [{ evidenceId: "e1", sourceKind: "command", sessionId: "s1", chunkSetIds: ["c1"], status: "available" }],
    chunkSets: [{ chunkSetId: "c1", label: "curl ...", redacted: true }],
    conflicts: [{ from: "m1", to: "m2", kind: "supersede" }],
  };
}

const has = (g: ReturnType<typeof buildGraph>, kind: string, from: string, to: string) =>
  g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);

describe("buildGraph", () => {
  it("emits one node per entity with the right kind", () => {
    const g = buildGraph(base());
    expect(g.nodes.find((n) => n.id === "p1")?.kind).toBe("project");
    expect(g.nodes.find((n) => n.id === "s1")?.kind).toBe("session");
    expect(g.nodes.find((n) => n.id === "m1")?.kind).toBe("memory");
    expect(g.nodes.find((n) => n.id === "e1")?.kind).toBe("evidence");
    expect(g.nodes.find((n) => n.id === "c1")?.kind).toBe("chunkset");
    expect(g.stats.nodeCount).toBe(g.nodes.length);
  });
  it("carries memory meta (type/approval/confidence/stale)", () => {
    const m1 = buildGraph(base()).nodes.find((n) => n.id === "m1");
    expect(m1?.meta.memoryType).toBe("decision");
    expect(m1?.meta.approval).toBe("approved");
  });
  it("contains: project→session", () => { expect(has(buildGraph(base()), "contains", "p1", "s1")).toBe(true); });
  it("scope: session→memory (session-scoped)", () => { expect(has(buildGraph(base()), "scope", "s1", "m1")).toBe(true); });
  it("project-memory: project→memory (project-scoped)", () => { expect(has(buildGraph(base()), "project-memory", "p1", "m2")).toBe(true); });
  it("cites: memory→evidence", () => { expect(has(buildGraph(base()), "cites", "m1", "e1")).toBe(true); });
  it("chunk-of: evidence→chunkset", () => { expect(has(buildGraph(base()), "chunk-of", "e1", "c1")).toBe(true); });
  it("from-session: evidence→session", () => { expect(has(buildGraph(base()), "from-session", "e1", "s1")).toBe(true); });
  it("supersede: conflict pair → directed edge", () => { expect(has(buildGraph(base()), "supersede", "m1", "m2")).toBe(true); });
  it("skips edges to missing nodes (dangling evidence id)", () => {
    const input = base();
    input.memories[0]!.evidenceIds = ["e1", "MISSING"];
    expect(has(buildGraph(input), "cites", "m1", "MISSING")).toBe(false);
  });
  it("emits a deterministic stable edge id and no duplicate edges", () => {
    const g = buildGraph(base());
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @megasaver/memory-graph test -- build-graph`.

- [ ] **Step 4: Implement `src/build-graph.ts`**
```typescript
import type { Graph, GraphEdge, GraphNode } from "./model.js";
import type { GraphInput } from "./inputs.js";

export function buildGraph(input: GraphInput): Graph {
  const nodes: GraphNode[] = [];
  const ids = new Set<string>();
  const add = (n: GraphNode): void => { nodes.push(n); ids.add(n.id); };

  for (const p of input.projects) add({ id: p.id, kind: "project", label: p.name, meta: {} });
  for (const s of input.sessions) add({ id: s.id, kind: "session", label: s.id.slice(0, 8), meta: { projectId: s.projectId } });
  for (const m of input.memories)
    add({ id: m.id, kind: "memory", label: m.title, meta: {
      memoryType: m.memoryType, approval: m.approval, confidence: m.confidence, source: m.source, scope: m.scope, stale: m.stale } });
  for (const e of input.evidence)
    add({ id: e.evidenceId, kind: "evidence", label: `${e.sourceKind} ${e.evidenceId.slice(0, 6)}`, meta: { status: e.status } });
  for (const c of input.chunkSets)
    add({ id: c.chunkSetId, kind: "chunkset", label: c.label, meta: { redacted: c.redacted } });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const link = (kind: GraphEdge["kind"], from: string, to: string): void => {
    if (!ids.has(from) || !ids.has(to)) return;
    const id = `${kind}:${from}->${to}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind, from, to });
  };

  for (const s of input.sessions) if (s.projectId) link("contains", s.projectId, s.id);
  for (const m of input.memories) {
    if (m.scope === "session" && m.sessionId) link("scope", m.sessionId, m.id);
    else if (m.scope === "project" && m.projectId) link("project-memory", m.projectId, m.id);
    for (const evId of m.evidenceIds) link("cites", m.id, evId);
  }
  for (const e of input.evidence) {
    if (e.sessionId) link("from-session", e.evidenceId, e.sessionId);
    for (const cs of e.chunkSetIds) link("chunk-of", e.evidenceId, cs);
  }
  for (const c of input.conflicts) link(c.kind, c.from, c.to);

  return { nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length } };
}
```

- [ ] **Step 5: Re-export from `src/index.ts`** — add `export { buildGraph } from "./build-graph.js";` and `export { ...all input schemas/types... } from "./inputs.js";`

- [ ] **Step 6: Run → PASS** — `pnpm --filter @megasaver/memory-graph test`. Expected: all build-graph + model + dependency-graph tests pass.

- [ ] **Step 7: Commit** — `git commit -am "feat(memory-graph): pure buildGraph projection"`

## Task 4: Bridge loader + `GET /memory/graph` endpoint

**Files:** Create `apps/gui/bridge/routes/memory-graph.ts`, `apps/gui/test/bridge/memory-graph-route.test.ts`; modify `apps/gui/bridge/handler.ts`; add `@megasaver/memory-graph` + `@megasaver/evidence-ledger` to `apps/gui/package.json` deps.

Loader maps real entities → `GraphInput`, runs `checkConflicts` for conflict edges, calls `buildGraph`. **Confirm the exact signatures of `listEvidenceByWorkspace` and `checkConflicts` against the real source before writing** (`packages/evidence-ledger/src/store.ts`, `packages/core/src/conflict-checker.ts`) — they are the only external calls here.

- [ ] **Step 1: Add deps** — in `apps/gui/package.json` add `"@megasaver/memory-graph": "workspace:*"` and `"@megasaver/evidence-ledger": "workspace:*"` to `dependencies`; run `pnpm install`.

- [ ] **Step 2: Write the failing bridge test** `apps/gui/test/bridge/memory-graph-route.test.ts` (mirror `test/bridge/claude-session-memory-route.test.ts` harness: `seedWorkspaceCwd` + `startTestBridge`, POST two memories, GET graph)
```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type TestServer, seedWorkspaceCwd, startTestBridge } from "./test-helpers.js";

const CWD = "/tmp/graph-ws";
const DIR = "ws-dir";
const ID = "wssess01";
let projectsDir: string; let metaDir: string; let server: TestServer;

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "graph-projects-"));
  metaDir = mkdtempSync(join(tmpdir(), "graph-meta-"));
  seedWorkspaceCwd({ projectsDir, metaDir, cwd: CWD, id: ID });
});
afterEach(async () => { if (server) await server.close(); });
const base = () => `${server.baseUrl}/api/claude-sessions/${DIR}/${ID}/memory`;

it("GET .../memory/graph projects memories into nodes+edges", async () => {
  server = await startTestBridge({ claudeProjectsDir: projectsDir, claudeSessionsMetaDir: metaDir });
  const post = (body: object) => fetch(base(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const m1 = await (await post({ scope: "session", content: "decision one", type: "decision" })).json();
  await post({ scope: "session", content: "todo two", type: "todo" });

  const res = await fetch(`${base()}/graph`);
  expect(res.status).toBe(200);
  const g = await res.json();
  expect(g.nodes.some((n: { id: string; kind: string }) => n.id === m1.id && n.kind === "memory")).toBe(true);
  expect(g.stats.nodeCount).toBe(g.nodes.length);
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @megasaver/gui test -- memory-graph-route` (route not registered → 404).

- [ ] **Step 4: Implement `apps/gui/bridge/routes/memory-graph.ts`** (loader + handler; mirror `routes/claude-session-memory.ts` resolution + response). Read the real `OverlayMemoryEntry` shape and `listEvidenceByWorkspace`/`checkConflicts` signatures and map accordingly:
```typescript
import { type OverlayMemoryEntry, checkConflicts, readOverlayMemory } from "@megasaver/core";
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import { buildGraph, type ConflictPair, type GraphInput } from "@megasaver/memory-graph";
import type { RouteContext } from "./_types.js"; // use the same context type the memory route uses
import { handleCaughtError } from "../error-mapping.js";
import { resolveSessionWorkspace, sendSessionResolveError } from "./_claude-session.js";

function toGraphInput(memories: OverlayMemoryEntry[], evidence: readonly { evidenceId: string; sourceKind: string; sessionRef: { id: string } | null; returnedChunkRefs: { chunkSetId: string }[]; redactedRawChunkSetId: string | null; status: string }[]): GraphInput {
  const conflicts: ConflictPair[] = [];
  const approved = memories.filter((m) => m.approval === "approved");
  const map = { duplicate: "duplicate", supersession: "supersede", contradiction: "conflict" } as const;
  for (const cand of memories) {
    const r = checkConflicts(cand as never, approved as never);
    if (r.outcome in map) for (const other of r.conflictIds) conflicts.push({ from: cand.id, to: other, kind: map[r.outcome as keyof typeof map] });
  }
  const chunkIds = new Map<string, { chunkSetId: string; label: string; redacted: boolean }>();
  return {
    projects: [], sessions: [{ id: memories[0]?.liveSessionId ?? "live", projectId: null }],
    memories: memories.map((m) => ({ id: m.id, scope: m.scope, sessionId: m.liveSessionId, projectId: null, memoryType: m.type, title: m.title, approval: m.approval, confidence: m.confidence, source: m.source, stale: m.stale, evidenceIds: m.evidence ?? [] })),
    evidence: evidence.map((e) => { const cs = [...e.returnedChunkRefs.map((r) => r.chunkSetId), ...(e.redactedRawChunkSetId ? [e.redactedRawChunkSetId] : [])]; for (const id of cs) chunkIds.set(id, { chunkSetId: id, label: id.slice(0, 8), redacted: true }); return { evidenceId: e.evidenceId, sourceKind: e.sourceKind, sessionId: e.sessionRef?.id ?? null, chunkSetIds: cs, status: e.status }; }),
    chunkSets: [...chunkIds.values()],
    conflicts,
  };
}

export async function handleGetMemoryGraph(ctx: RouteContext, dir: string, id: string): Promise<void> {
  const resolved = await resolveSessionWorkspace(ctx, dir, id);
  if (resolved === "unsafe" || resolved === "not_found") { sendSessionResolveError(ctx, resolved, dir, id); return; }
  try {
    const memories = readOverlayMemory(ctx.storeRoot, resolved.workspaceKey);
    const evidence = await listEvidenceByWorkspace({ storeRoot: ctx.storeRoot, workspaceKey: resolved.workspaceKey });
    const graph = buildGraph(toGraphInput(memories, evidence as never));
    ctx.sendJson(ctx.res, 200, graph, ctx.origin);
  } catch (err) { handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError); }
}
```
> NOTE for implementer: adjust the `evidence`/`checkConflicts` casts to the REAL types once you read the signatures; the `as never` placeholders must be replaced with correct typing (no `any`/`never` left). If `listEvidenceByWorkspace` is positional (`(storeRoot, workspaceKey)`) instead of object-form, use that. Keep the loader's mapping deterministic.

- [ ] **Step 5: Register the route in `apps/gui/bridge/handler.ts`** — import `handleGetMemoryGraph` and add a regex match BEFORE the generic memory match (so `/memory/graph` is not captured by `/memory/:entryId`):
```typescript
const memoryGraphMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)\/memory\/graph$/);
if (memoryGraphMatch) {
  if (method !== "GET") return methodNotAllowed(res, method, origin);
  await handleGetMemoryGraph(ctx, decodeURIComponent(memoryGraphMatch[1] as string), decodeURIComponent(memoryGraphMatch[2] as string));
  return;
}
```

- [ ] **Step 6: Build deps + run → PASS** — `pnpm --filter @megasaver/memory-graph build && pnpm --filter @megasaver/evidence-ledger build && pnpm --filter @megasaver/core build && pnpm --filter @megasaver/gui test -- memory-graph-route`.

- [ ] **Step 7: Commit** — `git commit -am "feat(gui): memory-graph bridge endpoint"`

## Task 5: CLI `mega memory graph --json`

**Files:** Create `apps/cli/src/commands/memory/graph.ts`, `apps/cli/test/memory-graph.test.ts`; register in `apps/cli/src/commands/memory/index.ts`.

- [ ] **Step 1: Write the failing test** `apps/cli/test/memory-graph.test.ts` (seed a project + memory via the registry like existing memory CLI tests; run the command; assert JSON has `nodes`/`edges`/`stats`). Mirror the harness in `apps/cli/test/memory-*.test.ts`. (Read one existing memory CLI test first for the exact store-seed + command-invocation pattern.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `graph.ts`** — resolve store via `readStoreEnv`/`resolveStorePath`, `createJsonDirectoryCoreRegistry`, list projects/sessions/memories, run `checkConflicts`, map to `GraphInput` (project-scoped variant: use `projectId`/`sessionId`), `buildGraph`, print `JSON.stringify(graph)` when `--json`. Reuse the bridge loader's mapping logic shape (consider extracting the core→GraphInput mapping into a shared helper in `apps/cli`/bridge if duplication grows — for Phase 1, a focused per-caller mapping is acceptable per the 3-similar-lines rule).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Register the subcommand** in `apps/cli/src/commands/memory/index.ts` (mirror how `show`/`explain` are registered).

- [ ] **Step 6: Commit** — `git commit -am "feat(cli): mega memory graph"`

## Task 6: GUI cytoscape panel

**Files:** modify `apps/gui/package.json` (add `cytoscape`, `@types/cytoscape`), `apps/gui/src/lib/claude-sessions-client.ts`, `apps/gui/src/cockpit/panels/session-overlay-panels.tsx`, `apps/gui/src/cockpit/panel-registry.ts`; create `apps/gui/src/views/cockpit/memory-graph-panel.tsx`, `apps/gui/test/components/memory-graph-panel.test.tsx`.

- [ ] **Step 1: Add cytoscape** — `pnpm --filter @megasaver/gui add cytoscape && pnpm --filter @megasaver/gui add -D @types/cytoscape`.

- [ ] **Step 2: Add client type + fetch** in `apps/gui/src/lib/claude-sessions-client.ts`
```typescript
export type MemoryGraphData = {
  nodes: { id: string; kind: string; label: string; meta: Record<string, unknown> }[];
  edges: { id: string; kind: string; from: string; to: string }[];
  stats: { nodeCount: number; edgeCount: number };
};
export function fetchSessionMemoryGraph(dir: string, id: string): Promise<MemoryGraphData> {
  return getJson<MemoryGraphData>(`${memoryBase(dir, id)}/graph`);
}
```

- [ ] **Step 3: Write the failing component test** `apps/gui/test/components/memory-graph-panel.test.tsx` (mirror an existing component test; mock `fetchSessionMemoryGraph` to resolve a 2-node/1-edge graph; assert the loading state then that the cytoscape container mounts — `screen.getByTestId("memory-graph-canvas")`).

- [ ] **Step 4: Run → FAIL.**

- [ ] **Step 5: Implement `memory-graph-panel.tsx`** — mirror `views/cockpit/memory-panel.tsx` fetch pattern (useState/useCallback/useEffect + `LoadingState`/`ErrorState`). On `ready`, mount cytoscape into a `ref` div (`data-testid="memory-graph-canvas"`), mapping `nodes`→`{ data: { id, label }, classes: kind }` and `edges`→`{ data: { id, source: from, target: to }, classes: kind }`; cytoscape style: node `background-color` by `kind` class (the legend palette from the spec mockup), edge style by `kind` (provenance solid+arrow, conflict dashed red, scope/contains thin grey); layout `cose`. Click a node → set a `selected` state → render a detail panel (label + meta). Read theme tokens via `getComputedStyle(document.documentElement).getPropertyValue('--color-...')` so colors track light/dark. Dispose cytoscape in the effect cleanup.

- [ ] **Step 6: Register the panel** — adapter in `session-overlay-panels.tsx` + entry in `panel-registry.ts` (`{ id: "memory-graph", label: "Memory Graph", scope: "session", component: MemoryGraphCockpitPanel }`).

- [ ] **Step 7: Run → PASS** — `pnpm --filter @megasaver/gui test -- memory-graph-panel`. Manual smoke: `pnpm --filter @megasaver/gui dev`, open a session cockpit, click the "Memory Graph" tab → network renders.

- [ ] **Step 8: Commit** — `git commit -am "feat(gui): memory-graph cytoscape panel"`

## Task 7: Changeset + full verify

- [ ] **Step 1:** `.changeset/memory-graph-phase1.md` — `@megasaver/memory-graph` minor (new package), `@megasaver/gui` minor (graph endpoint + panel), `@megasaver/cli` minor (`mega memory graph`).
- [ ] **Step 2:** `pnpm verify` → exit 0 (lint + typecheck + all tests + conventions:check). Fix any drift.
- [ ] **Step 3:** Capture GUI smoke evidence (screenshot/terminal of the rendered graph) per Definition of Done item 5.
- [ ] **Step 4:** Commit the changeset.

---

## Self-review notes

- **Spec coverage:** Phase 1 node/edge kinds (spec §4, §9) → Tasks 2–3. Hybrid build "derive" → Task 3/4 (cache deferred to a follow-on task; not required for the MVP "see the network"). API `/memory/graph` (§6) → Task 4. CLI (§6) → Task 5. cytoscape view + color/edges/detail (§7) → Task 6. TDD (§8) → every task is RED→GREEN with the pure `buildGraph` carrying the bulk of coverage. Filters/search/neighbors/cache and file/symbol/wiki/live are explicitly Phase 2/3 (spec §9) — out of this plan by design.
- **Leaf purity:** `@megasaver/memory-graph` depends only on shared+zod (Task 1 dep-graph test enforces it); it never imports core — the core→input mapping lives in the bridge/CLI loaders (Tasks 4–5).
- **Type consistency:** `GraphInput`/`MemoryInput`/etc. (Task 3) are the single contract `buildGraph` (Task 3), the bridge loader (Task 4), and the CLI loader (Task 5) all target. `MemoryGraphData` (Task 6) is the wire mirror of `Graph` (Task 2).
- **Open risk flagged to implementer:** the exact signatures of `listEvidenceByWorkspace` and `checkConflicts` must be confirmed against source in Task 4 (the `as never` casts are placeholders to replace with real types — no `any`/`never` may ship).
