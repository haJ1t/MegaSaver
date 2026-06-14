# Live-First Phase 0: Telemetry surfacing

**Date:** 2026-06-14
**Status:** Spec — pending implementation
**Risk:** MEDIUM (read-only over Claude data; purely additive; no user-file writes, no project-model change). Reviewer may upgrade.
**Parent architecture:** [2026-06-14-live-first-architecture.md](./2026-06-14-live-first-architecture.md)

---

## 1. Goal & Depends on

**Goal.** Stop discarding the per-turn telemetry the live Claude Code transcript already carries (`message.model`, `message.usage`, line-level `gitBranch`) and the session metadata already on disk (`isArchived`, `model`, `permissionMode`, `lastActivityAt`); surface it as a read-only, transcript-derived telemetry panel + archived filter + cwd label in the existing `claude-sessions` view — without touching the project model.

**Depends on.** Nothing. Phase 0 is the root of the roadmap. It de-risks the live source before any shell rewrite (Phase 2) or store re-key (Phases 3–4). It does **not** depend on `workspaceKey` encoding or the overlay store.

---

## 2. Scope

### In scope
- **parse.ts / types** — `normalizeLine` retains per-turn telemetry **additively**: an optional `meta` field on `NormalizedMessage` carrying `{ model?, usage?, gitBranch? }`. The existing `{ role, ts, blocks }` shape is preserved byte-for-byte for current consumers (the SSE `message`/`snapshot` events, the GUI transcript renderer).
- **reader.ts / `ClaudeSessionMeta`** — `readSessionTitles` additionally reads `isArchived`, `model`, `permissionMode` from `local_*.json` (it already reads `lastActivityAt`); `ClaudeSessionMeta` gains `isArchived`, `model`, `permissionMode`, `lastActivityAt`. The metadata-gating behavior (sessions without `local_*.json` stay hidden) is unchanged.
- **Telemetry aggregator (new module)** — a pure function over normalized messages → token totals (in / out / cache-creation / cache-read), model mix (per-model turn counts), turn count, tool-call count, and duration (last `ts` − first `ts`), plus the session's `gitBranch`.
- **Bridge endpoint** — `GET /api/claude-sessions/:dir/:id/telemetry` returning the aggregate. (Decision §6.1: standalone endpoint, **not** folded into the snapshot.)
- **GUI** — read-only telemetry panel in `claude-sessions-view`; an "archived" filter (default: hide archived); cwd label already shown (`projectLabel`) — extend the list row to also badge `model` / archived state.
- **Tests** — Vitest unit (parse, reader, aggregator) + bridge route test, all TDD-first, matching existing `claude-sessions-*.test.ts` conventions.

### Out of scope (deferred to later phases)
- **cwd grouping / `/api/workspaces`** — Phase 1.
- **`workspaceKey` encoding + overlay store re-key** — Phases 3–4.
- **Token-saver / proxy byte-savings stats** — stays its own metric, re-keyed in Phase 4. This phase surfaces **LLM context tokens** from the transcript only; the two are different metrics and are not merged (architecture §2.4).
- **Session cockpit shell / removing the project gate** — Phase 2+. The panel here is added inside the existing `claude-sessions-view`, alongside the unchanged project UI.
- **SSE live-updating telemetry** — the telemetry endpoint is a one-shot read on the current transcript. Live recompute on tail is deferred (the existing 4 s list poll + manual reselect is sufficient for Phase 0).
- **`isSidechain` / `parentUuid` retention** — not needed for telemetry; left dropped.
- **Persisting any telemetry** — derived on read, never written.

---

## 3. File-level changes

