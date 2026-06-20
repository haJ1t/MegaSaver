# Memory Graph — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Extend the Phase 1 memory graph with wiki + code layers, unified via shared `file` nodes — a file referenced by both a memory (`relatedFiles`) and a wiki page (`(source: path)` citation) is ONE node, bridging runtime-memory ↔ code ↔ wiki.

**Architecture:** Extend the pure leaf `@megasaver/memory-graph` (model + a new pure `parseWikiPage` + `buildGraph` extensions). The loaders (bridge + CLI) walk `<cwd>/wiki/` (path-confined IO), parse each page with the leaf function, derive `file`/`symbol` nodes, and feed the extended `GraphInput` to `buildGraph`. The GUI styles the new kinds + adds layer toggles.

**Tech Stack:** TypeScript strict ESM, Zod, Vitest, React + cytoscape (`apps/gui`). No new deps (the wiki frontmatter parser is minimal — no `yaml` — so the leaf stays shared+zod only).

**Spec:** `docs/superpowers/specs/2026-06-19-memory-graph-phase2-design.md`.

---

## File structure

- `packages/memory-graph/src/model.ts` — extend `nodeKindSchema` (+`file`,`symbol`,`wiki`) and `edgeKindSchema` (+`code-link`,`wiki-link`,`wiki-source`,`wiki-cite`).
- `packages/memory-graph/src/inputs.ts` — add `fileInputSchema`,`symbolInputSchema`,`wikiInputSchema`; extend `graphInputSchema` with `files`,`symbols`,`wikiPages`.
- `packages/memory-graph/src/parse-wiki.ts` (NEW) — pure `parseWikiPage(relPath, content): WikiInput`.
- `packages/memory-graph/src/build-graph.ts` — emit file/symbol/wiki nodes + the 4 new edges (file shared by path id; `[[link]]`/sources resolution; wiki-cite to file).
- `packages/memory-graph/src/index.ts` — re-export the additions.
- Tests: `test/parse-wiki.test.ts`, extend `test/build-graph.test.ts`, extend `test/model.test.ts`.
- `apps/gui/bridge/routes/memory-graph.ts` — extend `loadGraphInput` to take `cwd`, walk wiki, derive files/symbols/wikiPages.
- `apps/gui/test/bridge/memory-graph-route.test.ts` — extend with a wiki fixture + a `..`-escape rejection test.
- `apps/cli/src/commands/memory/graph.ts` — same wiki walk for the project's `rootPath`.
- `apps/cli/test/memory-graph.test.ts` — extend.
- `apps/gui/src/views/cockpit/memory-graph-panel.tsx` — style new node/edge kinds + wiki/code layer toggles.
- `apps/gui/test/components/memory-graph-panel.test.tsx` — extend.

A small wiki-directory walk helper (`readdir` + `readFile`, IO) is duplicated per loader (bridge/CLI, ~15 lines each) — the complex parsing is shared in the leaf, so this is within the 3-similar-lines tolerance, not worth a cross-app shared module.

---

## Task 1: Model + input extensions

**Files:** `packages/memory-graph/src/{model.ts,inputs.ts,index.ts}`, `test/model.test.ts`.

- [ ] **Step 1 (RED):** In `test/model.test.ts` extend the kind lists:
```typescript
for (const k of ["project","session","memory","evidence","chunkset","file","symbol","wiki"]) expect(nodeKindSchema.parse(k)).toBe(k);
for (const k of ["contains","scope","project-memory","cites","chunk-of","from-session","conflict","supersede","duplicate","code-link","wiki-link","wiki-source","wiki-cite"]) expect(edgeKindSchema.parse(k)).toBe(k);
```
Run `pnpm --filter @megasaver/memory-graph test -- model` → FAIL (new kinds rejected).

- [ ] **Step 2 (GREEN):** In `model.ts` add `"file","symbol","wiki"` to `nodeKindSchema` and `"code-link","wiki-link","wiki-source","wiki-cite"` to `edgeKindSchema`.

- [ ] **Step 3:** In `inputs.ts` add:
```typescript
export const fileInputSchema = z.object({ path: z.string() });
export type FileInput = z.infer<typeof fileInputSchema>;
export const symbolInputSchema = z.object({ symbol: z.string() });
export type SymbolInput = z.infer<typeof symbolInputSchema>;
export const wikiInputSchema = z.object({
  path: z.string(), title: z.string(), tags: z.array(z.string()), status: z.string(),
  links: z.array(z.string()), sources: z.array(z.string()), fileCites: z.array(z.string()),
});
export type WikiInput = z.infer<typeof wikiInputSchema>;
```
Extend `graphInputSchema` with `files: z.array(fileInputSchema)`, `symbols: z.array(symbolInputSchema)`, `wikiPages: z.array(wikiInputSchema)`. Also add `relatedFiles`/`relatedSymbols` to `memoryInputSchema` (`z.array(z.string())` each — needed for code-link). Re-export all from `index.ts`.

