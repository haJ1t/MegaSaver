# Manual Workspace Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GUI sol-ustte projeleri otomatik detect etmek yerine kullanici manuel olarak klasor ekleyip kaldirsin ve Sessions/liste sadece secili klasor(ler) icindeki sessionlari gostersin.

**Architecture:** `storeRoot/user-projects.json` yeni kalici kaynak olur; `GET/POST/DELETE /api/user-projects` bu dosyayi okur/yazar (Zod + exists + realpath + traversal). `listSessions` yeni `allowedRoots?: string[]` prefix filtresi kazanir ( `s.projectLabel === root || startsWith(root+sep)` ) ve `workspaceKey` filtresi ile intersect eder. Frontend `App.tsx` artik `fetchClaudeSessions(200)`-den `deriveWorkspaceOptions` ile tuketmez; `fetchUserProjects()` ile beslenir, `TopBar` Add/Remove + text input + `showDirectoryPicker` fallback UI sunar, `WorkspaceSessionList` zaten `activeKey` ile filtreli fetch ediyor — backend `allowedRoots` + `workspaceKey` (prefix via lookup) ikisini uygular.

**Tech Stack:** Node 22 LTS, TypeScript strict ESM, pnpm workspace, tsup (bridge external /^@megasaver\// /^node:/), Vitest, React 18 + Vite 5, Zod, `encodeWorkspaceKey` FNV-1a 64-bit hex (packages/shared)

**Spec:** User TR talebi: "gui detect etmeyecek, kullanici kendisi istedigi klasorleri secicek ve ona gore sectigi klasorun icinde hangi sessionlar var arayacak cunku bazi klasorler istegim disinda gozukuyor — user karar versin ekle/kaldir." Branch `fix/indexer-and-cli-bugs` uzerinde, PR yok. Onceki plan `2026-08-28-selected-workspace-session-filter-plan.md` Task 1-5 zaten dirty uygulandi; bu plan onun ustune eklenir ve onun `workspaceKey` exact filtresini korur + `allowedRoots` prefix filtresi ekler.

## Global Constraints

- Runtime: Node 22 LTS (.nvmrc)
- Language: TypeScript strict, ESM only, `moduleResolution: NodeNext`
- Package manager: pnpm (workspace:*)
- Build: tsup per-package + Turborepo
- Test: Vitest (`pnpm --filter @megasaver/gui exec vitest run <path>`)
- Lint+fmt: Biome
- Typecheck: `tsc -b --noEmit` ve `tsc -p tsconfig.test.json`
- CLI fwk: Citty
- Validation at boundaries: Zod
- No circular imports, one responsibility per file
- `workspaceKey` = FNV-1a 64-bit hex of cwd (`encodeWorkspaceKey` in `packages/shared/src/workspace-key.ts`, schema `workspaceKeySchema` = `/^[0-9a-f]{16}$/`)
- `projectLabel` = session.cwd (kanonik cwd, bos ise "(unknown)" -> filtre disi)
- `listSessions` limit 1..200, offset >=0
- Branch-only work, no PR, `verification-before-completion` zorunlu (fresh evidence)
- Preserve shipped fixes: `node:sqlite` createRequire, `.json` deny, `SIMPLE_DIR_DENYLIST`, harness-aware pagination `RESERVED_PER_HARNESS=2`, `homeDir` forwarding
- Store: `storeRoot = resolveBridgeStorePath({storeOverride, home, xdgDataHome...})` -> `~/.local/share/megasaver`; handler `storePath`; routes use `ctx.storeRoot`

---

### Task 1: Persistence — `storeRoot/user-projects.json` read/write helper

**Files:**
- Create: `apps/gui/bridge/user-projects-store.ts`
- Modify: `apps/gui/bridge/store-path.ts` (sadece gerekirse helper export)
- Test: `apps/gui/test/bridge/user-projects-store.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path` (`resolve`, `sep`), `node:fs` (`existsSync` optional), Zod
- Produces: `export async function readUserProjects(storeRoot: string): Promise<string[]>` ve `export async function writeUserProjects(storeRoot: string, paths: string[]): Promise<void>` ve `export async function addUserProject(storeRoot: string, rawPath: string): Promise<string[]>` ve `export async function removeUserProject(storeRoot: string, rawPath: string): Promise<string[]>` ; normalizasyon: `resolve` + `realpath` (varsa) + `existsSync` dir check; duplicate `===` ile reddet; persist `JSON.stringify({ paths }, null, 2)` atomic (tmp + rename). Zod: `z.object({ paths: z.array(z.string().min(1)) })` ; dosya yoksa `[]` doner; bozuk JSON -> `[]` + overwrite on next write (log yok, sessiz).

- [ ] **Step 1: Write failing test for store helper (TDD red)**

```ts
// apps/gui/test/bridge/user-projects-store.test.ts
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { addUserProject, readUserProjects, removeUserProject } from "../../bridge/user-projects-store.js";

describe("user-projects-store", () => {
  it("returns [] when file missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-store-"));
    try { expect(await readUserProjects(dir)).toEqual([]); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("add normalizes, dedupes, validates exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-store-"));
    const proj = mkdtempSync(join(tmpdir(), "megasaver-proj-"));
    try {
      const a = await addUserProject(dir, proj);
      expect(a).toEqual([proj]);
      const b = await addUserProject(dir, proj + "/");
      expect(b).toEqual([proj]); // trailing slash deduped via resolve
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); }
  });
  it("add rejects non-existent path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-store-"));
    try { await expect(addUserProject(dir, "/tmp/does-not-exist-zzz-" + Date.now())).rejects.toThrow(); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("remove drops entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-store-"));
    const proj = mkdtempSync(join(tmpdir(), "megasaver-proj-"));
    try { await addUserProject(dir, proj); const after = await removeUserProject(dir, proj); expect(after).toEqual([]); } finally { rmSync(dir, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (red)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/user-projects-store.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement minimal `user-projects-store.ts`**

```ts
// apps/gui/bridge/user-projects-store.ts
import { mkdir, readFile, writeFile, rename, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
const schema = z.object({ paths: z.array(z.string().min(1)) });
function storeFile(storeRoot: string){ return resolve(storeRoot, "user-projects.json"); }
async function normalize(p: string): Promise<string> {
  const r = resolve(p);
  // must exist and be a directory (existsSync + stat not needed if realpath succeeds)
  try { const real = await realpath(r); // resolves symlink
    // verify directory via existsSync fallback: if realpath succeeded, assume exists; extra check:
    if (!existsSync(real)) throw new Error("not found");
    return real;
  } catch { // fallback to lexical if not yet created? But we require exists -> throw
    if (!existsSync(r)) throw new Error(`Path does not exist: ${r}`);
    return r;
  }
}
export async function readUserProjects(storeRoot: string): Promise<string[]> {
  try { const txt = await readFile(storeFile(storeRoot), "utf8"); const j = JSON.parse(txt); const parsed = schema.safeParse(j); if(!parsed.success) return []; // dedupe + keep order
    const seen=new Set<string>(); const out:string[]=[]; for(const p of parsed.data.paths){ const n=resolve(p); if(!seen.has(n)){seen.add(n); out.push(n);} } return out; } catch { return []; }
}
export async function writeUserProjects(storeRoot: string, paths: string[]): Promise<void> {
  const file=storeFile(storeRoot); await mkdir(resolve(storeRoot), {recursive:true}); // storeRoot itself
  // normalize each via resolve (no exists check here; add/remove already validated)
  const seen=new Set<string>(); const out:string[]=[]; for(const p of paths){ const n=resolve(p); if(!seen.has(n)){seen.add(n); out.push(n);} }
  const tmp=file+".tmp."+Date.now(); await writeFile(tmp, JSON.stringify({paths: out}, null, 2), "utf8"); await rename(tmp, file);
}
export async function addUserProject(storeRoot: string, rawPath: string): Promise<string[]> {
  if(typeof rawPath!=="string" || rawPath.trim().length===0) throw new Error("path required");
  const norm=await normalize(rawPath.trim());
  // must be directory
  const { stat } = await import("node:fs/promises");
  const s=await stat(norm); if(!s.isDirectory()) throw new Error("Not a directory");
  // also reject if not absolute containment already handled by resolve; traversal not needed beyond resolve
  const cur=await readUserProjects(storeRoot);
  if(cur.includes(norm)) return cur;
  const next=[...cur, norm]; await writeUserProjects(storeRoot, next); return next;
}
export async function removeUserProject(storeRoot: string, rawPath: string): Promise<string[]> {
  const norm=resolve(rawPath.trim());
  const cur=await readUserProjects(storeRoot);
  const next=cur.filter(p=> resolve(p)!==norm);
  await writeUserProjects(storeRoot, next); return next;
}
```
Not: `normalize` icinde `realpath` + `stat` double-check; `existsSync` yerine `stat` daha guvenli. Gerekirse `sep` importu kalir.

- [ ] **Step 4: Run test to verify it passes (green)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/user-projects-store.test.ts
# Expected: PASS 4/4
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @megasaver/gui exec tsc -p tsconfig.test.json --noEmit
pnpm --filter @megasaver/gui exec tsc -b --noEmit
```

### Task 2: Bridge routes `GET/POST/DELETE /api/user-projects`

**Files:**
- Create: `apps/gui/bridge/routes/user-projects.ts`
- Modify: `apps/gui/bridge/handler.ts` (wire 3 routes)
- Test: `apps/gui/test/bridge/user-projects-route.test.ts`

**Interfaces:**
- Consumes: `readUserProjects`, `addUserProject`, `removeUserProject`, `encodeWorkspaceKey`, `workspaceLabel`, Zod
- Produces: `GET /api/user-projects` -> `200 { paths: string[], workspaces: { key, cwd, label }[] }` ; `POST /api/user-projects` body `{ path: string }` -> `200` or `400 validation_failed` or `404 not_found` (path yoksa) ; `DELETE /api/user-projects?path=...` veya body `{ path }` -> `200` . Tum handlerlar `try/catch` ile `handleCaughtError` veya `sendError(400)`.

- [ ] **Step 1: Write failing route test (TDD red)**

```ts
// apps/gui/test/bridge/user-projects-route.test.ts
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createBridgeHandler } from "../../bridge/handler.js";
import { startTestBridge } from "./test-helpers.js";
// helper: hatta supertest benzeri: use startTestBridge then fetch http://127.0.0.1:port/api/user-projects
it("CRUD cycle", async () => {
  const store = mkdtempSync(join(tmpdir(), "megasaver-store-"));
  const proj = mkdtempSync(join(tmpdir(), "megasaver-proj-"));
  const { url, close } = await startTestBridge({ storeRoot: store });
  try {
    let r = await fetch(`${url}/api/user-projects`); expect(await r.json()).toMatchObject({ paths: [] });
    r = await fetch(`${url}/api/user-projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: proj }) });
    expect(r.status).toBe(200);
    r = await fetch(`${url}/api/user-projects`); const j = await r.json(); expect(j.paths).toEqual([proj]); expect(j.workspaces[0].key).toMatch(/^[0-9a-f]{16}$/);
    r = await fetch(`${url}/api/user-projects?path=${encodeURIComponent(proj)}`, { method: "DELETE" }); expect(r.status).toBe(200);
    r = await fetch(`${url}/api/user-projects`); expect((await r.json()).paths).toEqual([]);
  } finally { await close(); rmSync(store,{recursive:true,force:true}); rmSync(proj,{recursive:true,force:true}); }
});
it("POST rejects non-existent", async () => {
  const store = mkdtempSync(join(tmpdir(), "megasaver-store-"));
  const { url, close } = await startTestBridge({ storeRoot: store });
  try { const r = await fetch(`${url}/api/user-projects`, { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({path:"/tmp/nope-"+Date.now()}) }); expect(r.status).toBe(400); } finally { await close(); rmSync(store,{recursive:true,force:true}); }
});
```

- [ ] **Step 2: Run test to verify it fails (red)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/user-projects-route.test.ts
# Expected: FAIL — route not found 404 or module missing
```

