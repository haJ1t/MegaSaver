# Decision-Trace Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Strict TDD: failing test first → red → minimal impl → green → commit. `pnpm build` after src edits (vitest resolves `@megasaver/*` via dist). `pnpm verify` at every slice boundary.

**Goal:** Surface MegaSaver's already-recorded causal chain — join `replay-trace` (ranking) + `evidence-ledger` (memory pins + redaction) by `chunkSetId` into a per-output `SessionDecisionTrace`, shown via `mega trace explain` and a Cytoscape GUI panel.

**Architecture:** A shared pure reader (`readSessionDecisionTrace`) produces the structured trace; the CLI renders it as text/JSON and the GUI bridge projects it to a Cytoscape graph. Tracing becomes on-by-default with a retention cap.

**Tech Stack:** TypeScript ESM, Zod, Vitest, cytoscape (already a GUI dep), Citty (CLI). Packages: `@megasaver/output-filter`, `@megasaver/context-gate`, `@megasaver/content-store`, `apps/cli`, `apps/gui`.

**Spec:** `docs/superpowers/specs/2026-07-04-decision-trace-viewer-design.md`. Risk MEDIUM-HIGH → code-reviewer + critic.

**Verified anchors:** `replay-trace.ts:12` `ChunkRef {startLine,endLine,score,engine?}`; `ChunkRef.engine = EngineScore {baseRelevance,memoryBoost,failureHistoryBoost,finalScore}`; `ReplayTrace {chunkSetId?,sessionId,projectId,toolName,createdAt,classification,decision,candidates,selected,omitted}` (replay-trace.ts:92); `readReplayTraces(path): ReplayTrace[]` (output-filter); traces at `stats/<projectId>/<sessionId>-traces/replay-traces.jsonl`; `listEvidenceByWorkspace(store, workspaceKey)` (evidence-ledger) → records `{evidenceId, returnedChunkRefs:[{chunkSetId,chunkId}], redactedRawChunkSetId, pinnedByMemoryIds, redactionReport, status}` at `evidence/<workspaceKey>/<id>.json`; `seamTraceEnabledByEnv()` (rank.ts:157); `pruneOlderThan(storeRoot, olderThan)` (content-store store.ts:225); GUI pattern = `apps/gui/src/views/cockpit/memory-graph-panel.tsx` + `apps/gui/bridge/routes/memory-graph.ts` (`handleGetMemoryGraph` + `resolveSessionWorkspace`) + `claude-sessions-client.ts fetchSessionMemoryGraph`; CLI pattern = `apps/cli/src/commands/audit/seam.ts` (`locateTraceFiles` + `readReplayTraces` + `renderSeamReport`).

---

## Slice 1 — join reader (`@megasaver/output-filter`)

### Task 1.1: `SessionDecisionTrace` types + `readSessionDecisionTrace`

**Files:**
- Create: `packages/output-filter/src/decision-trace.ts`
- Modify: `packages/output-filter/src/index.ts` (export)
- Test: `packages/output-filter/test/decision-trace.test.ts`

- [ ] **Step 1: Read the real shapes first**

Read `packages/output-filter/src/replay-trace.ts` (`ReplayTrace`, `ChunkRef`, `EngineScore`, `readReplayTraces`) and `packages/evidence-ledger/src/index.ts` + `store.ts` (`listEvidenceByWorkspace` signature, the evidence record type — confirm `returnedChunkRefs`, `redactedRawChunkSetId`, `pinnedByMemoryIds`, `redactionReport` field names). Adjust the code below to the exact field names.

- [ ] **Step 2: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSessionDecisionTrace } from "../src/decision-trace.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const WK = "e02b98f66e82b6b9";