- [ ] **Step 4:** `pnpm --filter @megasaver/memory-graph build && pnpm --filter @megasaver/memory-graph test -- model` → PASS. NOTE: extending `graphInputSchema` with required arrays will break the existing `buildGraph` callers/tests until Task 3 — that is expected; keep going (the package may not fully build-test green until Task 3). Make the three new `GraphInput` arrays **default to `[]`** (`z.array(...).default([])`) and `relatedFiles/relatedSymbols` default `[]` so existing fixtures/callers that omit them still parse.

- [ ] **Step 5:** Commit `feat(memory-graph): add file/symbol/wiki kinds + inputs`.

## Task 2: `parseWikiPage` (pure)

**Files:** Create `packages/memory-graph/src/parse-wiki.ts`, `test/parse-wiki.test.ts`; re-export from `index.ts`.

Handles real wiki format: frontmatter with quoted scalars (`title: '@megasaver/core'`), inline arrays (`tags: [entity, package]`) AND multiline lists (`sources:\n  - a\n  - b`); body `[[folder/page]]` / `[[x|alias]]` / `[[x#anchor]]` links; `(source: path:line)` citations where only **path-shaped** sources (contain `/` or a `.ext`) become `fileCites` (free-text refs like `(source: AA1 §2a)` are ignored).

- [ ] **Step 1 (RED):** `test/parse-wiki.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { parseWikiPage } from "../src/parse-wiki.js";

const PAGE = `---
title: '@megasaver/core'
tags: [entity, package]
sources:
  - docs/a.md
  - docs/b.md
status: active
---