| Action | Path | Responsibility |
|---|---|---|
| modify | `apps/gui/bridge/claude-sessions/types.ts` | Add `MessageMeta` + `SessionTelemetry` types; extend `NormalizedMessage` with optional `meta`; extend `ClaudeSessionMeta` with `isArchived`, `model`, `permissionMode`, `lastActivityAt`. |
| modify | `apps/gui/bridge/claude-sessions/parse.ts` | `normalizeLine` extracts `message.model`, `message.usage`, line `gitBranch` into an optional `meta` (omitted entirely when no signal — `exactOptionalPropertyTypes`). |
| modify | `apps/gui/bridge/claude-sessions/reader.ts` | `readSessionTitles` reads `isArchived`/`model`/`permissionMode`; `SessionTitle` + `listSessions` carry them onto `ClaudeSessionMeta`. |
| create | `apps/gui/bridge/claude-sessions/telemetry.ts` | Pure `aggregateTelemetry(messages: NormalizedMessage[]): SessionTelemetry`. |
| modify | `apps/gui/bridge/routes/claude-sessions.ts` | New `handleGetClaudeSessionTelemetry(ctx, dir, id)`: `safeSessionPath` guard → `readTranscript` → `aggregateTelemetry` → JSON (404 / 400 parity with `handleGetClaudeSession`). |
| modify | `apps/gui/bridge/handler.ts` | Route the `…/:id/telemetry` suffix to the new handler (regex extended; precedence before the generic `:dir/:id` match). |
| modify | `apps/gui/src/lib/claude-sessions-client.ts` | Mirror `MessageMeta`/`SessionTelemetry`/extended `ClaudeSessionMeta` types; add `fetchClaudeSessionTelemetry(dir, id)`. |
| modify | `apps/gui/src/views/claude-sessions-view.tsx` | Archived filter (default hide); telemetry panel (fetch on select); list-row `model` badge + archived badge. |
| create | `apps/gui/test/bridge/claude-sessions-telemetry.test.ts` | Unit tests for `aggregateTelemetry`. |
| modify | `apps/gui/test/bridge/claude-sessions-parse.test.ts` | Assert `meta` retained on assistant turns; assert `meta` omitted when absent; existing assertions stay green (additive). |
| modify | `apps/gui/test/bridge/claude-sessions-reader.test.ts` | Assert new metadata fields surface; `writeMeta` helper extended with optional `isArchived`/`model`/`permissionMode`. |
| modify | `apps/gui/test/bridge/claude-sessions-route.test.ts` | Assert `GET …/telemetry` 200 shape + 404 + 400 parity. |
| create | `.changeset/live-first-phase0-telemetry.md` | Patch/minor changeset (only if `@megasaver/gui` is treated as having a public surface — it is `private: true`, so a changeset is optional; add a `chore`-level note if the repo's changeset config requires every PR to carry one). |

**No changes** to `route-context.ts` (both Claude dirs are already injected), `@megasaver/core`, `@megasaver/shared`, or any other package. Phase 0 touches `apps/gui` only.

---

## 4. Data model & API changes

### 4.1 Types (`apps/gui/bridge/claude-sessions/types.ts`)

`message.usage` keys verified against a real transcript line:
`{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ... }`. `model` is a string under `message`; `gitBranch` is a **top-level line field** (sibling of `message`, can be `""`).

```ts
export type MessageUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type MessageMeta = {
  model?: string;
  usage?: MessageUsage;
  gitBranch?: string;
};

export type NormalizedMessage = {
  role: "user" | "assistant";
  ts: string;
  blocks: Block[];
  meta?: MessageMeta; // OPTIONAL — omitted entirely when no telemetry on the line
};

export type ClaudeSessionMeta = {
  dir: string;
  id: string;
  mtimeMs: number;
  size: number;
  title: string;
  projectLabel: string;
  // NEW (from desktop local_*.json; defaulted when absent):
  isArchived: boolean;       // default false
  model: string;             // default "" (the metadata's recorded model)
  permissionMode: string;    // default "" e.g. "default" | "acceptEdits" | "plan"
  lastActivityAt: number;    // already read internally; now surfaced (default 0)
};

export type ModelUsage = {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type SessionTelemetry = {
  turnCount: number;          // assistant + user renderable turns
  assistantTurns: number;
  toolCallCount: number;      // count of tool_use blocks across all turns
  totals: MessageUsage;       // summed over assistant turns that carry usage
  models: ModelUsage[];       // model mix, one row per distinct model, turn-desc
  firstTs: string;            // "" if no timestamps
  lastTs: string;
  durationMs: number;         // lastTs - firstTs, 0 when unknown
  gitBranch: string;          // first non-empty line gitBranch, else ""
};
```

**`exactOptionalPropertyTypes` rule:** `meta` and its sub-fields are added to the object **only when present** (build incrementally, never assign `undefined`). The existing `satisfies NormalizedMessage` on the `normalizeLine` return must keep compiling: build a `meta` object, and only spread `...(meta ? { meta } : {})` into the result.

### 4.2 Endpoint

```
GET /api/claude-sessions/:dir/:id/telemetry
→ 200  SessionTelemetry            (JSON, cache-control: no-store)
→ 400  validation_failed           (path traversal; same guard as snapshot)
→ 404  claude_session_not_found    (no transcript at dir/id)
→ 405  method_not_allowed          (non-GET)
→ 500  internal_error              (filesystem errno via sendReadError)
```

Example response (derived from a 2-turn session, haiku):
```json
{
  "turnCount": 2,
  "assistantTurns": 1,
  "toolCallCount": 1,
  "totals": { "inputTokens": 3, "outputTokens": 2,
              "cacheCreationInputTokens": 17499, "cacheReadInputTokens": 15204 },
  "models": [ { "model": "claude-haiku-4-5-20251001", "turns": 1,
                "inputTokens": 3, "outputTokens": 2,
                "cacheCreationInputTokens": 17499, "cacheReadInputTokens": 15204 } ],
  "firstTs": "2026-06-14T11:00:00.000Z",
  "lastTs": "2026-06-14T11:00:01.000Z",
  "durationMs": 1000,
  "gitBranch": "main"
}
```

No store paths or schemas change — Phase 0 is read-only over Claude's files and writes nothing.

### 4.3 Routing change (`handler.ts`)

The current matcher only knows `(\/stream)?`:
```ts
const claudeMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)(\/stream)?$/);
```
Extend the optional suffix group to an alternation so `/telemetry` is captured (still GET-only, still `decodeURIComponent` on dir/id):
```ts
const claudeMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)(\/stream|\/telemetry)?$/);
// ...
if (claudeMatch[3] === "/stream") {
  await handleStreamClaudeSession(ctx, dir, id);
} else if (claudeMatch[3] === "/telemetry") {
  await handleGetClaudeSessionTelemetry(ctx, dir, id);
} else {
  await handleGetClaudeSession(ctx, dir, id);
}
```
The non-greedy `([^/]+?)` already prevents the id group from swallowing the suffix.

---

## 5. Implementation tasks (TDD)

Run from repo root. Commands: `pnpm --filter @megasaver/gui test`, `pnpm --filter @megasaver/gui typecheck`, `npx biome check apps/gui` (or `pnpm lint`). Each task: red → run/expect fail → minimal impl → run/expect pass → `biome check` → commit. Keep commits atomic (one logical change each, imperative subject ≤ 50 chars).

---

### Task 1 — Retain per-turn telemetry in `parse.ts`

**Files:** modify `apps/gui/bridge/claude-sessions/types.ts`, `apps/gui/bridge/claude-sessions/parse.ts`; modify `apps/gui/test/bridge/claude-sessions-parse.test.ts`.

1. **Add types** to `types.ts`: `MessageUsage`, `MessageMeta`, and the optional `meta?` on `NormalizedMessage` (per §4.1). (Type-only change; no runtime.)
2. **Write failing tests** in `claude-sessions-parse.test.ts`:
   - assistant line with `message.model`, `message.usage`, top-level `gitBranch` → `msg.meta` equals
     `{ model, usage: { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }, gitBranch }`.
   - assistant line with **no** model/usage/gitBranch → `"meta" in (msg as object)` is `false` (omitted, not `undefined`).
   - **existing** assertions (the `toEqual({ role, ts, blocks })` cases) must still pass — they have no telemetry, so `meta` stays omitted.
3. **Run:** `pnpm --filter @megasaver/gui test claude-sessions-parse` → expect new cases red.
4. **Implement** in `parse.ts`. Extend `RawLine`/`RawMessage` with the read fields, add a `usage` extractor, build `meta` incrementally:

```ts
interface RawLine { type: unknown; message: unknown; timestamp: unknown; gitBranch: unknown; }
interface RawMessage { role: unknown; content: unknown; model: unknown; usage: unknown; }

interface RawUsage {
  input_tokens: unknown; output_tokens: unknown;
  cache_creation_input_tokens: unknown; cache_read_input_tokens: unknown;
}
function num(v: unknown): number { return typeof v === "number" ? v : 0; }
function usageFrom(value: unknown): MessageUsage | null {
  if (!isObject(value)) return null;
  const u = value as RawUsage;
  return {
    inputTokens: num(u.input_tokens),
    outputTokens: num(u.output_tokens),
    cacheCreationInputTokens: num(u.cache_creation_input_tokens),
    cacheReadInputTokens: num(u.cache_read_input_tokens),
  };
}

// inside normalizeLine, after blocks built:
const meta: MessageMeta = {};
if (typeof message.model === "string") meta.model = message.model;
const usage = usageFrom(message.usage);
if (usage) meta.usage = usage;
if (typeof line.gitBranch === "string" && line.gitBranch.length > 0) meta.gitBranch = line.gitBranch;
return {
  role, ts, blocks,
  ...(Object.keys(meta).length > 0 ? { meta } : {}),
} satisfies NormalizedMessage;
```

   WHY incremental build + conditional spread: `exactOptionalPropertyTypes` forbids assigning `undefined` to optional fields; omit them instead.
5. **Run:** `pnpm --filter @megasaver/gui test claude-sessions-parse` → green. `pnpm --filter @megasaver/gui typecheck`. `npx biome check apps/gui/bridge/claude-sessions/parse.ts apps/gui/bridge/claude-sessions/types.ts`.
6. **Commit:** `feat(gui): retain per-turn model/usage/branch in parse`.

> Note: the SSE `message`/`snapshot` events forward `NormalizedMessage` verbatim, so `meta` now rides the live stream for free — no route change needed for that.

---

### Task 2 — Surface session metadata in `reader.ts`

**Files:** modify `apps/gui/bridge/claude-sessions/types.ts` (done in T1) + `apps/gui/bridge/claude-sessions/reader.ts`; modify `apps/gui/test/bridge/claude-sessions-reader.test.ts`.

1. **Extend `ClaudeSessionMeta`** in `types.ts` with `isArchived`, `model`, `permissionMode`, `lastActivityAt` (per §4.1).
2. **Write failing tests** in `claude-sessions-reader.test.ts`:
   - extend the local `writeMeta(id, title, cwd?, extra?)` helper to write optional `isArchived`/`model`/`permissionMode` into `local_*.json`.
   - a session whose metadata has `isArchived: true, model: "claude-sonnet-4-6", permissionMode: "plan", lastActivityAt: 42` → `listSessions` row carries those exact values.
   - a session whose metadata omits them → `isArchived === false`, `model === ""`, `permissionMode === ""`, `lastActivityAt === 0`.
3. **Run:** `pnpm --filter @megasaver/gui test claude-sessions-reader` → red.
4. **Implement** in `reader.ts`:
   - Extend `SessionTitle`: `{ title; cwd; lastActivityAt; isArchived: boolean; model: string; permissionMode: string }`.
   - In `readSessionTitles`, widen the JSON cast and read the new fields with type-guarded defaults:

```ts
const isArchived = obj.isArchived === true;
const model = typeof obj.model === "string" ? obj.model : "";
const permissionMode = typeof obj.permissionMode === "string" ? obj.permissionMode : "";
titles.set(obj.cliSessionId, {
  title: obj.title,
  cwd: typeof obj.cwd === "string" ? obj.cwd : "",
  lastActivityAt, isArchived, model, permissionMode,
});
```
   - In `listSessions`, copy the four fields from `meta` onto the returned `ClaudeSessionMeta`. The "newest `lastActivityAt` wins" de-dupe stays.
5. **Run:** test green; `typecheck`; `biome check apps/gui/bridge/claude-sessions/reader.ts`.
6. **Commit:** `feat(gui): surface isArchived/model/permissionMode in session list`.

---

### Task 3 — Telemetry aggregator (pure)

**Files:** create `apps/gui/bridge/claude-sessions/telemetry.ts`; create `apps/gui/test/bridge/claude-sessions-telemetry.test.ts`.

1. **Add `ModelUsage` + `SessionTelemetry`** to `types.ts` (per §4.1).
2. **Write failing tests** in `claude-sessions-telemetry.test.ts` covering:
   - empty `[]` → zeroed totals, `models: []`, `turnCount: 0`, `firstTs/lastTs: ""`, `durationMs: 0`, `gitBranch: ""`.
   - two assistant turns, same model → `models` has one row, `turns: 2`, summed usage; `totals` = sum.
   - mixed models (haiku + sonnet) → two rows, sorted by `turns` desc.
   - `toolCallCount` = count of `tool_use` blocks (assert against a turn with 2 tool_use + 1 text → contributes 2).
   - user turns with no `meta` are counted in `turnCount` but contribute nothing to `totals`/`models`.
   - `durationMs` = `Date.parse(lastTs) - Date.parse(firstTs)`; `gitBranch` = first non-empty `meta.gitBranch`.
3. **Run:** `pnpm --filter @megasaver/gui test claude-sessions-telemetry` → red.
4. **Implement** `telemetry.ts`:

```ts
import type { MessageUsage, ModelUsage, NormalizedMessage, SessionTelemetry } from "./types.js";

function addUsage(a: MessageUsage, b: MessageUsage): MessageUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}
const ZERO: MessageUsage = {
  inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0,
};

export function aggregateTelemetry(messages: NormalizedMessage[]): SessionTelemetry {
  let totals = ZERO;
  let assistantTurns = 0;
  let toolCallCount = 0;
  let gitBranch = "";
  let firstTs = "";
  let lastTs = "";
  const byModel = new Map<string, ModelUsage>();

  for (const m of messages) {
    if (m.ts) {
      if (!firstTs) firstTs = m.ts;
      lastTs = m.ts;
    }
    for (const b of m.blocks) if (b.kind === "tool_use") toolCallCount++;
    const meta = m.meta;
    if (!meta) continue;
    if (gitBranch === "" && meta.gitBranch) gitBranch = meta.gitBranch;
    if (m.role === "assistant" && (meta.model || meta.usage)) assistantTurns++;
    const usage = meta.usage ?? ZERO;
    totals = addUsage(totals, usage);
    if (meta.model) {
      const row = byModel.get(meta.model) ?? { model: meta.model, turns: 0, ...ZERO };
      row.turns += 1;
      const merged = addUsage(row, usage);
      byModel.set(meta.model, { model: meta.model, turns: row.turns, ...merged });
    }
  }

  const durationMs =
    firstTs && lastTs ? Math.max(0, Date.parse(lastTs) - Date.parse(firstTs)) : 0;
  const models = [...byModel.values()].sort((a, b) => b.turns - a.turns);
  return {
    turnCount: messages.length,
    assistantTurns,
    toolCallCount,
    totals,
    models,
    firstTs,
    lastTs,
    durationMs,
    gitBranch,
  };
}
```
   WHY `ts` ordering by array position not sort: transcript lines are appended in order; `firstTs`/`lastTs` follow read order, matching the snapshot.
5. **Run:** test green; `typecheck`; `biome check apps/gui/bridge/claude-sessions/telemetry.ts`.
6. **Commit:** `feat(gui): add transcript telemetry aggregator`.

---

### Task 4 — Telemetry endpoint (bridge route + handler)

**Files:** modify `apps/gui/bridge/routes/claude-sessions.ts`, `apps/gui/bridge/handler.ts`; modify `apps/gui/test/bridge/claude-sessions-route.test.ts`.

1. **Write failing route tests** (seed an assistant line carrying `model`/`usage`/`gitBranch` in the test's `asstLine` helper):
   - `GET …/:dir/bbbb/telemetry` → 200, body `turnCount`, `totals.outputTokens`, `models[0].model` match the seed.
   - `GET …/:dir/zzzz/telemetry` → 404 `claude_session_not_found`.
   - `GET …/<traversal>/x/telemetry` → 400 `validation_failed`.
   - `POST …/:dir/bbbb/telemetry` → 405 `method_not_allowed`.
2. **Run:** `pnpm --filter @megasaver/gui test claude-sessions-route` → red (route 404s as unknown).
3. **Implement** in `routes/claude-sessions.ts`, mirroring `handleGetClaudeSession` exactly (same `safeSessionPath` pre-check, same 404 envelope, same `sendReadError`):

```ts
import { aggregateTelemetry } from "../claude-sessions/telemetry.js";

export async function handleGetClaudeSessionTelemetry(
  ctx: RouteContext, dir: string, id: string,
): Promise<void> {
  if ((await safeSessionPath(ctx.claudeProjectsDir, dir, id)) === null) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
    return;
  }
  try {
    const transcript = await readTranscript(ctx.claudeProjectsDir, dir, id);
    if (!transcript) {
      ctx.sendError(ctx.res, 404, "claude_session_not_found",
        `Claude Code session not found: ${dir}/${id}`, ctx.origin);
      return;
    }
    ctx.sendJson(ctx.res, 200, aggregateTelemetry(transcript.messages), ctx.origin);
  } catch (err) {
    sendReadError(ctx, err);
  }
}
```
4. **Wire the handler** (`handler.ts`) per §4.3: extend the regex suffix to `(\/stream|\/telemetry)?` and add the `else if (claudeMatch[3] === "/telemetry")` branch. Import `handleGetClaudeSessionTelemetry`. The GET-only guard already in place covers 405.
5. **Run:** route test green; full `pnpm --filter @megasaver/gui test` to confirm no regression in existing claude-sessions route tests; `typecheck`; `biome check apps/gui/bridge`.
6. **Commit:** `feat(gui): add GET claude-sessions telemetry endpoint`.

---

### Task 5 — Client types + fetcher

**Files:** modify `apps/gui/src/lib/claude-sessions-client.ts`.

1. **Mirror types** (the client keeps its own copies — it does not import from `bridge/`): add `MessageUsage`, `MessageMeta`, `ModelUsage`, `SessionTelemetry`, extend `ClaudeSessionMeta` (4 new fields) and `NormalizedMessage` (`meta?`).
2. **Add fetcher**:

```ts
export function fetchClaudeSessionTelemetry(dir: string, id: string): Promise<SessionTelemetry> {
  return getJson<SessionTelemetry>(
    `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/telemetry`,
  );
}
```
3. **Verify:** `pnpm --filter @megasaver/gui typecheck`; `biome check apps/gui/src/lib/claude-sessions-client.ts`. (No new unit test — exercised by the view test/manual smoke; the bridge route test already covers the contract.)
4. **Commit:** `feat(gui): add client telemetry types + fetcher`.

---

### Task 6 — GUI: telemetry panel, archived filter, badges

**Files:** modify `apps/gui/src/views/claude-sessions-view.tsx`.

1. **Archived filter:** add `showArchived` state (default `false`); derive `visibleSessions = sessions.filter(s => showArchived || !s.isArchived)`; render a small toggle in the sidebar header. Map over `visibleSessions` instead of `sessions`.
2. **Row badges:** in each session button, render `s.model` (short form, e.g. strip the date suffix) and an "archived" tag when `s.isArchived`, next to the existing live dot / `projectLabel` cwd label.
3. **Telemetry panel:** on `selected` change, `fetchClaudeSessionTelemetry(selected.dir, selected.id)` into a `telemetry` state (clear + refetch alongside the existing stream effect; ignore the result if `selected` changed — guard with the same dispose pattern). Render a compact read-only panel above the transcript: turn count, assistant turns, tool calls, duration (mm:ss), total in/out/cache tokens, model mix rows, git branch. Use existing Tailwind tokens (`text-text-muted`, `bg-surface`, `border-border`) to match the view.
4. **Verify (manual, jsdom optional):** `pnpm --filter @megasaver/gui typecheck`; `biome check apps/gui/src/views/claude-sessions-view.tsx`. If a `claude-sessions-view.test.tsx` is added, mock `fetchClaudeSessionTelemetry`; otherwise rely on the live smoke (DoD §7).
5. **Commit:** `feat(gui): telemetry panel + archived filter in sessions view`.

---

### Task 7 — Full verify + changeset

**Files:** create `.changeset/live-first-phase0-telemetry.md` (if required by changeset config).

1. **Run the DoD gate:** `pnpm verify` (lint + typecheck + test across the workspace) → green.
2. **Live smoke** (evidence): `pnpm --filter @megasaver/gui bridge` against real `~/.claude/projects`, then
   `curl -s localhost:<port>/api/claude-sessions | jq '.[0]'` (confirm `isArchived`/`model`/`permissionMode`/`lastActivityAt` present) and
   `curl -s localhost:<port>/api/claude-sessions/<dir>/<id>/telemetry | jq` (confirm non-zero `totals`/`models` on a real session). Capture output.
3. **Changeset:** add only if the repo's changeset config flags missing changesets in CI; `@megasaver/gui` is `private: true` so this is likely a `chore`-level note, not a version bump.
4. **Commit:** `chore(gui): changeset for phase0 telemetry` (if added).

---

## 6. Risks & decisions (this phase)

1. **Standalone telemetry endpoint vs folding into snapshot. Decision:** standalone `GET …/:id/telemetry`. The snapshot already streams the full message list (with `meta` now riding along), so a client *could* aggregate locally — but a dedicated endpoint keeps the contract testable in isolation, avoids forcing every snapshot consumer to recompute, and matches the architecture's "session telemetry (new)" service boundary (§3.2).
2. **`meta` additivity.** The single hard correctness constraint: existing `{ role, ts, blocks }` consumers (transcript renderer, SSE) must be untouched. Enforced by (a) `meta` being optional and **omitted** (not `undefined`) when absent, and (b) keeping the existing parse tests green unchanged. `exactOptionalPropertyTypes` makes the omit-vs-undefined distinction load-bearing — build `meta` incrementally and conditionally spread.
3. **Metadata field names unverified for `isArchived`/`permissionMode`.** Confirmed on real data: `cliSessionId`, `title`, `cwd`, `lastActivityAt`, `model`, `usage`, `gitBranch`. `isArchived` and `permissionMode` are asserted by the architecture's code map but not yet eyeballed in a `local_*.json` on this machine. **Mitigation:** all four reads are type-guarded with safe defaults (`false`/`""`), so a wrong/absent key degrades to a benign default rather than breaking the list. During live smoke (Task 7), grep a real `local_*.json` to confirm the exact key spelling and fix the guard if it differs.
4. **`usage` shape variance.** Real lines carry extra usage keys (`cache_creation.*`, `service_tier`, `inference_geo`); we read only the four numeric token fields and ignore the rest. `num()` coerces missing/non-number to `0`, so partial/early-write lines never throw.
5. **Token semantics.** This telemetry = **LLM context tokens** from the transcript, NOT the token-saver proxy byte-savings (architecture §2.4 / §6.1). The panel must be labeled as such to avoid conflation; token-saver stays a separate Phase 4 metric.
6. **No live recompute on tail.** Telemetry is a one-shot read; a long live session's panel goes stale until reselect. Accepted for Phase 0 (the list already polls every 4 s; reselect re-fetches). SSE-driven telemetry deferred.
7. **Security.** Read-only, no new filesystem surface beyond what `readTranscript` already reads through `safeSessionPath`. The telemetry route reuses the identical path-safety guard — no new traversal vector. No user-file writes.

---

## 7. Definition of done

Per `CLAUDE.md` §9, all must hold:

1. **Spec** — this file. **Plan** — derived into `docs/superpowers/plans/2026-06-14-live-first-phase0-telemetry-plan.md` before coding (`superpowers:writing-plans`).
2. **TDD** — every task wrote a failing test first (red → green), per the per-task steps above.
3. **`pnpm verify` green** — `biome check` + `tsc -b --noEmit` (project refs) + `vitest run` all pass, including the new and existing `claude-sessions-*.test.ts` suites.
4. **Feature smoke evidence (Task 7):** captured `curl` against the real bridge over `~/.claude/projects` showing (a) `GET /api/claude-sessions` now returns `isArchived`/`model`/`permissionMode`/`lastActivityAt`, and (b) `GET …/:dir/:id/telemetry` returns non-zero `totals` and a populated `models[]` for a real multi-turn session. Plus a screenshot of the telemetry panel + archived toggle in the running GUI.
5. **External reviewer pass** — `code-reviewer` (MEDIUM risk) in a fresh context; author ≠ reviewer.
6. **Verifier pass** — `omc:verify` confirms evidence matches claims.
7. **No project-model change** — confirm the diff touches only `apps/gui/**`; `@megasaver/core`, `projects.json`/`sessions.json`, `requireProject`, and the project-gated views are untouched (architecture §5 "Phase 0 … zero project changes").
8. **Zero pending TodoWrite items**; changeset added if CI requires one.
