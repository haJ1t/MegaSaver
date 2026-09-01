# Selected Workspace Session Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sol ustte secilen proje (TopBar activeKey) sadece o projenin sessionlarini gosterecek; Sessions sayfasi tum projeleri listemeyecek.

**Architecture:** Backend `listSessions` workspaceKey filtresi ekler (encodeWorkspaceKey(projectLabel) karsilastirmasi, harness filtresinden once), route `workspaceKey` query paramini dogrular ve iletir, client buna uygun query kurar, frontend `App.tsx` `activeKey` i `WorkspaceSessionList` e aktarir ve component filtreli fetch yapar. Mevcut `harness-aware` pagination workspace filtrelemesinden sonra calisir.

**Tech Stack:** Node 22 LTS, TypeScript strict ESM, pnpm workspace, tsup (bridge external /^@megasaver\// /^node:/), Vitest, React 18 + Vite 5, Zod (workspaceKeySchema)

**Spec:** N/A - dogrudan bugfix: kullanici raporu "sol ustte secilen proje dizini yerine her projenin sessionlari gozukuyor" (branch `fix/indexer-and-cli-bugs` ustunde calisiliyor; PR yok)

## Global Constraints

- Runtime: Node 22 LTS (.nvmrc)
- Language: TypeScript strict, ESM only, `moduleResolution: NodeNext`
- Package manager: pnpm (workspace:*)
- Build: tsup per-package + Turborepo
- Test: Vitest
- Lint+fmt: Biome
- Typecheck: tsc --noEmit (project references)
- CLI fwk: Citty
- Validation at boundaries: Zod (`workspaceKeySchema` 16 hex lowercase)
- No circular imports, one responsibility per file
- `workspaceKey` = FNV-1a 64-bit hex of cwd (`encodeWorkspaceKey` in `packages/shared/src/workspace-key.ts`), `projectLabel` = session.cwd (kanonik cwd)
- `listSessions` limit 1..200, offset >=0, harness opsiyonel, yeni `workspaceKey` opsiyonel
- Branch-only work, no PR, verification-before-completion zorunlu

---

### Task 1: Backend workspace filter in `reader.ts`

**Files:**
- Modify: `apps/gui/bridge/claude-sessions/reader.ts`
- Modify: `apps/gui/test/bridge/claude-sessions-reader.test.ts` (failing tests first)

**Interfaces:**
- Consumes: `encodeWorkspaceKey` from `@megasaver/shared`, `ClaudeSessionMeta.projectLabel`
- Produces: `listSessions(root, metaDir, opts: { limit:number; offset:number; storeRoot?:string; harness?:string; workspaceKey?:string })` workspace filtreli sonuc

- [ ] **Step 1: Write failing test for workspaceKey filter (TDD red)**

```ts
// apps/gui/test/bridge/claude-sessions-reader.test.ts  — mevcut describe icine ekle
import { encodeWorkspaceKey } from "@megasaver/shared";

it("filters by workspaceKey (only selected project's cwd)", async () => {
  // aaaa/bbbb zaten /Users/me/proj icin yazili; ekstra cwd ile ucuncu session ekle
  const other = join(root, DIR, "cccc.jsonl");
  writeFileSync(other, `${userLine("other proj", "2026-06-14T12:00:00.000Z")}\n`);
  // cccc icin farkli cwd'li meta yaz
  writeMeta("cccc", "Other", "/Users/me/other", { lastActivityAt: 2 });
  // fs mtime'i de guncelle ki siralama stabil olsun
  utimesSync(other, new Date("2026-06-14T12:00:00Z"), new Date("2026-06-14T12:00:00Z"));
  const keyProj = encodeWorkspaceKey("/Users/me/proj");
  const filtered = await listSessions(root, metaDir, { limit: 50, offset: 0, workspaceKey: keyProj });
  expect(filtered.every(s => s.projectLabel === "/Users/me/proj")).toBe(true);
  expect(filtered.map(s=>s.id).sort()).toEqual(["aaaa","bbbb"].sort());
  const keyOther = encodeWorkspaceKey("/Users/me/other");
  const onlyOther = await listSessions(root, metaDir, { limit: 50, offset: 0, workspaceKey: keyOther });
  expect(onlyOther.map(s=>s.id)).toEqual(["cccc"]);
});

it("workspaceKey + harness intersect correctly", async () => {
  const keyProj = encodeWorkspaceKey("/Users/me/proj");
  const r = await listSessions(root, metaDir, { limit: 50, offset: 0, harness: "claude-code", workspaceKey: keyProj });
  expect(r.every(s => s.harness === "claude-code" && s.projectLabel === "/Users/me/proj")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails (red)**

```bash
pnpm --filter @megasaver/gui test -- run apps/gui/test/bridge/claude-sessions-reader.test.ts -t "filters by workspaceKey"
# Expected: FAIL — listSessions workspaceKey argini ignore ediyor, tum sessionlar donuyor
```

- [ ] **Step 3: Implement minimal fix in reader.ts**

```ts
// apps/gui/bridge/claude-sessions/reader.ts degisiklikler:
// 1) import ekle (ust kisma):
import { encodeWorkspaceKey } from "@megasaver/shared";
// 2) listSessions imzasi:
export async function listSessions(
  root: string,
  metaDir: string,
  opts: { limit: number; offset: number; storeRoot?: string; harness?: string; workspaceKey?: string },
): Promise<ClaudeSessionMeta[]> {
// 3) filtering sirasi: allSessions toplandiktan SONRA, harness filtresinden ONCE veya harness ile birlikte:
//    mevcut:
//    const filtered = opts.harness ? allSessions.filter(...) : allSessions;
//    yerine:
  let filtered = allSessions;
  if (opts.workspaceKey) {
    filtered = filtered.filter((s) => {
      // projectLabel bos olanlar workspace filtresinde elenir (unknown)
      if (!s.projectLabel) return false;
      try { return encodeWorkspaceKey(s.projectLabel) === opts.workspaceKey; } catch { return false; }
    });
  }
  if (opts.harness) {
    filtered = filtered.filter((s) => s.harness === opts.harness);
  }
//    harness-aware pagination blogu aynen kalir ama `sorted` artik filtered uzerinden uretilir
```

- [ ] **Step 4: Run test to verify it passes (green)**

```bash
pnpm --filter @megasaver/gui test -- run apps/gui/test/bridge/claude-sessions-reader.test.ts -t "filters by workspaceKey"
# Expected: PASS (2 yeni test)
```

- [ ] **Step 5: Run full relevant suite, check no regression**

```bash
pnpm --filter @megasaver/gui test -- run apps/gui/test/bridge/claude-sessions-reader.test.ts
```

### Task 2: Route — parse & validate `workspaceKey` query param

**Files:**
- Modify: `apps/gui/bridge/routes/claude-sessions.ts`
- Test: `apps/gui/test/bridge/claude-sessions-reader.test.ts` veya `apps/gui/test/bridge/handler-*.test.ts` (route integration, mevcut pattern takip)

**Interfaces:**
- Consumes: `workspaceKeySchema` from `@megasaver/shared`, `listSessions` new opts
- Produces: `GET /api/claude-sessions?limit=&offset=&harness=&workspaceKey=` dogru filtreli liste, invalid key -> 400 validation_failed

- [ ] **Step 1: Write failing route test (minimal)**

```ts
// apps/gui/test/bridge/handler-cors.test.ts veya gecici tsx ile dogrula:
// GET /api/claude-sessions?workspaceKey=invalid  -> 400
// GET /api/claude-sessions?workspaceKey=<valid16hex> -> 200 ve sadece o cwd
```

- [ ] **Step 2: Implement route change**

```ts
// apps/gui/bridge/routes/claude-sessions.ts
import { workspaceKeySchema } from "@megasaver/shared";
// handleListClaudeSessions icinde:
const rawKey = ctx.query.get("workspaceKey") ?? undefined;
let workspaceKey: string | undefined;
if (rawKey !== undefined && rawKey.length > 0) {
  const parsed = workspaceKeySchema.safeParse(rawKey);
  if (!parsed.success) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid workspaceKey.", ctx.origin, parsed.error.issues);
    return;
  }
  workspaceKey = parsed.data;
}
const listOpts: { limit:number; offset:number; storeRoot?:string; harness?:string; workspaceKey?:string } = { limit, offset, storeRoot: ctx.storeRoot };
if (harness && harness.length>0) listOpts.harness = harness;
if (workspaceKey) listOpts.workspaceKey = workspaceKey;
```

- [ ] **Step 3: Verify via Vitest or curl against stub handler**

```bash
pnpm --filter @megasaver/gui test -- run apps/gui/test/bridge/handler-cors.test.ts
```

### Task 3: Client — `fetchClaudeSessions` workspaceKey support

**Files:**
- Modify: `apps/gui/src/lib/claude-sessions-client.ts`

**Interfaces:**
- Consumes: route query param
- Produces: `fetchClaudeSessions(limit, offset, harness?, workspaceKey?)` -> `/api/claude-sessions?...&workspaceKey=`

- [ ] **Step 1: Update function signature and URL building**

```ts
export function fetchClaudeSessions(
  limit = 50,
  offset = 0,
  harness?: string,
  workspaceKey?: string,
): Promise<ClaudeSessionMeta[]> {
  const h = harness && harness.length > 0 ? `&harness=${encodeURIComponent(harness)}` : "";
  const w = workspaceKey && workspaceKey.length > 0 ? `&workspaceKey=${encodeURIComponent(workspaceKey)}` : "";
  return getJson<ClaudeSessionMeta[]>(`/api/claude-sessions?limit=${limit}&offset=${offset}${h}${w}`);
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @megasaver/gui typecheck
```

### Task 4: Frontend wiring — `App.tsx` -> `WorkspaceSessionList`

**Files:**
- Modify: `apps/gui/src/app.tsx`
- Modify: `apps/gui/src/views/workspace-session-list.tsx`

**Interfaces:**
- Consumes: `activeKey` (string|null, 16 hex), `fetchClaudeSessions`
- Produces: Sessions view sadece secili workspace i gosterir; harness filtresi ile intersect eder

- [ ] **Step 1: Update App.tsx to pass activeKey**

```tsx
// apps/gui/src/app.tsx icinde mevcut:
// <WorkspaceSessionList onSelect={setSelected} />
// -> degistir:
<WorkspaceSessionList activeKey={activeKey} onSelect={setSelected} />
```

- [ ] **Step 2: Update WorkspaceSessionList to accept activeKey and fetch filtered**

```tsx
// apps/gui/src/views/workspace-session-list.tsx
export function WorkspaceSessionList({ activeKey, onSelect }: { activeKey?: string | null; onSelect: (s: ClaudeSessionMeta)=>void }): JSX.Element {
  // ...
  useEffect(() => {
    let live = true; let latest = refreshNonce;
    const tick = (): void => {
      const requestId = ++latest;
      // activeKey null ise filtre yok (backward compat); aktif ise sadece o workspace
      fetchClaudeSessions(200, 0, undefined, activeKey ?? undefined)
        .then(list => { if (!live || requestId !== latest) return; setSessions(list); setListState("ready"); })
        .catch(err => { if (!live || requestId !== latest) return; setListError(err as BridgeError); setListState("error"); })
        .finally(()=> { if(live && requestId===latest) setNowMs(Date.now()); });
    };
    tick();
    const t = setInterval(tick, LIST_POLL_MS);
    return ()=>{ live=false; clearInterval(t); };
  }, [refreshNonce, activeKey]); // activeKey dep eklendi
  // SummaryStat gruplari artik filteredSessions degil, fetch zaten filtreli oldugu icin dogrudan sessions uzerinden
}
```

- [ ] **Step 3: Ensure harness filter still intersects (client-side filter on already workspace-filtered list)**

```ts
// filteredSessions = selectedHarness === "all" ? sessions : sessions.filter(s=> (s.harness ?? "claude-code") === selectedHarness)
// bu satir aynen kalir — sessions artik workspace filtreli oldugu icin intersect dogal
```

- [ ] **Step 4: Manual UX check — TopBar degisince Sessions listesi degismeli**

```bash
# Tarayicida Sessions view ac, TopBar dan farkli bir workspace sec, liste sadece o cwd gruplarini gostermeli
```

### Task 5: Build & verification (verification-before-completion)

**Files:**
- Build artifacts: `apps/gui/dist`, `apps/gui/dist-bridge`, `apps/cli/dist-bundle/gui` (copy-gui-dist.mjs + tsup.bundle)

**Interfaces:**
- Produces: shipped GUI ve bridge `workspaceKey` filtresi ile uyumlu

- [ ] **Step 1: Build GUI + bridge**

```bash
pnpm --filter @megasaver/gui build
```

- [ ] **Step 2: Copy GUI dist to CLI bundle and rebuild CLI**

```bash
node apps/cli/scripts/copy-gui-dist.mjs
npx tsup --config apps/cli/tsup.bundle.config.ts
node apps/cli/scripts/copy-gui-dist.mjs  # tsup clean:true wipe'ini geri al
```

- [ ] **Step 3: Evidence — backend unit tests**

```bash
pnpm --filter @megasaver/gui test -- run apps/gui/test/bridge/claude-sessions-reader.test.ts
# Expected: all pass including 2 new workspaceKey tests
```

- [ ] **Step 4: Evidence — live handler with real data (tsx direct call, vitest hang workaround)**

```bash
npx tsx -e "
import { listSessions } from './apps/gui/bridge/claude-sessions/reader.js';
import { encodeWorkspaceKey } from './packages/shared/src/workspace-key.ts';
import os from 'node:os';
import path from 'node:path';
const root = path.join(os.homedir(), '.claude/projects');
const meta = path.join(os.homedir(), '.config/claude/projects'); // fallback kontrol
// gercek storeRoot ile cagir ve workspaceKey filtre sonucu sadece o cwd donmeli
"
```

- [ ] **Step 5: Evidence — manual curl against running bridge**

```bash
mega gui --no-open &
curl -s "http://127.0.0.1:<port>/api/claude-sessions?limit=50" | jq 'map(.projectLabel) | unique | length'
curl -s "http://127.0.0.1:<port>/api/claude-sessions?limit=50&workspaceKey=<key>" | jq 'map(.projectLabel) | unique'
# Expected: ikinci istek tek bir cwd dondurur
```

- [ ] **Step 6: Full verify gate**

```bash
pnpm verify
# Expected: lint + typecheck + test + conventions:check PASS
```