function seed() {
  const root = mkdtempSync(join(tmpdir(), "dtv-"));
  // trace: one output, chunkSetId cs1, one selected chunk w/ a memory boost
  const traceDir = join(root, "stats", PROJECT, `${SESSION}-traces`);
  mkdirSync(traceDir, { recursive: true });
  const trace = { sessionId: SESSION, projectId: PROJECT, toolName: "Read", createdAt: "2026-07-04T00:00:00.000Z",
    chunkSetId: "cs1", classification: { category: "typescript", confidence: 0.7 }, decision: "compressed",
    ranking: { candidates: [], selected: [{ startLine: 1, endLine: 10, score: 0.9, engine: { baseRelevance: 0.7, memoryBoost: 0.2, failureHistoryBoost: 0, finalScore: 0.9 } }], omitted: [] } };
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${JSON.stringify(trace)}\n`);
  // evidence: same chunkSetId cs1, pinned by a memory + redaction
  const evDir = join(root, "evidence", WK);
  mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, "ev1.json"), JSON.stringify({ evidenceId: "ev1", workspaceKey: WK,
    returnedChunkRefs: [{ chunkSetId: "cs1", chunkId: "0" }], redactedRawChunkSetId: "cs1",
    pinnedByMemoryIds: ["mem-abc"], redactionReport: { secretsRedacted: 1, categories: ["bearer"] }, status: "available" }));
  return root;
}

describe("readSessionDecisionTrace", () => {
  it("joins trace and evidence by chunkSetId at output granularity", () => {
    const root = seed();
    const t = readSessionDecisionTrace({ root }, { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK });
    expect(t.outputs).toHaveLength(1);
    const o = t.outputs[0]!;
    expect(o.chunkSetId).toBe("cs1");
    expect(o.decision).toBe("compressed");
    expect(o.selected[0]!.engine.memoryBoost).toBe(0.2);
    expect(o.memory?.pinnedByMemoryIds).toEqual(["mem-abc"]);   // joined from evidence
    expect(o.redaction?.secretsRedacted).toBe(1);
    expect(o.evidencePresent).toBe(true);
  });

  it("marks evidencePresent false when no evidence matches (orphan trace, not dropped)", () => {
    const root = seed();
    const t = readSessionDecisionTrace({ root }, { projectId: PROJECT, sessionId: SESSION, workspaceKey: "deadbeefdeadbeef" });
    expect(t.outputs).toHaveLength(1);           // trace still present
    expect(t.outputs[0]!.evidencePresent).toBe(false);
    expect(t.outputs[0]!.memory).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL** (`pnpm --filter @megasaver/output-filter test -- decision-trace`, module missing).

- [ ] **Step 4: Implement** `decision-trace.ts`:

```ts
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import { readReplayTraces } from "./replay-trace.js";
import { join } from "node:path";

export type RankedChunkView = { startLine: number; endLine: number; score: number;
  engine: { baseRelevance: number; memoryBoost: number; failureHistoryBoost: number; finalScore: number } };
export type DecisionOutput = {
  chunkSetId: string | null; toolName: string; createdAt: string;
  classification: { category: string; confidence: number }; decision: string;
  selected: RankedChunkView[]; omitted: RankedChunkView[];
  memory: { pinnedByMemoryIds: string[] } | null;
  redaction: { secretsRedacted: number; categories: string[] } | null;
  evidencePresent: boolean;
};
export type SessionDecisionTrace = { projectId: string; sessionId: string; outputs: DecisionOutput[] };

export function readSessionDecisionTrace(
  store: { root: string },
  key: { projectId: string; sessionId: string; workspaceKey: string },
): SessionDecisionTrace {
  const tracePath = join(store.root, "stats", key.projectId, `${key.sessionId}-traces`, "replay-traces.jsonl");
  const traces = readReplayTraces(tracePath); // best-effort: [] if missing
  // index evidence by chunkSetId (a corrupt/missing store degrades to empty)
  const evByChunkSet = new Map<string, { pinnedByMemoryIds: string[]; redaction: { secretsRedacted: number; categories: string[] } }>();
  try {
    for (const ev of listEvidenceByWorkspace(store, key.workspaceKey)) {
      const cs = ev.redactedRawChunkSetId ?? ev.returnedChunkRefs?.[0]?.chunkSetId;
      if (cs === undefined) continue;
      evByChunkSet.set(cs, {
        pinnedByMemoryIds: ev.pinnedByMemoryIds ?? [],
        redaction: { secretsRedacted: ev.redactionReport?.secretsRedacted ?? 0, categories: ev.redactionReport?.categories ?? [] },
      });
    }
  } catch { /* evidence store absent → all outputs evidencePresent:false */ }
  const toView = (c: { startLine: number; endLine: number; score: number; engine?: RankedChunkView["engine"] }): RankedChunkView =>
    ({ startLine: c.startLine, endLine: c.endLine, score: c.score,
       engine: c.engine ?? { baseRelevance: 0, memoryBoost: 0, failureHistoryBoost: 0, finalScore: c.score } });
  const outputs: DecisionOutput[] = traces.map((t) => {
    const ev = t.chunkSetId != null ? evByChunkSet.get(t.chunkSetId) : undefined;
    return { chunkSetId: t.chunkSetId ?? null, toolName: t.toolName, createdAt: t.createdAt,
      classification: t.classification, decision: t.decision,
      selected: t.ranking.selected.map(toView), omitted: t.ranking.omitted.map(toView),
      memory: ev ? { pinnedByMemoryIds: ev.pinnedByMemoryIds } : null,
      redaction: ev ? ev.redaction : null, evidencePresent: ev !== undefined };
  });
  return { projectId: key.projectId, sessionId: key.sessionId, outputs };
}
```

Adjust `t.ranking.selected` / field names to the real `ReplayTrace` shape (Step 1). Export all four types + the fn from `index.ts`.

- [ ] **Step 5: Run — expect PASS**, then commit `feat(output-filter): join replay-trace + evidence into SessionDecisionTrace`.

---

## Slice 2 — tracing default-on + retention prune

### Task 2.1: flip tracing default

**Files:** `packages/output-filter/src/rank.ts` (`seamTraceEnabledByEnv`, ~line 157), its tests.

- [ ] **Step 1: Test (adjust existing rank env tests)** — env unset → enabled; `MEGASAVER_SEAM_TRACE` in {`false`,`0`,`off`,`no`} → disabled; other/unset → enabled.

```ts
it("traces are on by default, off only when explicitly disabled", () => {
  expect(seamTraceEnabledByEnv({})).toBe(true);
  expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "false" })).toBe(false);
  expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "0" })).toBe(false);
  expect(seamTraceEnabledByEnv({ MEGASAVER_SEAM_TRACE: "true" })).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL** (currently default false).
