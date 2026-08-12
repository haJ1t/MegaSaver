# Session Mesh Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the A1→A5 Session Mesh family sequentially — `@megasaver/mesh` package (files-are-truth), `mega mesh` CLI + 7 MCP tools, hook pull-delivery, daemon accelerator, plus blackboard, peer Q&A, and capability-aware handoff offer — all local, fail-open, redacted.

**Architecture:** New leaf package `@megasaver/mesh` owns `store/mesh/{presence,events.jsonl,claims,inbox,board,board-cursor,ask-state,quarantine}`. Files are truth; daemon `GET /mesh/status` is optional accelerator. Pull-based at-most-once inbox, advisory claims TTL 30m, repo-family scoping with `workspaceKey` fallback, every user text through `redact()` before persist.

**Tech Stack:** TypeScript strict ESM, Zod strict, Vitest (mkdtemp temp stores, injected `now()`, no timing-tight asserts), Citty CLI `workflows/cli-test-pattern`, `@megasaver/policy` redact, atomic `tmp+rename`, `encodeWorkspaceKey` + `familyKeyFromPath`.

## Global Constraints

- Risk HIGH (`2026-08-12-session-mesh-family-design.md:3`): worktree, TDD red→green per task, `architect` + `critic` per HIGH phase, `code-reviewer` AND `critic` separate passes (author≠reviewer), `pnpm verify` 60/60 + `conventions:check` green before merge, evidence-preserving only.
- `@megasaver/mesh` deps `shared + zod` only — no `core`, no `content-store`, no `stats` (`decisions/content-store-no-core-edge.md:1`). CLI/MCP layers may import `core` for promotion only (board `saveMemoryWithLineage`).
- All writes atomic `tmp+rename`, perms `0600`/`0700`, `events.jsonl` torn lines skipped, Windows rename-safe. Every hook entry `catch → exit 0`, bounded stdin `256 KiB`, `SECRET-REDACT` before persist (`packages/policy/src/redact.ts:44`).
- Contracts frozen at Phase 1: `meshMessageKind = message|ask|answer`, `presenceRecordSchema` strict, `events.jsonl` line format, inbox layout. Phase 4 alone additively extends with `handoff-offer`.
- Repo-family scoping: `familyKeyFromPath` `packages/context-gate/src/family-identity.ts:46` when resolvable, else `encodeWorkspaceKey(cwd)`. Match on `repositoryFamilyKey` when both carry it, else `workspaceKey` equality. `--all` widens.
- Hook hot-path guard: saver decision path adds no awaited mesh I/O (heartbeat fire-and-forget, debounced `≥5s`). Test must assert.
- CLI error policy: pinned `CliMessage` helpers in `apps/cli/src/errors.ts`, table + `--json` (`JSON.stringify(receipt,null,2)` on stdout, errors on stderr, `exit 0/1`).

---

### Task 1: `@megasaver/mesh` scaffold + schemas

