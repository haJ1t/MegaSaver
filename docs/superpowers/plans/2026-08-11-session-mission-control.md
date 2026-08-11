# Session Mission Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** `mega sessions live [--json]` and `GET /api/sessions/live` render the same live presence table — sessions, agent, cwdShort, branch, task, status (working/blocked/done), lastSeenAt, burn, claimWarnings — purely from daemon live-sessions + stats + optional claim registry. Read-only advisory.

**Architecture:** Pure table builder (`packages/daemon/src/live-table.ts`) + CLI io-injected reader + GUI poll route + panel. No control plane.

**Tech Stack:** TypeScript strict ESM, Zod strict, Vitest, citty, node:fs, Next.js API route, React, `@megasaver/daemon`, `@megasaver/stats`, `@megasaver/policy` (redact).

## Global Constraints

- Daemon is truth; CLI/GUI are renderers, never start daemon.
- Status derived from heartbeat age + last hook event (no agent declaration).
- Burn = 7d sum from stats, null → `n/a`.
- Claim warnings optional, count-only.
- Poll 5s, no websocket.
- Cwd shown as last-two-segments + redact.
- Pure builder ≤ 250 LOC, Zod strict.

---

### Task 1: pure live table + status derivation in daemon

**Files:**
- Create: `packages/daemon/src/live-table.ts`
- Modify: `packages/daemon/src/index.ts` (export)
- Test: `packages/daemon/test/live-table.test.ts`

**Interfaces:**
```ts
// packages/daemon/src/live-table.ts
export const liveTableSchema: z.ZodType<LiveTable>; // strict
export type LiveTable = z.infer<typeof liveTableSchema>;
export function buildLiveTable(input: {
  sessions: readonly { liveSessionId: string; agent: string; cwd: string; branch?: string; task?: string; lastSeenAt: string; lastHookEvent?: string }[];
  statsBurn: ReadonlyMap<string, number | null>;
  claimCounts?: ReadonlyMap<string, number>;
  now: ()=>number;
}): LiveTable;
export function deriveStatus(input: { lastSeenAt: string; lastHookEvent?: string; now: number }): "working"|"blocked"|"done";
export function shortCwd(cwd: string): string;
```

- [ ] Write failing test `packages/daemon/test/live-table.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildLiveTable, deriveStatus, liveTableSchema, shortCwd } from "../src/live-table.js";
describe("live table",()=>{
  it("sorts by lastSeenAt desc",()=>{
    const t=buildLiveTable({sessions:[{liveSessionId:"a",agent:"claude",cwd:"/a/b",lastSeenAt:"2026-08-11T00:00:00.000Z"},{liveSessionId:"b",agent:"codex",cwd:"/a/c",lastSeenAt:"2026-08-11T00:01:00.000Z"}],statsBurn:new Map(),now:()=>Date.parse("2026-08-11T00:02:00.000Z")});
    expect(t.sessions[0].liveSessionId).toBe("b");
  });
  it("derives blocked",()=>{ expect(deriveStatus({lastSeenAt:"2026-08-11T00:00:00.000Z",lastHookEvent:"blocked",now:Date.parse("2026-08-11T00:02:30.000Z")})).toBe("blocked"); });
  it("shortCwd",()=>{ expect(shortCwd("/a/b/c/d")).toBe("c/d"); expect(shortCwd("/a")).toBe("a"); });
  it("strict rejects extra",()=>{ expect(()=>liveTableSchema.parse({x:1})).toThrow(); });
});
```
- [ ] Run `pnpm --filter @megasaver/daemon exec vitest run test/live-table.test.ts` — FAIL
- [ ] Implement `live-table.ts` (status heartbeats: <60s working, 60s–5m blocked if event blocked else working, >5m done; shortCwd last-two, redact via policy helper is CLI's job — pure keeps raw)
- [ ] Export
- [ ] Run — PASS, plus `pnpm --filter @megasaver/daemon test` green
- [ ] Commit: `feat(daemon): live table builder`

---

### Task 2: CLI `mega sessions live`

**Files:**
- Create: `apps/cli/src/sessions/live.ts`
- Create: `apps/cli/src/commands/sessions/index.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `apps/cli/test/sessions-live.test.ts` + `apps/cli/test/commands/sessions-live.test.ts`

**Interfaces:**
```ts
export function runSessionsLive(input: { home: string; json?: boolean; stdout:(s:string)=>void; stderr:(s:string)=>void; now?: ()=>number }): Promise<0|1>;
```

- [ ] Write failing tests:
  - unit `sessions-live.test.ts` — pure buildLiveTable via CLI wrapper, same cases as daemon but with statsBurn/claimCounts.
  - `commands/sessions-live.test.ts` — seed tmp daemon file (`live-sessions.json` with 2 sessions, one blocked) + tmp stats → `runSessionsLive({json:true})` parses, status blocked present, burn numeric; missing daemon file → `no live sessions` exit 0.
- [ ] Run — FAIL
- [ ] Implement `live.ts` (read daemon file via `readFile` + Zod strict, fail-open to empty; read stats via `stats` ledger helper; optional `claims.json` read; call `buildLiveTable`; render human table vs JSON)
- [ ] Register `sessions live` in `main.ts`
- [ ] Run tests — PASS
- [ ] Commit: `feat(cli): mega sessions live`

---

### Task 3: GUI live panel + API route

**Files:**
- Create: `apps/gui/src/app/api/sessions/live/route.ts`
- Create: `apps/gui/src/components/SessionsLivePanel.tsx`
- Modify: `apps/gui/src/app/page.tsx` or sessions page (inject panel)
- Test: `apps/gui/test/sessions-live-route.test.ts` + `apps/gui/test/SessionsLivePanel.test.tsx`

**Interfaces:**
```ts
// route.ts
export async function GET(): Promise<Response>; // {liveTable} JSON strict 200
```

- [ ] Write failing tests:
  - route test — mock daemon file + stats → `GET()` returns 200, body validates `liveTableSchema`.
  - panel test — render with vitest + @testing-library/react, fake timers 5s interval calls fetch, badge shows `blocked` color.
- [ ] Run `pnpm --filter @megasaver/gui test` — FAIL
- [ ] Implement `route.ts` (same read + buildLiveTable as CLI, no writer) + `SessionsLivePanel.tsx` (useEffect interval 5s, table, status color, burn sparkline placeholder, claim badge)
- [ ] Run — PASS
- [ ] Commit: `feat(gui): sessions live panel`

---

### Task 4: changeset, wiki, verify

**Files:** `.changeset/session-mission-control.md`, `wiki/entities/cli.md`, `wiki/entities/gui.md`, `wiki/index.md`, `wiki/log.md`

- [ ] Add changeset (`@megasaver/daemon` minor, `@megasaver/cli` minor, `@megasaver/gui` minor)
- [ ] Update wiki (A5 mission control section, quick-links, log entry `## [2026-08-11] plan | wave-4 2of3`)
- [ ] Run `pnpm verify` — lint+typecheck+test green
- [ ] Smoke: seed daemon file 2 sessions → `mega sessions live --json` parses; `curl /api/sessions/live` 200
- [ ] Commit: `chore: changeset + wiki for mission control`
- [ ] Hand off to `code-reviewer`

---

## Self-review checklist

- [ ] no daemon start, read-only
- [ ] heartbeat-derived status, no agent declaration
- [ ] burn null → n/a, missing daemon → empty table exit 0
- [ ] cwd redacted, last-two-segments only
- [ ] strict Zod, Zod rejects extra keys