- [ ] **Step 3: Implement** — invert: `return !isExplicitlyDisabled(env)`, where disabled iff the (trimmed/lowercased) value ∈ {`false`,`0`,`off`,`no`}. Keep it injectable (`env` param) as today.
- [ ] **Step 4: Run — expect PASS.** Then run the full `output-filter` + `context-gate` suites to catch any test that assumed default-off; update those assertions to reflect default-on (the seam call sites at `run.ts:135` / `run-command.ts:260` are unchanged — they still gate on the resolver).
- [ ] **Step 5: Commit** `feat(output-filter): tracing on by default (disable via MEGASAVER_SEAM_TRACE=false)`.

### Task 2.2: trace-session retention prune (`@megasaver/content-store` or context-gate)

**Files:** Create `packages/content-store/src/prune-traces.ts` (mirror `pruneOlderThan` at store.ts:225); export it; wire a best-effort call at the trace write path (`packages/context-gate/src/run.ts` / `run-command.ts` near `writeReplayTrace`), or a `mega trace gc` command. Test alongside.

- [ ] **Step 1: Test** — a store with N `stats/<projectId>/<sessionId>-traces/` dirs, `MAX_TRACE_SESSIONS=3` → keeps the 3 most-recently-modified trace dirs, removes older; the newest are untouched; non-trace files under `stats/` (`*.events.jsonl`, `*.json`) are NOT deleted.