**Files:**
- Create `packages/mesh/package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `src/types.ts`, `src/paths.ts`
- Create `packages/mesh/test/types.test.ts`

**Interfaces:**
```ts
export const presenceRecordSchema: z.ZodType<PresenceRecord> // .strict()
export type PresenceRecord = { liveSessionId:string; agent:string; status:"working"|"blocked"|"idle"|"done"; lastSeenAt:string; workspaceKey:string; repositoryFamilyKey?:string; cwd:string; branch?:string; task?:string }
export const meshEventSchema: z.ZodType<MeshEvent> // .strict(), kind: "message"|"ask"|"answer" (Task 9 adds "handoff-offer")
export const claimRecordSchema: z.ZodType<ClaimRecord>
export const boardFactSchema: z.ZodType<BoardFact> // Phase 7, but define here to freeze file
export function meshPaths(storeRoot:string): { presenceDir:string; eventsPath:string; claimsDir:string; inboxDir:string; boardDir:string; quarantineDir:string }
```

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { boardFactSchema, claimRecordSchema, meshEventSchema, presenceRecordSchema } from "../src/types.js";
describe("mesh schemas", () => {
  it("presence requires workspaceKey and strict rejects unknown", () => {
    const ok = { liveSessionId:"a1", agent:"claude-code", status:"working", lastSeenAt:new Date().toISOString(), workspaceKey:"0123456789abcdef", cwd:"/repo" };
    expect(presenceRecordSchema.safeParse(ok).success).toBe(true);
    expect(presenceRecordSchema.safeParse({ ...ok, extra:1 }).success).toBe(false);
  });
  it("meshEvent kind union is exactly message|ask|answer in Phase1", () => {
    const base = { id:"1", kind:"message", from:"a1", text:"hi", createdAt:new Date().toISOString() };
    expect(meshEventSchema.safeParse(base).success).toBe(true);
    expect(meshEventSchema.safeParse({ ...base, kind:"unknown" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** `pnpm --filter @megasaver/mesh test -- run` Expected: FAIL `Cannot find module ../src/types.js`
- [ ] **Step 3: Write minimal implementation** `packages/mesh/src/types.ts` Zod strict objects, `src/paths.ts` `join(storeRoot,"mesh",...)`, `src/index.ts` re-exports. `package.json` `name:@megasaver/mesh` `exports:./src/index.ts`, deps `shared,zod`.
- [ ] **Step 4: Run test to verify it passes** `pnpm --filter @megasaver/mesh test -- run` PASS, `pnpm --filter @megasaver/mesh typecheck` green
- [ ] **Step 5: Commit** `feat(mesh): scaffold package and schemas`

---

### Task 2: Mesh store ops — register/heartbeat/listPeers/gc/events

**Files:**
- Create `packages/mesh/src/store.ts`, `src/presence.ts`, `src/events.ts`, `src/gc.ts`
- Create `packages/mesh/test/presence.test.ts`, `test/events.test.ts`

**Interfaces:**
```ts
export function registerSession(storeRoot:string, rec:PresenceRecord): void // atomic tmp+rename, 0600
export function heartbeat(storeRoot:string, liveSessionId:string, patch?:Partial<Pick<PresenceRecord,"status"|"task">>): void // mtime debounce ≥5s, fire-and-forget
export function listPeers(storeRoot:string, filter:{workspaceKey?:string; repositoryFamilyKey?:string; all?:boolean}): PresenceRecord[] // staleness: stale>90s, dead>10m filtered, future skew → live
export function postEvent(storeRoot:string, evt:MeshEvent): void // appendFileSync, redacted text already
export function readEvents(storeRoot:string, opts:{since?:string; repo?:string}): MeshEvent[] // skip torn lines, filter by since, size cap
export function gc(storeRoot:string): { expiredPresence:number; expiredClaims:number; rotated:boolean }
```

- [ ] **Step 1: Write failing test**

```ts
import { mkdtemp, rm } from "node:fs/promises"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { listPeers, registerSession } from "../src/presence.js";
describe("presence", () => {
  let root=""; beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"mesh-"))}); afterEach(async()=>{await rm(root,{recursive:true,force:true})});
  it("register then list finds peer, dead filtered after 10m", () => {
    const now = Date.now(); const rec={ liveSessionId:"s1", agent:"claude-code", status:"working" as const, lastSeenAt:new Date(now).toISOString(), workspaceKey:"aaaaaaaaaaaaaaaa", cwd:"/repo" };
    registerSession(root, rec);
    expect(listPeers(root,{workspaceKey:"aaaaaaaaaaaaaaaa"})).toHaveLength(1);
    const old={...rec, liveSessionId:"s2", lastSeenAt:new Date(now-11*60*1000).toISOString()};
    registerSession(root, old);
    expect(listPeers(root,{workspaceKey:"aaaaaaaaaaaaaaaa"}).map(r=>r.liveSessionId)).toEqual(["s1"]);
  });
});
```

- [ ] **Step 2: Run test fails** `pnpm --filter @megasaver/mesh test` FAIL not implemented
- [ ] **Step 3: Implement** `presence.ts` `mkdirSync(presenceDir,{recursive:true})` `writeFileSync(tmp,JSON.stringify(rec)+"\n")` `renameSync`, `listPeers` `readdirSync` + `readFileSync` per file `safeParse` skip corrupt → quarantine, staleness `Date.parse(lastSeenAt)` future →0, `events.ts` `appendFileSync(eventsPath, JSON.stringify(evt)+"\n")`, `readEvents` `readFileSync` split `\n` `safeParse` skip, `gc.ts` `readdir` presence `lastSeenAt` >10m unlink, claims TTL 30m, `events.jsonl` >5MB or >7d rotate `rename + new`.
- [ ] **Step 4: Pass** `pnpm --filter @megasaver/mesh test` green, add GC rotation test
- [ ] **Step 5: Commit** `feat(mesh): presence, events, gc`

---

### Task 3: Messaging — sendMessage/drainInbox + redact + at-most-once

**Files:**
- Modify `packages/mesh/src/types.ts` (inbox message schema)
- Create `packages/mesh/src/inbox.ts`
- Create `packages/mesh/test/inbox.test.ts`

**Interfaces:**
```ts
export function sendMessage(storeRoot:string, input:{from:string; to:string|undefined; kind:"message"|"ask"|"answer"; text:string}): MeshEvent // redact text via policy before persist, fanout to inbox/<to> or broadcast to all live peers if to undefined, also append bus event
export function drainInbox(storeRoot:string, liveSessionId:string): MeshEvent[] // atomic: readdir inbox/<id>, read all, unlink via rename to quarantine, return parsed events
```

- [ ] **Step 1: Write failing test**

```ts
import { mkdtemp, rm } from "node:fs/promises"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { drainInbox, sendMessage } from "../src/inbox.js"; import { registerSession } from "../src/presence.js";
describe("inbox at-most-once", () => {
  let root=""; beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"mesh-"))}); afterEach(async()=>{await rm(root,{recursive:true,force:true})});
  it("send redacts secret and drain is at-most-once", () => {
    for(const id of ["a1","b1"]) registerSession(root,{ liveSessionId:id, agent:"claude-code", status:"working", lastSeenAt:new Date().toISOString(), workspaceKey:"aaaaaaaaaaaaaaaa", cwd:"/repo"});
    sendMessage(root,{from:"a1", to:"b1", kind:"message", text:"token: sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"});
    const first=drainInbox(root,"b1"); expect(first).toHaveLength(1); expect(first[0]!.text).not.toContain("sk-proj");
    expect(drainInbox(root,"b1")).toHaveLength(0); // second drain empty
  });
});
```

- [ ] **Step 2: Run fails** missing inbox
- [ ] **Step 3: Implement** `inbox.ts`: `import {redact} from "@megasaver/policy"` `const {redacted}=redact(input.text)` bounded `≤4000 chars` truncate, `randomUUID` msgId, `mkdirSync(inboxDir/id,{recursive:true})` `writeFileSync(join(inboxDir,id,msgId+".json"), JSON.stringify({id:msgId, ...redactedEvent}))`, broadcast when `to===undefined` → `listPeers` all live. `drainInbox`: `readdir` inbox dir, `readFileSync` parse, `unlinkSync` per file, return.
- [ ] **Step 4: Pass** `pnpm --filter @megasaver/mesh test` green, add concurrent drain test (two `drainInbox` calls, second empty)
- [ ] **Step 5: Commit** `feat(mesh): inbox send/drain at-most-once`

---

### Task 4: Claims — claimPaths/checkConflicts/releaseClaim

**Files:**
- Create `packages/mesh/src/claims.ts`
- Create `packages/mesh/test/claims.test.ts`

**Interfaces:**
```ts
export function claimPaths(storeRoot:string, input:{liveSessionId:string; paths:string[]; intent?:string}): ClaimRecord // repo-relative paths only, redact intent, TTL 30m, returns record
export function checkConflicts(storeRoot:string, liveSessionId:string, paths:string[]): ClaimRecord[] // live claims overlapping (exact or glob via policy compileGlob NFA)
export function releaseClaim(storeRoot:string, claimId:string): boolean
```

- [ ] **Step 1: Write failing test**

```ts
import { mkdtemp, rm } from "node:fs/promises"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { checkConflicts, claimPaths } from "../src/claims.js"; import { registerSession } from "../src/presence.js";
describe("claims", () => {
  let root=""; beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"mesh-"))}); afterEach(async()=>{await rm(root,{recursive:true,force:true})});
  it("conflict detected on overlapping path", () => {
    for(const id of ["a1","b1"]) registerSession(root,{ liveSessionId:id, agent:"claude-code", status:"working", lastSeenAt:new Date().toISOString(), workspaceKey:"aaaaaaaaaaaaaaaa", cwd:"/repo"});
    claimPaths(root,{liveSessionId:"a1", paths:["src/auth.ts"]});
    expect(checkConflicts(root,"b1",["src/auth.ts"]).length).toBe(1);
    expect(checkConflicts(root,"a1",["src/auth.ts"]).length).toBe(0); // own claim not conflict
  });
});
```

- [ ] **Step 2: Run fails**
- [ ] **Step 3: Implement** `claims.ts`: `mkdirSync(claimsDir)`, `claimId=randomUUID`, `expiresAt=new Date(Date.now()+30*60*1000).toISOString()`, write atomic, `checkConflicts` scans `claimsDir` `safeParse` skip corrupt→quarantine, filter `expiresAt > now` && `liveSessionId !== self` && `!listPeers dead` && path overlap (`===` or `compileGlob` NFA if path contains `*`).
- [ ] **Step 4: Pass**
- [ ] **Step 5: Commit** `feat(mesh): advisory claims`

---

### Task 5: CLI `mega mesh` + MCP 7 tools

**Files:**
- Create `apps/cli/src/commands/mesh/index.ts`, `status.ts`, `send.ts`, `claims.ts`, `events.ts`, `gc.ts`
- Modify `apps/cli/src/main.ts:72` add `mesh: meshCommand`
- Modify `apps/cli/src/errors.ts` add `meshUnavailableMessage`, `meshNoPeersMessage`
- Create `packages/mcp-bridge/src/tools/mesh.ts` (dispatch 7 tools) + modify `tool-name.ts`, `tool-schemas.ts`, `server.ts:143` register
- Create `apps/cli/test/mesh-cli.test.ts`, `packages/mcp-bridge/test/mesh-tools.test.ts`

**Interfaces:**
```ts
// CLI: mega mesh status [--all] [--follow]  mega mesh send <target> "<text>"  mega mesh claims [--repo]  mega mesh events [--since]  mega mesh gc
// MCP: mesh_claim, mesh_events, mesh_peers, mesh_poll, mesh_release, mesh_send, mesh_status_set
```

- [ ] **Step 1: Write failing CLI test**

```ts
import { mkdtemp, rm } from "node:fs/promises"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { runMeshStatus } from "../src/commands/mesh/status.js";
describe("mega mesh status", () => {
  let root=""; beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"mesh-cli-"))}); afterEach(async()=>{await rm(root,{recursive:true,force:true})});
  it("lists live peers table", async () => {
    const out:string[]=[]; await runMeshStatus({ storeFlag:root, cwd:"/repo", json:false, all:false, follow:false, stdout:(l)=>out.push(l), stderr:()=>{}, execGit:()=> { throw new Error("no git"); } });
    expect(out.join("\n")).toContain("peers");
  });
});
```

- [ ] **Step 2: Run fails** missing command
- [ ] **Step 3: Implement** Citty `defineCommand` per `workflows/cli-test-pattern`, `readStoreEnv` + `resolveStorePath` + `ensureStoreReady`, `listPeers` filtering `workspaceKey` via `encodeWorkspaceKey(cwd)` or `familyKeyFromPath(cwd)` when `all===false`, table render `liveSessionId | agent | cwdShort | status | age`. MCP `mesh.ts` branches on `kind`, validates via Zod, calls mesh package directly, `tool-name.ts` add 7 names alphabetically, `tool-schemas.ts` Zod `.strict()`.
- [ ] **Step 4: Pass** `pnpm --filter @megasaver/cli test`  + `pnpm --filter @megasaver/mcp-bridge test`
- [ ] **Step 5: Commit** `feat(cli,mcp): mesh commands and tools`

---

### Task 6: Hook integration + daemon accelerator

**Files:**
- Modify `apps/cli/src/hooks/warmup-run.ts` add `registerSession` call
- Modify `apps/cli/src/hooks/saver-run.ts` add `heartbeat` fire-and-forget debounced `≥5s` (mtime check)
- Modify `apps/cli/src/hooks/guard-run.ts` add `checkConflicts` → `additionalContext` warning + `drainInbox` → bounded injection `≤5/≤2000 tokens`
- Create `apps/cli/src/hooks/mesh-run.ts` as thin dispatcher if guard-run split needed (prefer in-place per spec)
- Modify `apps/cli/src/commands/hooks/install.ts` add managed block entries (no new process in Phase1, rides existing handlers)
- Modify `packages/daemon/src/server.ts` add `GET /mesh/status` + `packages/daemon/test/mesh-status.test.ts`
- Create `apps/cli/test/hooks/mesh-hooks.test.ts`

**Interfaces:**
```ts
export async function handleWarmup(payload:SessionStartPayload): Promise<void> // registerSession
export async function handleSaver(payload:PostToolUsePayload): Promise<void> // heartbeat fire-and-forget
export async function handleGuard(payload:PreToolUsePayload): Promise<{additionalContext?:string}> // conflict warn + drain
```

- [ ] **Step 1: Write failing hook test**

```ts
import { describe, expect, it } from "vitest";
import { handleGuard } from "../src/hooks/guard-run.js";
describe("guard-run mesh", () => {
  it("injects conflict warning and drains inbox bounded", async () => {
    const result = await handleGuard({ tool:"Edit", path:"src/auth.ts", storeRoot:"/tmp/mesh-test", liveSessionId:"a1" } as any);
    expect(result.additionalContext).toBeDefined();
  });
});
```

- [ ] **Step 2: Run fails**
- [ ] **Step 3: Implement** `warmup-run.ts` `registerSession(storeRoot,{liveSessionId, agent, workspaceKey:encodeWorkspaceKey(cwd), repositoryFamilyKey:familyKeyFromPath(cwd)??undefined, cwd, branch, task:intent})` wrapped `try{}catch{}` exit0, `saver-run.ts` `if(Date.now()-mtime<5000) return` else `heartbeat` without `await`, `guard-run.ts` `checkConflicts` on `payload.tool_input.file_path || command` → `additionalContext` `⚠️ peer a1 ... claimed src/auth.ts`, `drainInbox(liveSessionId).slice(0,5)` `render 2000 tokens` `labels untrusted peer text`. Daemon `server.ts` `if(req.url==="/mesh/status") return listPeers(...)` (only when `meshHub` present, else 404). Add hot-path guard test: `expect(saverPath).not.toContain("await heartbeat")`.
- [ ] **Step 4: Pass** `pnpm --filter @megasaver/cli test` + `pnpm --filter @megasaver/daemon test`
- [ ] **Step 5: Commit** `feat(cli,daemon): mesh hooks and status route`

---

### Task 7: Blackboard (board) inside mesh

**Files:**
- Create `packages/mesh/src/board/index.ts`, `board/schema.ts`, `board/store.ts`, `board/inject.ts`
- Create `apps/cli/src/commands/board/index.ts`, `post.ts`, `list.ts`, `resolve.ts`, `promote.ts`
- Modify `apps/cli/src/commands/hooks/board-run.ts` (or `mesh-run.ts`) add SessionStart digest + PreToolUse delta `BOARD_INJECT_MAX_TOKENS=500` `BOARD_DELTA_CHECK_INTERVAL_MS=30_000`
- Modify `packages/mcp-bridge/src/tools/board.ts`, `tool-name.ts`, `tool-schemas.ts`
- Create `packages/mesh/test/board.test.ts`, `apps/cli/test/board.test.ts`

**Interfaces:**
```ts
export function postFact(storeRoot:string, input:{text:string; topic:string; confidence:"low"|"medium"|"high"; scope:{repo:string; paths?:string[]}; expiresAt:string|null; liveSessionId:string}): BoardFact // redact, normalizeTopic, disputed handling
export function readBoardFacts(storeRoot:string, filter:{repo?:string; topic?:string; status?:string}): BoardFact[]
export function resolveFact(storeRoot:string, factId:string, note?:string): void
export function selectFactsForInjection(storeRoot:string, liveSessionId:string): {facts:BoardFact[]; tokens:number}
```

- [ ] **Step 1: Write failing test**

```ts
import { mkdtemp, rm } from "node:fs/promises"; import { join } from "node:path"; import { tmpdir } from "node:os";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { postFact, readBoardFacts } from "../src/board/store.js";
describe("board disputed", () => {
  let root=""; beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"board-"))}); afterEach(async()=>{await rm(root,{recursive:true,force:true})});
  it("cross-session same topic marks both disputed", () => {
    postFact(root,{text:"A", topic:"  API Z  ", confidence:"high", scope:{repo:"repo1"}, expiresAt:null, liveSessionId:"a1"});
    postFact(root,{text:"B", topic:"api z", confidence:"high", scope:{repo:"repo1"}, expiresAt:null, liveSessionId:"b1"});
    const facts=readBoardFacts(root,{repo:"repo1"}); expect(facts.filter(f=>f.status==="disputed")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run fails**
- [ ] **Step 3: Implement** `board/store.ts` `normalizeTopic=trim+toLowerCase+collapse whitespace`, scan `boardDir` active facts same `repo+normalizedTopic` different `liveSessionId` → mark both `status:disputed` `disputedWith:[otherId]`, same-session supersedes old `status:resolved`, `selectFactsForInjection` filters `active+high+unexpired` `estimatedTokens = redactedText.length/4` cap 500, cursor `board-cursor/<id>.json` debounce. CLI `mega board post "<text>" --topic <t> [--confidence] [--ttl] [--path]`, `promote` via `saveMemoryWithLineage` → `suggested` (CLI layer only, mesh never imports `core`).
- [ ] **Step 4: Pass**
- [ ] **Step 5: Commit** `feat(mesh,cli): structured blackboard`

---

### Task 8: Peer Q&A routing

**Files:**
- Create `packages/mesh/src/qa.ts`, `src/ask.ts`, `src/hint.ts`
- Modify `packages/mcp-bridge/src/tools/mesh.ts` add ask/answer kind routing inside `mesh_send`
- Create `apps/cli/src/commands/mesh/ask.ts`, `answer.ts`
- Create `apps/cli/src/hooks/mesh-hint.ts`
- Create `packages/mesh/test/qa.test.ts`

**Interfaces:**
```ts
export const askPayloadSchema, answerPayloadSchema, answerEvidenceSchema // answer requires provenance {liveSessionId,evidence,answeredAtMs}
export function postAsk(storeRoot:string, input:{from:string; text:string; workspaceKey:string}): PostAskResult // guards no_live_peers, rate 60s
export function extractKeywords(text:string): string[] // lowercased ≥4, stopword-filtered
export function matchPeerAnswer(prompt:string, recentEvents:MeshEvent[]): MeshEvent|undefined // ≥3 overlap, ≤200 events/30m
```

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { answerPayloadSchema } from "../src/qa.js";
describe("qa contract", () => {
  it("known:false without text is valid, known:true needs text", () => {
    expect(answerPayloadSchema.safeParse({ askId:"1", known:false, text:"", confidence:"high", provenance:{liveSessionId:"b1", evidence:{kind:"none"}, answeredAtMs:Date.now()}}).success).toBe(true);
    expect(answerPayloadSchema.safeParse({ askId:"1", known:true, text:"", confidence:"high", provenance:{liveSessionId:"b1", evidence:{kind:"none"}, answeredAtMs:Date.now()}}).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run fails**
- [ ] **Step 3: Implement** `qa.ts` Zod `.strict()` + `superRefine` known/text, `ask.ts` `ask-state/<sender>.json` atomic `recordAskPosted`, `postAsk` `listPeers` same `workspaceKey` sender excluded → `no_live_peers`, `mesh_send` `kind:"ask"` routes through `postAsk` fanout, `kind:"answer"` validates `text` is serialized `AnswerPayload` via `answerPayloadSchema` redact → asker inbox. `mesh-hint.ts` `extractKeywords` + `matchPeerAnswer` capped 500 chars `additionalContext`.
- [ ] **Step 4: Pass** integration `ask → fanout → drain → answer → asker drain` provenance intact, rate-limit second ask blocked
- [ ] **Step 5: Commit** `feat(mesh): peer Q&A`

---

### Task 9: Handoff capability + peers/offer

**Files:**
- Create `packages/connectors-shared/src/handoff-capability.ts`
- Modify `packages/connectors/generic-cli/src/targets.ts:4` add required `handoff:HandoffCapabilityProfile` to 6 targets + `apps/cli/src/known-targets.ts` for `CLAUDE_CODE_TARGET`
- Modify `apps/cli/src/commands/handoff/open.ts` add `evaluateHandoffFit` strict + `--fit` logic
- Modify `apps/cli/src/commands/handoff/pack.ts` add advisory fit line
- Create `apps/cli/src/commands/handoff/peers.ts`, `offer.ts`
- Modify `packages/mesh/src/types.ts` add `handoff-offer` to kind union (Phase4 amendment), `packages/stats/src/handoff-event.ts:16` add `"offer"` kind
- Create `packages/connectors-shared/test/handoff-capability.test.ts`, `apps/cli/test/handoff-fit.test.ts`

**Interfaces:**
```ts
export const handoffCapabilityProfileSchema: z.ZodType<HandoffCapabilityProfile> // {acceptsDiff:boolean; acceptsGitLine:boolean; maxBlockChars:number|null}
export function evaluateHandoffFit(input:{fields:HandoffBlockFields; profile:HandoffCapabilityProfile; mode:"strict"|"fit"}): {ok:boolean; refusals:{reason:"section_diff"|"section_git"|"block_too_large"; detail:string}[]; dropped?:("diffText"|"gitLine")[]}
```

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { evaluateHandoffFit } from "../src/handoff-capability.js";
describe("handoff fit", () => {
  it("strict refuses diff when profile rejects diff", () => {
    const fields={ gitLine:"main", diffText:"diff...", resume:"r", summary:"s" } as any;
    const profile={ acceptsDiff:false, acceptsGitLine:true, maxBlockChars:null };
    expect(evaluateHandoffFit({fields, profile, mode:"strict"}).ok).toBe(false);
    expect(evaluateHandoffFit({fields, profile, mode:"fit"}).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run fails**
- [ ] **Step 3: Implement** `handoff-capability.ts` measured on `renderHandoffBlockText(fields).length` sentinels included, `targets.ts` `codex/cursor/gemini/continue` all permissive, `windsurf {maxBlockChars:6000}`, `aider {acceptsDiff:false}`, `open.ts` after redaction assemble `fields` → `evaluateHandoffFit` → `exit 1` `error: <target> cannot consume...` remedy line, `--fit` drops `diffText`→`gitLine`. `peers` `listPeers` repo-scoped `encodeWorkspaceKey(cwd)` + `--packet` fit verdict, `offer` `gate("hot-handoff")` → `parseHandoffPacket` fail-closed → fit precheck → `sendMessage` `handoff-offer` pointer `never payload`.
- [ ] **Step 4: Pass** CLI integration `strict refusal byte-unchanged, --fit writes without diff`
- [ ] **Step 5: Commit** `feat(connectors,cli): handoff capability and offer`

---

### Task 10: Integration, changeset, verify, docs

**Files:**
- Create `.changeset/session-mesh-family.md`
- Modify `wiki/log.md` append entry, `wiki/index.md` if needed

- [ ] **Step 1: Run `pnpm verify`** — lint + typecheck + all tests (expect 60/60 Turbo, ~1900 tests) — paste tail into PR body.
- [ ] **Step 2: Smoke** two terminals: `mega mesh status --follow`, `mega mesh send`, `mega board post`, `mega mesh ask/answer`, `mega handoff peers --packet` + `offer` — capture.
- [ ] **Step 3: Request `code-reviewer` + `critic`** (HIGH, separate passes author≠reviewer) — fix findings, re-verify.
- [ ] **Step 4: Commit** `chore: changeset for session-mesh-family` + `docs(wiki): log session-mesh-family`

## Self-Review

- Spec coverage: every Locked Decision has a task (LD1 store → Tasks1-2, LD2 scope → Tasks1-5, LD3 pull → Tasks3+6, LD4 fail-open → Task6, LD5 TTL → Task4, LD6 familyKey → Tasks2+5, LD7 mesh package → Task1). Phases 2-4 map 1:1 to Tasks7-9, no gaps.
- Placeholder scan: none — every step has exact file paths and code blocks.
- Type consistency: `PresenceRecord` shape same in `types.ts` and `presence.ts`; `MeshEvent.kind` union extended only in Task9; `HandoffCapabilityProfile` field names match `targets.ts` usage.