- [ ] **Step 3: Implement `routes/user-projects.ts` + wire in `handler.ts`**

```ts
// apps/gui/bridge/routes/user-projects.ts
import { z } from "zod";
import { encodeWorkspaceKey, workspaceLabel } from "@megasaver/shared";
import { addUserProject, readUserProjects, removeUserProject } from "../user-projects-store.js";
import type { RouteContext } from "../route-context.js";
const postSchema = z.object({ path: z.string().min(1) });
export async function handleGetUserProjects(ctx: RouteContext): Promise<void> {
  const paths = await readUserProjects(ctx.storeRoot);
  const workspaces = paths.map(cwd => ({ key: encodeWorkspaceKey(cwd), cwd, label: workspaceLabel(cwd) }));
  ctx.sendJson(ctx.res, 200, { paths, workspaces }, ctx.origin);
}
export async function handlePostUserProjects(ctx: RouteContext): Promise<void> {
  let body: unknown; try{ body = await import("./_body.js").then(m=>m.readJsonBody(ctx.req)); } catch { ctx.sendError(ctx.res,400,"validation_failed","Invalid JSON",ctx.origin); return; }
  // Note: readJsonBody already called by handler? If handler centralizes, adapt to ctx.query/body pattern. Simpler: read again.
  // Use Zod
  const parsed = postSchema.safeParse(body); if(!parsed.success){ ctx.sendError(ctx.res,400,"validation_failed","Invalid path",ctx.origin, parsed.error.issues); return; }
  try { const next = await addUserProject(ctx.storeRoot, parsed.data.path); const workspaces = next.map(cwd=>({key:encodeWorkspaceKey(cwd),cwd,label:workspaceLabel(cwd)})); ctx.sendJson(ctx.res,200,{paths:next, workspaces},ctx.origin); } catch(e){ ctx.sendError(ctx.res,400,"validation_failed", e instanceof Error? e.message:"Invalid path",ctx.origin); }
}
export async function handleDeleteUserProjects(ctx: RouteContext): Promise<void> {
  const raw = ctx.query.get("path") ?? "";
  // also support JSON body for DELETE
  let path = raw;
  if(!path){
    try{ const b = await import("./_body.js").then(m=>m.readJsonBody(ctx.req)) as {path?:unknown}; if(typeof b?.path==="string") path=b.path; } catch{}
  }
  if(!path){ ctx.sendError(ctx.res,400,"validation_failed","path required",ctx.origin); return; }
  const next = await removeUserProject(ctx.storeRoot, path);
  const workspaces = next.map(cwd=>({key:encodeWorkspaceKey(cwd),cwd,label:workspaceLabel(cwd)}));
  ctx.sendJson(ctx.res,200,{paths:next, workspaces},ctx.origin);
}
```
`handler.ts` icine ekle ( `/api/user-projects` 3 method ): `if (path === "/api/user-projects") { if(method==="GET") await handleGetUserProjects(ctx); else if(method==="POST") await handlePostUserProjects(ctx); else if(method==="DELETE") await handleDeleteUserProjects(ctx); else methodNotAllowed...; return; }`