```ts
it("keeps the newest MAX trace-session dirs, prunes older, leaves stats files", () => {
  const root = seedTraceDirs(5);            // 5 sessions each with a -traces/replay-traces.jsonl + a .events.jsonl
  pruneTraceSessions(root, PROJECT, 3);
  expect(remainingTraceDirs(root, PROJECT)).toHaveLength(3);
  expect(existsSync(join(root,"stats",PROJECT,`${oldest}.events.jsonl`))).toBe(true); // stats untouched
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** `pruneTraceSessions(storeRoot, projectId, maxSessions)`: `readdirSync(stats/<projectId>)`, filter dir entries ending `-traces`, sort by mtime desc, `rm -rf` (recursive) the ones past `maxSessions`. Best-effort try/catch (never throw). Do NOT touch `.events.jsonl` / `.json` siblings.
- [ ] **Step 4: Wire** a best-effort `pruneTraceSessions(storeRoot, projectId, MAX_TRACE_SESSIONS=20)` call right after `writeReplayTrace` at the registry seam sites (guarded so it never blocks the response), OR expose it as `mega trace gc` and call it there. Prefer the write-path hook (keeps it automatic). WHY comment: bounds the only always-on new disk.
- [ ] **Step 5: Run + full verify, commit** `feat: retention cap for replay traces`.

---

## Slice 3 — CLI `mega trace explain <sessionId>`

### Task 3.1: the command

**Files:** Create `apps/cli/src/commands/trace/explain.ts` + `apps/cli/src/commands/trace/index.ts` (command group), register in the root command (mirror how `audit` is registered). Test: `apps/cli/test/commands/trace/explain.test.ts`.

- [ ] **Step 1: Read** `apps/cli/src/commands/audit/seam.ts` (`RunAuditSeamInput`, store/session resolution, `locateTraceFiles`, `renderSeamReport`, `--json`) and mirror its shape. Note it resolves `projectId`+`sessionId`; the decision-trace reader also needs `workspaceKey` — resolve it the same way the bridge does (from the session), or from the store's session→workspace mapping; if the CLI can't resolve workspaceKey, accept a `--workspace` flag (evidence join degrades to `evidencePresent:false` without it — acceptable, note in help).
- [ ] **Step 2: Test** — a fixture store (seed like Task 1.1) → `runTraceExplain` text output contains the causal chain for the output (tool, decision, a selected chunk's `finalScore`, `memoryBoost`, the pinned memory id, redaction count); `--json` returns the `SessionDecisionTrace`; a session with no traces → an honest "no decision traces" message, exit 0.

```ts
it("renders the causal chain for a session", async () => {
  const { stdout } = await runTraceExplain({ sessionId: SESSION, projectName: "demo", storeFlag: root, /* … */ });
  expect(stdout).toMatch(/Read/); expect(stdout).toMatch(/compressed/);
  expect(stdout).toMatch(/memoryBoost/); expect(stdout).toMatch(/mem-abc/);
});
it("emits SessionDecisionTrace under --json", async () => {
  const { stdout } = await runTraceExplain({ sessionId: SESSION, projectName: "demo", storeFlag: root, json: true, /* … */ });
  expect(JSON.parse(stdout).outputs[0].decision).toBe("compressed");
});
```

- [ ] **Step 3: Implement** `runTraceExplain(input)`: resolve store + projectId (mirror seam) + workspaceKey → `readSessionDecisionTrace(store, {projectId, sessionId, workspaceKey})` → if `--json` print JSON; else render per output: `«toolName» → decision=«decision» | memory: «pinnedByMemoryIds or —» | redaction: «redacted ? "yes (N high-risk)" : —»` (real fields `redaction.redacted`/`redaction.highRiskFindings` per shipped Slice 1) then a small table of selected chunks (`lines a-b  score=..  base/mem/fail`) and a dimmed omitted count. Empty → message + exit 0. Wire `trace explain` command + register the `trace` group.
- [ ] **Step 4: Run — PASS.** Registry parity/help tests if any.
- [ ] **Step 5: Full verify, commit** `feat(cli): mega trace explain — session decision chain`.

---

## Slice 4 — GUI bridge + client + Cytoscape panel

### Task 4.1: graph projection + bridge route

**Files:** Create `apps/gui/bridge/routes/decision-trace.ts` (mirror `apps/gui/bridge/routes/memory-graph.ts` `handleGetMemoryGraph`); create `apps/gui/src/lib/decision-trace-graph.ts` (pure `toDecisionGraph(SessionDecisionTrace): DecisionTraceData`); modify `apps/gui/bridge/handler.ts` (regex route BEFORE the memory-graph match, ~line 281). Test: `apps/gui/test/bridge/decision-trace.test.ts`.

- [ ] **Step 1: Read** `memory-graph.ts` (`handleGetMemoryGraph(ctx, dir, id)` → `resolveSessionWorkspace` → load → `ctx.sendJson`) and `handler.ts:281` (the memory-graph regex + dispatch). Mirror exactly.
- [ ] **Step 2: Test the bridge handler** — fixture store (Task 1.1 seed) + a fake ctx → `handleGetDecisionTrace(ctx, dir, id)` sends 200 with `{nodes,edges,stats}`; nodes include a `decision` node + a `chunk` node + a `memory` node (for the pin) + `redaction`; a session with no traces → 200 with empty `{nodes:[],edges:[],stats:{outputs:0}}`.

```ts
it("returns a decision graph for a session with traces", async () => {
  const ctx = fakeCtx(root);                       // resolveSessionWorkspace resolves to WK
  await handleGetDecisionTrace(ctx, dirFor(PROJECT), SESSION);
  const body = ctx.lastJson();
  expect(body.nodes.some((n) => n.kind === "decision")).toBe(true);
  expect(body.nodes.some((n) => n.kind === "memory" && n.id === "mem-abc")).toBe(true);
  expect(body.edges.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Implement** `toDecisionGraph(trace)`: per `DecisionOutput`, emit nodes `{id, kind, label, meta}` — `output` (tool+decision), `chunk` per selected (label `lines a-b`, meta.score/engine), `memory` per `pinnedByMemoryIds` (kind `memory`), `redaction` if `redaction?.redacted` (real field, label `n high-risk` from `highRiskFindings`) — and edges output→chunk (`ranked`), memory→output (`pinned`), output→redaction (`redacted`); `stats {outputs, chunks, memoriesPinned}`. Then `handleGetDecisionTrace(ctx, dir, id)`: `resolveSessionWorkspace(dir,id)` → `readSessionDecisionTrace(store, {projectId, sessionId: liveSessionId, workspaceKey})` → `toDecisionGraph` → `ctx.sendJson(ctx.res, 200, graph, ctx.origin)`. Add the regex `^/api/claude-sessions/([^/]+)/([^/]+?)/decision-trace/graph$` in `handler.ts` BEFORE the memory-graph match + the import.
- [ ] **Step 4: Run — PASS**, commit `feat(gui): decision-trace bridge route + graph projection`.

### Task 4.2: client + Cytoscape panel + cockpit wiring

**Files:** Create `apps/gui/src/lib/decision-trace-client.ts` (`fetchDecisionTraceGraph(dir,id)`); create `apps/gui/src/views/cockpit/decision-trace-panel.tsx` (mirror `memory-graph-panel.tsx`); wire a `Trace` panel into the cockpit (where `memory-graph-panel` is registered). Test: `apps/gui/test/…decision-trace-panel` (mirror the memory-graph panel test).

- [ ] **Step 1: Read** `memory-graph-panel.tsx` (load → fetch → Cytoscape mount → `buildStylesheet`/`toElements`) + `claude-sessions-client.ts fetchSessionMemoryGraph`. Mirror.
- [ ] **Step 2: Test (component/bridge-injected, as the repo does GUI tests)** — data present → panel renders the graph (a node with the tool label + a memory node); empty → honest copy `No decision traces for this session yet — tracing is on by default; set MEGASAVER_SEAM_TRACE=false to disable.`
- [ ] **Step 3: Implement** `fetchDecisionTraceGraph(dir,id) = getJson(\`/api/claude-sessions/${enc(dir)}/${enc(id)}/decision-trace/graph\`)`; `DecisionTracePanel({dir,id})` mirroring the memory-graph panel (useEffect load → fetch → Cytoscape mount; `toElements`; `buildStylesheet` with distinct colors for `output`/`chunk`/`memory`/`redaction` nodes via CSS vars + hex fallbacks; loading/error/empty states; ResizeObserver refit). Register the `Trace` cockpit panel beside memory-graph.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Full `pnpm verify`, commit** `feat(gui): decision-trace Cytoscape panel`.

---

## Final gate

- `pnpm verify` green.
- Real smoke: in the worktree, enable tracing (default now), run a proxied read that triggers a memory boost, then `node apps/cli/dist/cli.js trace explain <session> --store <store>` shows the memory→context→score→output chain; and the bridge route returns a graph with a `memory` node. Capture output.
- Changeset: `@megasaver/output-filter` minor, `@megasaver/content-store` minor (or patch), `@megasaver/cli` minor, `@megasaver/gui` minor.
- code-reviewer + adversarial critic (fresh) over `main..HEAD`. Critic focus: join correctness (right evidence attached to right output; orphan handling; NOT joining on sessionId alone), tracing-default disk bound (prune actually fires + caps), no unhandled-rejection in the best-effort paths, empty-state honesty.

## Deferred
Per-selected-chunk memory attribution (chunkId on ChunkRef + per-chunk evidence); overlay-path traces; cross-session trace analytics; concept decoders.