See [[decisions/bootstrap-matrix]] and [[concepts/foo|Foo]] and [[bar#sec]].
Claim one (source: packages/core/src/x.ts:12). Claim two (source: AA1 §2a). Repeat (source: packages/core/src/x.ts).
`;

describe("parseWikiPage", () => {
  it("extracts frontmatter, links, and path-shaped file citations", () => {
    const w = parseWikiPage("entities/core.md", PAGE);
    expect(w.path).toBe("entities/core.md");
    expect(w.title).toBe("@megasaver/core");
    expect(w.tags).toEqual(["entity", "package"]);
    expect(w.status).toBe("active");
    expect(w.sources).toEqual(["docs/a.md", "docs/b.md"]);
    expect(w.links).toEqual(["decisions/bootstrap-matrix", "concepts/foo", "bar"]); // alias + anchor stripped
    expect(w.fileCites).toEqual(["packages/core/src/x.ts"]); // deduped; prose "AA1 §2a" dropped
  });
  it("defaults title to basename and status to active when frontmatter is absent", () => {
    const w = parseWikiPage("concepts/x.md", "no frontmatter, just [[a]] text");
    expect(w.title).toBe("x");
    expect(w.status).toBe("active");
    expect(w.tags).toEqual([]);
    expect(w.links).toEqual(["a"]);
  });
});
```
Run → FAIL.

- [ ] **Step 2 (GREEN):** Implement `parse-wiki.ts`:
```typescript
import type { WikiInput } from "./inputs.js";

function stripQuotes(s: string): string {
  const t = s.trim();
  return (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')) ? t.slice(1, -1) : t;
}
function parseInlineArray(s: string): string[] {
  const t = s.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  return t.slice(1, -1).split(",").map((x) => stripQuotes(x).trim()).filter((x) => x.length > 0);
}
function basename(relPath: string): string {
  const last = relPath.split("/").pop() ?? relPath;
  return last.endsWith(".md") ? last.slice(0, -3) : last;
}
function looksLikePath(s: string): boolean {
  return s.includes("/") || /\.[A-Za-z0-9]+$/.test(s);
}

export function parseWikiPage(relPath: string, content: string): WikiInput {
  let title = basename(relPath);
  const tags: string[] = [];
  const sources: string[] = [];
  let status = "active";

  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const lines = (fm[1] as string).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (!m) continue;
      const key = m[1] as string;
      const rest = (m[2] as string).trim();
      const collectList = (): string[] => {
        if (rest.startsWith("[")) return parseInlineArray(rest);
        const out: string[] = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] as string)) {
          out.push(stripQuotes((lines[++i] as string).replace(/^\s*-\s+/, "")).trim());
        }
        return out;
      };
      if (key === "title") title = stripQuotes(rest) || title;
      else if (key === "status") status = stripQuotes(rest) || status;
      else if (key === "tags") tags.push(...collectList());
      else if (key === "sources") sources.push(...collectList());
    }
  }

  const body = fm ? content.slice((fm[0] as string).length) : content;
  const links = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((mm) =>
    (mm[1] as string).split("|")[0]!.split("#")[0]!.trim(),
  );
  const fileCites = [
    ...new Set(
      [...body.matchAll(/\(source:\s*([^)]+)\)/g)]
        .map((mm) => (mm[1] as string).trim().replace(/:\d+$/, "").trim())
        .filter(looksLikePath),
    ),
  ];

  return { path: relPath, title, tags, status, links, sources, fileCites };
}
```
Re-export `parseWikiPage` from `index.ts`.

- [ ] **Step 3:** `pnpm --filter @megasaver/memory-graph build && pnpm --filter @megasaver/memory-graph test -- parse-wiki` → PASS. biome clean.

- [ ] **Step 4:** Commit `feat(memory-graph): pure parseWikiPage`.

## Task 3: `buildGraph` extensions (file/symbol/wiki nodes + edges)

**Files:** `packages/memory-graph/src/build-graph.ts`, extend `test/build-graph.test.ts`.

Resolution rule (in buildGraph): index wikiPages by `path`, by `path` without `.md`, by basename-without-`.md`, and by `title` (all normalized: lowercase). Resolve a `[[link]]`/source string to a wiki node id by: exact path, else `<x>.md`, else basename/title match. Dangling → skip.

- [ ] **Step 1 (RED):** Extend `test/build-graph.test.ts`. Add to the `base()` fixture (or a new fixture): `memories[0]` gets `relatedFiles: ["packages/core/src/x.ts"]`, `relatedSymbols: ["buildGraph"]`; add `wikiPages: [{ path: "entities/core.md", title: "core", tags: [], status: "active", links: ["decisions/bootstrap-matrix"], sources: ["concepts/foo.md"], fileCites: ["packages/core/src/x.ts"] }, { path: "decisions/bootstrap-matrix.md", title: "bootstrap", tags: [], status: "active", links: [], sources: [], fileCites: [] }, { path: "concepts/foo.md", title: "foo", tags: [], status: "active", links: [], sources: [], fileCites: [] }]`. Also pass `files`/`symbols` empty (the loader derives them; for the pure test derive them in the fixture or assert buildGraph also auto-creates file/symbol nodes from memory.relatedFiles + wiki.fileCites — DECIDE: buildGraph creates file/symbol nodes from `input.files`/`input.symbols` provided by the loader, NOT from scanning memories/wiki. So the FIXTURE must include `files: [{ path: "packages/core/src/x.ts" }], symbols: [{ symbol: "buildGraph" }]`). Assertions:
```typescript
const has = (g, kind, from, to) => g.edges.some((e) => e.kind === kind && e.from === from && e.to === to);
// file/symbol/wiki nodes exist
expect(g.nodes.some((n) => n.kind === "file" && n.id === "packages/core/src/x.ts")).toBe(true);
expect(g.nodes.some((n) => n.kind === "symbol" && n.id === "buildGraph")).toBe(true);
expect(g.nodes.some((n) => n.kind === "wiki" && n.id === "entities/core.md")).toBe(true);
// code-link: memory -> file/symbol
expect(has(g, "code-link", "m1", "packages/core/src/x.ts")).toBe(true);
expect(has(g, "code-link", "m1", "buildGraph")).toBe(true);
// wiki-link resolved (entities/core.md -> decisions/bootstrap-matrix.md)
expect(has(g, "wiki-link", "entities/core.md", "decisions/bootstrap-matrix.md")).toBe(true);
// wiki-source resolved (entities/core.md -> concepts/foo.md)
expect(has(g, "wiki-source", "entities/core.md", "concepts/foo.md")).toBe(true);
// wiki-cite: wiki -> SHARED file node (the bridge)
expect(has(g, "wiki-cite", "entities/core.md", "packages/core/src/x.ts")).toBe(true);
// shared file node has exactly one node despite two referrers
expect(g.nodes.filter((n) => n.id === "packages/core/src/x.ts")).toHaveLength(1);
// dangling link dropped: a [[nope]] with no page -> no edge
```
Run → FAIL.

- [ ] **Step 2 (GREEN):** In `build-graph.ts`: after the existing node emission, add `file` nodes from `input.files` (`add({ id: f.path, kind: "file", label: f.path.split("/").pop() ?? f.path, meta: { path: f.path } })`), `symbol` nodes from `input.symbols`, `wiki` nodes from `input.wikiPages` (`add({ id: w.path, kind: "wiki", label: w.title, meta: { tags: w.tags, status: w.status } })`). Build a wiki resolution map (path, path-without-.md, basename, title → path; lowercase keys). Then edges: for each memory, `for (const p of m.relatedFiles) link("code-link", m.id, p)` and `for (const s of m.relatedSymbols) link("code-link", m.id, s)` (the node-existence guard skips files/symbols not in `input.files`/`symbols`); for each wikiPage, resolve each `links[]` → `link("wiki-link", w.path, resolved)`, each `sources[]` → `link("wiki-source", w.path, resolved)` (skip unresolved), each `fileCites[]` → `link("wiki-cite", w.path, cite)` (file node id = the cite path). The existing node-existence guard + `seen` dedupe handle dangling + duplicates. Remember `memoryInputSchema` now has `relatedFiles`/`relatedSymbols` (default `[]`).

- [ ] **Step 3:** `pnpm --filter @megasaver/memory-graph build && pnpm --filter @megasaver/memory-graph test` → ALL pass (model + parse-wiki + build-graph + dependency-graph). biome clean.

- [ ] **Step 4:** Commit `feat(memory-graph): project file/symbol/wiki into the graph`.

## Task 4: Bridge loader — walk `<cwd>/wiki/`

**Files:** `apps/gui/bridge/routes/memory-graph.ts`, extend `apps/gui/test/bridge/memory-graph-route.test.ts`.

- [ ] **Step 1 (RED):** Extend the bridge test: seed a `wiki/entities/a.md` (with a `[[concepts/b]]` link + frontmatter) and `wiki/concepts/b.md` under the resolved workspace's cwd (the test's seeded cwd dir), seed a memory with `relatedFiles`, then `GET .../memory/graph` and assert the response contains a `wiki` node `entities/a.md`, a `wiki-link` edge to `concepts/b.md`, and a `file` node + `code-link`. ALSO add a path-safety test: a wiki file is only read from under `<cwd>/wiki/` (assert a sibling `<cwd>/secret.md` is NOT ingested). Run → FAIL.

- [ ] **Step 2 (GREEN):** In `memory-graph.ts`: extend `loadGraphInput` to also accept `cwd` (the handler already has `resolved.cwd`). Add a `readWikiPages(cwd): WikiInput[]` helper: for each folder in `["entities","concepts","decisions","syntheses","workflows","sources"]`, resolve `wikiRoot = join(cwd, "wiki", folder)`, recursively read `*.md` files, **verify each resolved real path stays within `join(cwd, "wiki")`** (`resolve(p).startsWith(resolve(join(cwd,"wiki")) + sep)` — reject otherwise; also skip symlinks), read content, call `parseWikiPage(relPathFromWikiRoot, content)`. Missing folder → skip. Then derive `files` = unique paths from `memories.flatMap(relatedFiles)` ∪ `wikiPages.flatMap(fileCites)` → `{path}`; `symbols` = unique `memories.flatMap(relatedSymbols)` → `{symbol}`. Pass `files,symbols,wikiPages` into the `GraphInput`. Wire `resolved.cwd` through in the handler.

- [ ] **Step 3:** Build deps + `pnpm --filter @megasaver/gui test -- memory-graph-route` → PASS; full gui suite green; typecheck + biome clean.

- [ ] **Step 4:** Commit `feat(gui): ingest wiki + code into the bridge graph`.

## Task 5: CLI loader — walk the project's `<rootPath>/wiki/`

**Files:** `apps/cli/src/commands/memory/graph.ts`, extend `apps/cli/test/memory-graph.test.ts`.

- [ ] **Step 1 (RED):** Extend the CLI test: seed a project whose `rootPath` has a `wiki/entities/a.md`, run `mega memory graph <project> --json`, assert the graph JSON includes the `wiki` node + `wiki-link`. Run → FAIL.

- [ ] **Step 2 (GREEN):** In `graph.ts`: reuse the same `readWikiPages(rootPath)` walk (the project's `rootPath` from the registry is the cwd-equivalent; apply the SAME `<rootPath>/wiki/` path confinement). Derive `files`/`symbols` from the project memories' `relatedFiles`/`relatedSymbols` ∪ wiki `fileCites`. Pass `files,symbols,wikiPages` to `buildGraph`. (The walk is ~15 lines; duplicate it here — or, if preferred, extract a tiny `read-wiki.ts` helper under `apps/cli` and one under the bridge; do NOT put fs IO in the leaf.)

- [ ] **Step 3:** Build + `pnpm --filter @megasaver/cli test -- memory-graph` → PASS; full cli suite green; typecheck + biome clean.

- [ ] **Step 4:** Commit `feat(cli): ingest wiki + code into mega memory graph`.

## Task 6: GUI — style new kinds + layer toggles

**Files:** `apps/gui/src/views/cockpit/memory-graph-panel.tsx`, extend `apps/gui/test/components/memory-graph-panel.test.tsx`; extend `apps/gui/src/styles/tokens.css` if new `--graph-*` vars are needed.

- [ ] **Step 1 (RED):** Extend the component test: the mocked graph includes `file`/`wiki` nodes + `code-link`/`wiki-link` edges; assert they render (the cytoscape stub receives elements with those classes) and that a "Wiki"/"Code" filter toggle exists and hides those kinds when off. Run → FAIL.

- [ ] **Step 2 (GREEN):** Add cytoscape style classes: `file` (slate `#475569`), `symbol` (`#64748B`), `wiki` (violet `#9333EA`); edges `code-link` + `wiki-cite` thin solid to file, `wiki-link` + `wiki-source` violet solid. Add `--graph-file/-symbol/-wiki` to `tokens.css` (light+dark) and read them like the Phase 1 colors. Extend the existing kind-filter UI with "Wiki" and "Code" layer toggles (a toggle hides the relevant node kinds + their incident edges — reuse the Phase 1 filtering mechanism). Update the detail panel to show wiki (title/tags/status) and file (path) node fields.

- [ ] **Step 3:** `pnpm --filter @megasaver/gui test -- memory-graph-panel` → PASS; full gui suite green; typecheck + biome clean; `pnpm --filter @megasaver/gui build` (Vite) succeeds. Manual smoke: `pnpm --filter @megasaver/gui dev`, open a project WITH a wiki (e.g. this repo) → Memory Graph tab → wiki cluster + bridges visible.

- [ ] **Step 4:** Commit `feat(gui): render wiki + code layers with toggles`.

## Task 7: Changeset + verify

- [ ] **Step 1:** `.changeset/memory-graph-phase2.md` — `@megasaver/memory-graph` minor, `@megasaver/gui` minor, `@megasaver/cli` minor.
- [ ] **Step 2:** `pnpm verify` → exit 0.
- [ ] **Step 3:** Commit the changeset.

---

## Self-review notes

- **Spec coverage:** wiki ingestion (§2) → Tasks 2,4,5; code layer (§2) → Tasks 3,4,5; the shared-file bridge (§2) → Task 3 (the `wiki-cite` + `code-link` to one file node, explicitly asserted); link resolution rules (§5) → Task 3 (resolution map) + Task 2 (alias/anchor strip, path-shaped citations); path safety (§6) → Task 4/5 (`<cwd>/wiki/` confinement + the escape-rejection test); GUI (§7) → Task 6.
- **Leaf purity:** the leaf gains only pure code (`parseWikiPage` + buildGraph extensions) — no `yaml`, no fs; the dep-graph test (shared+zod) still passes. The fs walk lives in the app loaders.
- **Type consistency:** `WikiInput`/`FileInput`/`SymbolInput` (Task 1) are the contract `parseWikiPage` (Task 2), `buildGraph` (Task 3), and both loaders (Tasks 4–5) target; the GUI consumes the same `Graph` wire shape (new kinds are just new `kind` strings — no shape change).
- **Backward-compat:** the three new `GraphInput` arrays + `relatedFiles`/`relatedSymbols` default to `[]`, so Phase 1 callers/fixtures that omit them still parse — no Phase 1 regression.
- **Real-format coverage:** `parseWikiPage` handles the actual wiki frontmatter (quoted scalars + inline AND multiline arrays), path-style `[[folder/page]]` links (alias/anchor stripped), and `(source: ...)` where only path-shaped refs become file citations (prose refs like `AA1 §2a` ignored).