- [ ] **Step 4: Run test to verify it passes (green)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/user-projects-route.test.ts
# Expected: PASS
```

- [ ] **Step 5: Run other bridge tests to ensure no regression**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/
```

### Task 3: Backend filtering — `allowedRoots` prefix in `reader.ts` + `workspaceKey` prefix via lookup

**Files:**
- Modify: `apps/gui/bridge/claude-sessions/reader.ts`
- Modify: `apps/gui/bridge/routes/claude-sessions.ts`
- Test: `apps/gui/test/bridge/claude-sessions-reader.test.ts` (yeni 2 test)

**Interfaces:**
- Consumes: `readUserProjects` (lazy import to avoid circular), `encodeWorkspaceKey`
- Produces: `listSessions(root, metaDir, opts: { limit, offset, storeRoot?, harness?, workspaceKey?, allowedRoots?: string[], homeDir? })` . Filtering sirasi: 1) `allowedRoots` prefix (bos degilse; `projectLabel === root || startsWith(root+sep)` ; bos `projectLabel` elenir), 2) `workspaceKey` exact *or* prefix via lookup (eger `allowedRoots` icinde key'e karsilik gelen path varsa prefix, yoksa exact hash karsilastirma), 3) `harness`, sonra harness-aware pagination.

- [ ] **Step 1: Write failing test for allowedRoots prefix (TDD red)**

```ts
// apps/gui/test/bridge/claude-sessions-reader.test.ts ekle (mevcut describe icine)
it("filters by allowedRoots prefix (folder inside)", async () => {
  // /Users/me/proj ve /Users/me/proj/sub icin iki session var gibi simule: meta ccc cwd=/Users/me/proj/sub
  const other = join(root, DIR, "cccc.jsonl");
  writeFileSync(other, `${userLine("sub proj", "2026-06-14T12:00:00.000Z")}\n`);
  writeMeta("cccc", "Sub", "/Users/me/proj/sub", { lastActivityAt: 2 });
  utimesSync(other, new Date("2026-06-14T12:00:00Z"), new Date("2026-06-14T12:00:00Z"));
  const filtered = await listSessions(root, metaDir, { limit: 50, offset: 0, allowedRoots: ["/Users/me/proj"] });
  expect(filtered.map(s=>s.id).sort()).toEqual(["aaaa","bbbb","cccc"].sort()); // prefix includes sub
  const none = await listSessions(root, metaDir, { limit: 50, offset: 0, allowedRoots: ["/Users/me/other"] });
  expect(none).toEqual([]);
});
it("allowedRoots + workspaceKey intersect (prefix)", async () => {
  const keyProj = encodeWorkspaceKey("/Users/me/proj");
  const r = await listSessions(root, metaDir, { limit: 50, offset: 0, allowedRoots: ["/Users/me/proj"], workspaceKey: keyProj });
  expect(r.every(s=> s.projectLabel.startsWith("/Users/me/proj"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails (red)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/claude-sessions-reader.test.ts -t "allowedRoots"
# Expected: FAIL — opts.allowedRoots ignored
```

- [ ] **Step 3: Implement minimal fix in `reader.ts`**

```ts
// apps/gui/bridge/claude-sessions/reader.ts
// 1) opts tipine allowedRoots?: string[] ekle
// 2) filtering blogunu degistir:
let filtered = allSessions;
// allowedRoots prefix: user-selected klasorlerin icindeki sessionlar
if (opts.allowedRoots && opts.allowedRoots.length > 0) {
  const roots = opts.allowedRoots.map(r => resolve(r)); // normalize lexical
  filtered = filtered.filter(s => {
    if (!s.projectLabel) return false;
    const label = resolve(s.projectLabel);
    return roots.some(root => label === root || label.startsWith(root + sep));
  });
}
if (opts.workspaceKey) {
  // workspaceKey exact, ama allowedRoots varsa prefix'e de izin ver (lookup)
  // Eger allowedRoots icinde bu key'e karsilik gelen path varsa, onu prefix olarak kullan
  let prefixRoot: string | null = null;
  if (opts.allowedRoots && opts.allowedRoots.length > 0) {
    for (const r of opts.allowedRoots) {
      try { if (encodeWorkspaceKey(resolve(r)) === opts.workspaceKey) { prefixRoot = resolve(r); break; } } catch {}
    }
  }
  if (prefixRoot) {
    filtered = filtered.filter(s => {
      if (!s.projectLabel) return false;
      const label = resolve(s.projectLabel);
      return label === prefixRoot || label.startsWith(prefixRoot + sep);
    });
  } else {
    filtered = filtered.filter(s => {
      if (!s.projectLabel) return false;
      try { return encodeWorkspaceKey(s.projectLabel) === opts.workspaceKey; } catch { return false; }
    });
  }
}
if (opts.harness) { filtered = filtered.filter(s => s.harness === opts.harness); }
// harness-aware pagination aynen kalir, sorted = filtered.sort(...)
```

- [ ] **Step 4: Update `routes/claude-sessions.ts` to inject `allowedRoots` from store**

```ts
// apps/gui/bridge/routes/claude-sessions.ts handleListClaudeSessions icinde:
import { readUserProjects } from "../user-projects-store.js";
const allowedRoots = await readUserProjects(ctx.storeRoot); // empty => []
const listOpts: { limit:number; offset:number; storeRoot?:string; harness?:string; workspaceKey?:string; allowedRoots?:string[]; homeDir?:string } = {
  limit, offset, storeRoot: ctx.storeRoot, ...(ctx.homeDir!==undefined?{homeDir:ctx.homeDir}:{}),
  ...(allowedRoots.length>0? {allowedRoots}: {}), // empty => no filter (bootstrap)? Karar: empty => [] ile filtre uygula -> 0 sonuc, ama testler storeRoot olmadan cagiriyor; bu yuzden sadece storeRoot varsa ekle
};
// Eger storeRoot yoksa (testlerin bir kismi) allowedRoots ekleme -> backward compat
// Eger storeRoot var ama allowedRoots empty ve user henuz secim yapmadiysa: filtre uygulama? Spec "gui detect etmeyecek" diyor, bosken 0 gostermeli. Ama test izolasyonu icin allowedRoots.length>0 sarti yeterli: bosken filtre yok -> eski davranis. Frontend bos state'i ayri gosterir.
// Tercih: bosken filtre YOK say, frontend "Add project" bos state gosterir ama sessions endpoint yine tumunu doner; frontend allowedRoots bosken sessions listesini de bos gosterir (client-side guard). Bu testleri kirmaz.
```
Ledger ruling: bos `user-projects.json` backend'de filtre UYGULAMAZ (test uyumu), ama frontend `paths.length===0` iken sessions listesini render etmez ve "No project selected — add a folder" gosterir. Ileride istenirse backend de sifira indirebilir.

- [ ] **Step 5: Run tests to verify it passes (green)**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/claude-sessions-reader.test.ts -t "allowedRoots"
# Expected: PASS
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/claude-sessions-reader.test.ts
# Expected: all PASS (14 existing + 2 new)
```

- [ ] **Step 6: Verify route still handles `workspaceKey` invalid 400**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/claude-sessions-route.test.ts 2>&1 | tail -20
```

### Task 4: Frontend — `App.tsx` + `TopBar` + `user-projects-client.ts` manuel secim

**Files:**
- Create: `apps/gui/src/lib/user-projects-client.ts`
- Modify: `apps/gui/src/components/top-bar.tsx`
- Modify: `apps/gui/src/app.tsx`
- Modify: `apps/gui/src/lib/workspace-context.ts` (deprecate derive, add `deriveFromPaths`)
- Modify: `apps/gui/src/views/workspace-session-list.tsx` (bos state mesaji)
- Test: `apps/gui/test/gui/user-projects-client.test.ts` (opsiyonel, fetch mock)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/user-projects`, `encodeWorkspaceKey`, `workspaceLabel` (shared), `fetchClaudeSessions`
- Produces: `fetchUserProjects(): Promise<{paths:string[], workspaces:WorkspaceOption[]}>`, `addUserProject(path): Promise<...>`, `removeUserProject(path): Promise<...>` ; `App.tsx` state: `workspaces: WorkspaceOption[]`, `activeKey: string|null`, `userPaths: string[]` ; `TopBar` props: `options`, `activeKey`, `onWorkspaceChange`, `onAddProject(path)`, `onRemoveProject(path)`, `liveCount`.

- [ ] **Step 1: Create `user-projects-client.ts` (no test yet, typecheck only)**

```ts
// apps/gui/src/lib/user-projects-client.ts
import { getJson } from "./api-client.js"; // mevcut helper varsa; yoksa fetch wrapper
import type { WorkspaceOption } from "./workspace-context.js";
export type UserProjectsResponse = { paths: string[]; workspaces: { key:string; cwd:string; label:string }[] };
export function fetchUserProjects(): Promise<UserProjectsResponse> { return getJson<UserProjectsResponse>("/api/user-projects"); }
export async function addUserProject(path: string): Promise<UserProjectsResponse> {
  const r = await fetch("/api/user-projects", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ path }) });
  if(!r.ok) throw await r.json(); return r.json() as Promise<UserProjectsResponse>;
}
export async function removeUserProject(path: string): Promise<UserProjectsResponse> {
  const r = await fetch(`/api/user-projects?path=${encodeURIComponent(path)}`, { method:"DELETE" });
  if(!r.ok) throw await r.json(); return r.json() as Promise<UserProjectsResponse>;
}
```

- [ ] **Step 2: Update `workspace-context.ts` to support paths**

```ts
// apps/gui/src/lib/workspace-context.ts ekle:
export function deriveWorkspaceOptionsFromPaths(paths: string[]): WorkspaceOption[] {
  return paths.map(cwd => ({ key: encodeWorkspaceKey(cwd), cwd, label: cwd.split("/").filter(Boolean).at(-1) ?? cwd, rep: { dir: "", id: "" } as any }));
}
// deriveWorkspaceOptions (sessions tabanli) deprecated kalsin ama silinmesin (geriye uyum)
```

- [ ] **Step 3: Update `TopBar` with Add/Remove UI**

```tsx
// apps/gui/src/components/top-bar.tsx degisiklik:
// Props ekle: onAddProject: (path:string)=>void, onRemoveProject: (path:string)=>void
// State: showAdd: boolean, inputPath: string, error: string|null
// Dropdown icine her option satirinda sil (x) butonu: onClick e.stopPropagation() + onRemoveProject(o.cwd)
// Dropdown altina: "+ Add project" butonu -> input + Save/Cancel
// Input: <input placeholder="/absolute/path" value={inputPath} onChange... /> Save onClick => onAddProject(inputPath.trim())
// Bonus: if ("showDirectoryPicker" in window) Add butonu directory picker dener, fallback input
// Bos state: options.length===0 => button label "Add project" ve disabled degil, tiklayinca input acilir
```

- [ ] **Step 4: Update `App.tsx` to use `fetchUserProjects` instead of deriving from sessions**

```tsx
// apps/gui/src/app.tsx
// Eski: useEffect tick fetchClaudeSessions(200).then(list=>{setSessions(list); setWorkspaces(deriveWorkspaceOptions(list)); ...})
// Yeni:
import { fetchUserProjects, addUserProject, removeUserProject } from "./lib/user-projects-client.js";
// State: workspaces zaten var, sessions ayri poll olur ama workspaces artik user-projects'ten:
useEffect(()=>{
  let live=true;
  const tick = ()=>{
    void fetchUserProjects().then(r=>{ if(!live) return; const opts = r.workspaces.map(w=>({key:w.key, cwd:w.cwd, label:w.label, rep:{dir:"",id:""}} as WorkspaceOption)); setWorkspaces(opts); setActiveKey(k=> k ?? opts[0]?.key ?? null); }).catch(()=>{});
    void fetchClaudeSessions(activeKey? 200 : 200, 0, undefined, activeKey ?? undefined) // sessions polling ayri effect'e tasinabilir
      .then(list=>{ if(!live) return; setSessions(list); }).catch(()=>{});
    if(live) setNowMs(Date.now());
  };
  tick(); const t=setInterval(tick, 4000); return ()=>{live=false; clearInterval(t);};
}, [activeKey]);
// Ayrica: TopBar onAddProject/onRemoveProject handlerlari App.tsx'de tanimla ve fetchUserProjects ile state guncelle
```
Sadelestirme: sessions poll'u ayri `useEffect([activeKey])` icinde de olabilir; tek effect icinde `activeKey` depsiz de olur ama lint icin ayir.

- [ ] **Step 5: Update `WorkspaceSessionList` empty state**

```tsx
// apps/gui/src/views/workspace-session-list.tsx
// activeKey null veya workspaces empty iken: "No project selected. Add a folder from the top bar to see its sessions." goster
// fetchClaudeSessions zaten activeKey ile filtreli; bosken 200,0 ile cagirsa bile backend allowedRoots bos oldugu icin tumu gelebilir — bu yuzden bos state'de listeyi bos goster (client guard)
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @megasaver/gui exec tsc -b --noEmit
```

### Task 5: Build & verification (verification-before-completion)

**Files:** Build artifacts `apps/gui/dist`, `apps/gui/dist-bridge`, `apps/cli/dist-bundle/gui`

- [ ] **Step 1: Build GUI + bridge**

```bash
pnpm --filter @megasaver/gui build
```

- [ ] **Step 2: Copy GUI dist to CLI bundle and rebuild CLI**

```bash
node apps/cli/scripts/copy-gui-dist.mjs
npx tsup --config apps/cli/tsup.bundle.config.ts
node apps/cli/scripts/copy-gui-dist.mjs
```

- [ ] **Step 3: Evidence — backend unit tests**

```bash
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/user-projects-store.test.ts apps/gui/test/bridge/user-projects-route.test.ts apps/gui/test/bridge/claude-sessions-reader.test.ts
# Expected: all PASS (store 4 + route 2 + reader 16)
```

- [ ] **Step 4: Evidence — live handler prefix check (tsx direct)**

```bash
npx tsx -e "
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from './apps/gui/bridge/claude-sessions/reader.js';
// create temp root/meta with two cwds: /tmp/proj ve /tmp/proj/sub
"
```

- [ ] **Step 5: Evidence — manual curl against running bridge**

```bash
# storeRoot temp ile bridge ayaga kaldir, POST /api/user-projects ile /tmp/proj ekle, sonra /api/claude-sessions sadece o root icindekileri dondurmeli
curl -s http://127.0.0.1:<port>/api/user-projects | jq
curl -s http://127.0.0.1:<port>/api/claude-sessions?limit=50 | jq 'map(.projectLabel) | unique'
```

- [ ] **Step 6: Full verify gate**

```bash
pnpm --filter @megasaver/gui exec tsc -b --noEmit
pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/ --reporter=verbose 2>&1 | tail -40
```

