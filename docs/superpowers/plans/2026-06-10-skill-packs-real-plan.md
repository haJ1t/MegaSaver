# Skill-Packs Real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real `loadPack` + discovery + workspace installer + `mega pack {install,list,remove,info}` CLI, per spec `docs/superpowers/specs/2026-06-10-skill-packs-real-design.md` (HIGH risk).

**Architecture:** SP1 turns `@megasaver/skill-packs` into a real library (loader, discovery, conflict scan, 7-member error enum). SP2 adds installer ops (atomic copy, symlink rejection) and the CLI command group. apps/cli gains a direct `@megasaver/skill-packs` dep — the dependency-graph allow-list widens (skill-packs is a standalone subsystem; core does not depend on it, so a core re-export is not an option here).

**Tech Stack:** TypeScript strict ESM, Zod, Vitest (+ typecheck mode pins), Citty, pnpm/turbo.

**Worktree:** `/Users/halitozger/Desktop/MegaSaver/.worktrees/skill-packs`, branch `feat/skill-packs-real`. All commands run from worktree root. Run `pnpm install && pnpm build` once before Task 1.

---

## SP1 — library

### Task 1: Widen the error enum, rewrite pins

**Files:**
- Modify: `packages/skill-packs/src/errors.ts`
- Modify: `packages/skill-packs/test/errors.test-d.ts`
- Modify: `packages/skill-packs/test/load-pack.test.ts` (delete — superseded by Task 2's suite)

- [ ] **Step 1: Rewrite the type-pin test for the 7-member enum**

Replace `packages/skill-packs/test/errors.test-d.ts` body:

```ts
import { describe, it } from "vitest";
import { type SkillPackErrorCode, skillPackErrorCodeSchema } from "../src/errors.js";

describe("SkillPackErrorCode type regression", () => {
  it("each member is a valid SkillPackErrorCode", () => {
    const _all: SkillPackErrorCode[] = [
      "manifest_invalid",
      "manifest_missing",
      "pack_already_installed",
      "pack_not_found",
      "pack_path_escape",
      "pack_unreadable",
      "skill_id_conflict",
    ];
    void _all;
  });

  it("retired placeholder code is no longer assignable", () => {
    // @ts-expect-error not_implemented was removed with the real loader
    const _bad: SkillPackErrorCode = "not_implemented";
    void _bad;
  });

  it("non-member string-cast is not assignable to SkillPackErrorCode", () => {
    // @ts-expect-error arbitrary string is not assignable to SkillPackErrorCode
    const _bad: SkillPackErrorCode = "boom" as string;
    void _bad;
  });

  it("skillPackErrorCodeSchema.options spreads into SkillPackErrorCode[]", () => {
    const arr: SkillPackErrorCode[] = [...skillPackErrorCodeSchema.options];
    void arr;
  });

  it("skillPackErrorCodeSchema.options preserves alphabetic order", () => {
    const _t: readonly [
      "manifest_invalid",
      "manifest_missing",
      "pack_already_installed",
      "pack_not_found",
      "pack_path_escape",
      "pack_unreadable",
      "skill_id_conflict",
    ] = skillPackErrorCodeSchema.options;
    void _t;
  });
});
```

Delete `packages/skill-packs/test/load-pack.test.ts` (its three assertions pin the placeholder contract; Task 2 replaces the file wholesale).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/skill-packs test`
Expected: FAIL — typecheck errors (members not in enum yet).

- [ ] **Step 3: Widen the enum**

In `packages/skill-packs/src/errors.ts` replace the schema + comment:

```ts
// Order: alphabetic (AA3). Widened from the v0.3 placeholder when the
// real loader landed; not_implemented retired (no external consumer,
// pre-1.0 — CLAUDE.md §13 no backward-compat shims).
export const skillPackErrorCodeSchema = z.enum([
  "manifest_invalid",
  "manifest_missing",
  "pack_already_installed",
  "pack_not_found",
  "pack_path_escape",
  "pack_unreadable",
  "skill_id_conflict",
]);
```

`load-pack.ts` still references `"not_implemented"` — stub it temporarily to keep the package compiling:

```ts
// packages/skill-packs/src/load-pack.ts (temporary body; Task 2 replaces)
import { z } from "zod";
import { SkillPackError } from "./errors.js";
import type { SkillPackManifest } from "./manifest.js";

const pathSchema = z.string().min(1, "loadPack: path must be a non-empty string");

export function loadPack(path: string): Promise<SkillPackManifest> {
  const parsed = pathSchema.parse(path);
  return Promise.reject(
    new SkillPackError("manifest_missing", "loadPack: real loader lands in the next commit.", {
      packPath: parsed,
    }),
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @megasaver/skill-packs test && pnpm --filter @megasaver/skill-packs typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/skill-packs/src/errors.ts packages/skill-packs/src/load-pack.ts packages/skill-packs/test/errors.test-d.ts
git rm packages/skill-packs/test/load-pack.test.ts
git commit -m "feat(skill-packs): widen error enum to loader taxonomy"
```

---

### Task 2: Real `loadPack`

**Files:**
- Modify: `packages/skill-packs/src/load-pack.ts` (full rewrite)
- Create: `packages/skill-packs/src/entry-guard.ts`
- Test: `packages/skill-packs/test/load-pack.test.ts` (new suite)

- [ ] **Step 1: Write the failing suite**

```ts
// packages/skill-packs/test/load-pack.test.ts
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPack } from "../src/load-pack.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: [],
  description: null,
};

async function seedPack(root: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(root, "skills"), { recursive: true });
  await writeFile(join(root, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(root, "skills", "hello.md"), "# hello\n");
}

describe("loadPack — real loader", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "skillpack-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads a valid pack and returns the parsed manifest", async () => {
    await seedPack(root);
    const manifest = await loadPack(root);
    expect(manifest.name).toBe("demo-pack");
    expect(manifest.skills).toHaveLength(1);
  });

  it("manifest_missing when megasaver-pack.json is absent", async () => {
    await expect(loadPack(root)).rejects.toMatchObject({ code: "manifest_missing" });
  });

  it("pack_unreadable on garbage JSON", async () => {
    await writeFile(join(root, "megasaver-pack.json"), "{not json");
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_unreadable" });
  });

  it("manifest_invalid on schema violation", async () => {
    await seedPack(root, { name: "Bad Name", version: "1.0.0" });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "manifest_invalid" });
  });

  it("pack_path_escape on ../ entry", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "../outside.md" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
  });

  it("pack_path_escape on absolute entry", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "/etc/passwd" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
  });

  it("pack_path_escape on symlinked entry", async () => {
    await seedPack(root);
    const outside = join(root, "..", `outside-${Date.now()}.md`);
    await writeFile(outside, "outside\n");
    await rm(join(root, "skills", "hello.md"));
    await symlink(outside, join(root, "skills", "hello.md"));
    try {
      await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_path_escape" });
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("pack_unreadable when an entry file is missing", async () => {
    await seedPack(root, {
      ...MANIFEST,
      skills: [{ id: "hello", entry: "skills/nope.md" }],
    });
    await expect(loadPack(root)).rejects.toMatchObject({ code: "pack_unreadable" });
  });

  it("rejects an empty path at the boundary", () => {
    expect(() => loadPack("")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @megasaver/skill-packs test -- load-pack`
Expected: FAIL (stub rejects everything with manifest_missing).

- [ ] **Step 3: Implement entry guard + loader**

```ts
// packages/skill-packs/src/entry-guard.ts
import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { SkillPackError } from "./errors.js";

// Containment is structural (path.relative), not lexical startsWith —
// "/x/packs-evil" must not pass a "/x/packs" prefix. Symlinked entries
// are rejected outright: a link inside the pack is an escape pointer.
export function assertEntryWithinPack(packRoot: string, entry: string): string {
  if (isAbsolute(entry)) {
    throw new SkillPackError("pack_path_escape", `absolute entry path: ${entry}`, {
      packPath: packRoot,
    });
  }
  const absolute = resolve(packRoot, entry);
  const rel = relative(resolve(packRoot), absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new SkillPackError("pack_path_escape", `entry escapes pack root: ${entry}`, {
      packPath: packRoot,
    });
  }
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absolute);
  } catch (err) {
    throw new SkillPackError("pack_unreadable", `entry file missing or unreadable: ${entry}`, {
      packPath: packRoot,
      cause: err,
    });
  }
  if (stat.isSymbolicLink()) {
    throw new SkillPackError("pack_path_escape", `symlinked entry rejected: ${entry}`, {
      packPath: packRoot,
    });
  }
  return absolute;
}
```

```ts
// packages/skill-packs/src/load-pack.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertEntryWithinPack } from "./entry-guard.js";
import { SkillPackError } from "./errors.js";
import { type SkillPackManifest, skillPackManifestSchema } from "./manifest.js";

const pathSchema = z.string().min(1, "loadPack: path must be a non-empty string");

export const MANIFEST_FILENAME = "megasaver-pack.json";

export async function loadPack(path: string): Promise<SkillPackManifest> {
  const packRoot = pathSchema.parse(path);
  const manifestPath = join(packRoot, MANIFEST_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    const code =
      (err as NodeJS.ErrnoException).code === "ENOENT" ? "manifest_missing" : "pack_unreadable";
    throw new SkillPackError(code, `cannot read ${MANIFEST_FILENAME}: ${String(err)}`, {
      packPath: packRoot,
      cause: err,
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new SkillPackError("pack_unreadable", `broken JSON in ${MANIFEST_FILENAME}`, {
      packPath: packRoot,
      cause: err,
    });
  }

  const parsed = skillPackManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new SkillPackError("manifest_invalid", parsed.error.message, { packPath: packRoot });
  }

  for (const skill of parsed.data.skills) {
    assertEntryWithinPack(packRoot, skill.entry);
  }
  return parsed.data;
}
```

`index.ts` already does `export * from "./load-pack.js"` — add `export * from "./entry-guard.js";` is NOT needed (internal); do not export it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @megasaver/skill-packs test && pnpm --filter @megasaver/skill-packs typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/skill-packs/src packages/skill-packs/test/load-pack.test.ts
git commit -m "feat(skill-packs): real loadPack with containment guards"
```

---

### Task 3: `discoverPacks`

**Files:**
- Create: `packages/skill-packs/src/discover.ts`
- Modify: `packages/skill-packs/src/index.ts`
- Test: `packages/skill-packs/test/discover.test.ts`

- [ ] **Step 1: Write the failing suite**

```ts
// packages/skill-packs/test/discover.test.ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverPacks } from "../src/discover.js";

function manifest(name: string, skillId = "hello"): string {
  return JSON.stringify({
    name,
    version: "1.0.0",
    kind: "skill",
    skills: [{ id: skillId, entry: "skills/hello.md" }],
    capabilities: [],
    description: null,
  });
}

async function seedPack(installRoot: string, name: string, skillId = "hello"): Promise<void> {
  const dir = join(installRoot, name);
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), manifest(name, skillId));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

describe("discoverPacks", () => {
  let workspace: string;
  let xdg: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sp-ws-"));
    xdg = await mkdtemp(join(tmpdir(), "sp-xdg-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(xdg, { recursive: true, force: true });
  });

  const wsPacks = () => join(workspace, ".megasaver", "packs");
  const globalPacks = () => join(xdg, "megasaver", "packs");

  function discover() {
    return discoverPacks({ workspaceRoot: workspace, home: "/nonexistent-home", xdgDataHome: xdg });
  }

  it("finds workspace and global packs with source labels", async () => {
    await seedPack(wsPacks(), "ws-pack");
    await seedPack(globalPacks(), "global-pack", "other");
    const result = await discover();
    expect(result.packs.map((p) => [p.manifest.name, p.source])).toEqual([
      ["ws-pack", "workspace"],
      ["global-pack", "global"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("workspace wins on name collision (global shadowed, no warning)", async () => {
    await seedPack(wsPacks(), "dup");
    await seedPack(globalPacks(), "dup", "other");
    const result = await discover();
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.source).toBe("workspace");
  });

  it("skips a corrupt pack with a warning; siblings still load", async () => {
    await seedPack(wsPacks(), "good");
    await mkdir(join(wsPacks(), "broken"), { recursive: true });
    await writeFile(join(wsPacks(), "broken", "megasaver-pack.json"), "{nope");
    const result = await discover();
    expect(result.packs.map((p) => p.manifest.name)).toEqual(["good"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("broken");
  });

  it("missing roots → empty result, no warnings", async () => {
    const result = await discover();
    expect(result).toEqual({ packs: [], warnings: [] });
  });

  it("ignores .tmp-* staging dirs", async () => {
    await seedPack(wsPacks(), "real-pack");
    await seedPack(wsPacks(), ".tmp-real-pack");
    const result = await discover();
    expect(result.packs.map((p) => p.manifest.name)).toEqual(["real-pack"]);
  });

  it("falls back to <home>/.local/share when xdgDataHome is undefined", async () => {
    const home = await mkdtemp(join(tmpdir(), "sp-home-"));
    try {
      await seedPack(join(home, ".local", "share", "megasaver", "packs"), "home-pack");
      const result = await discoverPacks({
        workspaceRoot: workspace,
        home,
        xdgDataHome: undefined,
      });
      expect(result.packs.map((p) => p.manifest.name)).toEqual(["home-pack"]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @megasaver/skill-packs test -- discover` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/skill-packs/src/discover.ts
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkillPackError } from "./errors.js";
import { loadPack } from "./load-pack.js";
import type { SkillPackManifest } from "./manifest.js";

export type DiscoverInput = {
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined;
};

export type DiscoveredPack = {
  manifest: SkillPackManifest;
  root: string;
  source: "workspace" | "global";
};

export type DiscoveryResult = {
  packs: DiscoveredPack[];
  warnings: string[];
};

export function workspacePacksRoot(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".megasaver", "packs");
}

export function globalPacksRoot(home: string, xdgDataHome: string | undefined): string {
  const base =
    xdgDataHome && xdgDataHome.length > 0 ? resolve(xdgDataHome) : resolve(home, ".local", "share");
  return join(base, "megasaver", "packs");
}

function listCandidateDirs(root: string): string[] {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // missing root: empty scan, no warning (spec §2b)
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".tmp-"))
    .map((e) => join(root, e.name));
}

export async function discoverPacks(input: DiscoverInput): Promise<DiscoveryResult> {
  const roots: Array<{ dir: string; source: "workspace" | "global" }> = [
    { dir: workspacePacksRoot(input.workspaceRoot), source: "workspace" },
    { dir: globalPacksRoot(input.home, input.xdgDataHome), source: "global" },
  ];

  const packs: DiscoveredPack[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { dir, source } of roots) {
    for (const candidate of listCandidateDirs(dir)) {
      let manifest: SkillPackManifest;
      try {
        manifest = await loadPack(candidate);
      } catch (err) {
        const detail = err instanceof SkillPackError ? `${err.code}: ${err.message}` : String(err);
        warnings.push(`${candidate}: ${detail}`);
        continue;
      }
      if (seen.has(manifest.name)) continue; // workspace beats global (HH §4)
      seen.add(manifest.name);
      packs.push({ manifest, root: candidate, source });
    }
  }
  return { packs, warnings };
}
```

Add to `packages/skill-packs/src/index.ts`:

```ts
export * from "./discover.js";
```

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @megasaver/skill-packs test && pnpm --filter @megasaver/skill-packs typecheck` → PASS

- [ ] **Step 5: Commit**

```bash
git add packages/skill-packs/src/discover.ts packages/skill-packs/src/index.ts packages/skill-packs/test/discover.test.ts
git commit -m "feat(skill-packs): filesystem discovery with workspace-wins dedupe"
```

---

### Task 4: `scanSkillIdConflicts`

**Files:**
- Create: `packages/skill-packs/src/conflicts.ts`
- Modify: `packages/skill-packs/src/index.ts`
- Test: `packages/skill-packs/test/conflicts.test.ts`

- [ ] **Step 1: Write the failing suite**

```ts
// packages/skill-packs/test/conflicts.test.ts
import { describe, expect, it } from "vitest";
import type { DiscoveredPack } from "../src/discover.js";
import { scanSkillIdConflicts } from "../src/conflicts.js";

function pack(name: string, skillIds: string[]): DiscoveredPack {
  return {
    manifest: {
      name,
      version: "1.0.0",
      kind: "skill",
      skills: skillIds.map((id) => ({ id, entry: `skills/${id}.md` })),
      capabilities: [],
      description: null,
    },
    root: `/fake/${name}`,
    source: "workspace",
  };
}

describe("scanSkillIdConflicts", () => {
  it("returns empty for disjoint skill ids", () => {
    expect(scanSkillIdConflicts([pack("a", ["x"]), pack("b", ["y"])])).toEqual([]);
  });

  it("reports a conflict with both pack names", () => {
    const conflicts = scanSkillIdConflicts([pack("a", ["x"]), pack("b", ["x", "y"])]);
    expect(conflicts).toEqual([{ skillId: "x", packs: ["a", "b"] }]);
  });

  it("a single pack repeating its own id is not a cross-pack conflict", () => {
    expect(scanSkillIdConflicts([pack("a", ["x", "x"])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @megasaver/skill-packs test -- conflicts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/skill-packs/src/conflicts.ts
import type { DiscoveredPack } from "./discover.js";

export type SkillIdConflict = {
  skillId: string;
  packs: string[]; // pack names, in scan order
};

// Pure scan over an EFFECTIVE (name-deduped) set — callers must drop a
// pack being replaced/shadowed before scanning, or --force reinstall
// would self-conflict (spec §2c).
export function scanSkillIdConflicts(packs: readonly DiscoveredPack[]): SkillIdConflict[] {
  const owners = new Map<string, Set<string>>();
  for (const pack of packs) {
    for (const skill of pack.manifest.skills) {
      const set = owners.get(skill.id) ?? new Set<string>();
      set.add(pack.manifest.name);
      owners.set(skill.id, set);
    }
  }
  return [...owners.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([skillId, names]) => ({ skillId, packs: [...names] }));
}
```

Add `export * from "./conflicts.js";` to `index.ts`.

- [ ] **Step 4: Run to verify pass** — package test + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-packs/src/conflicts.ts packages/skill-packs/src/index.ts packages/skill-packs/test/conflicts.test.ts
git commit -m "feat(skill-packs): cross-pack skill-id conflict scan"
```

---

## SP2 — installer + CLI

### Task 5: `installPack` / `removePack`

**Files:**
- Create: `packages/skill-packs/src/install.ts`
- Modify: `packages/skill-packs/src/index.ts`
- Test: `packages/skill-packs/test/install.test.ts`

- [ ] **Step 1: Write the failing suite**

```ts
// packages/skill-packs/test/install.test.ts
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPack, removePack } from "../src/install.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: [],
  description: null,
};

async function seedSource(dir: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

describe("installPack / removePack", () => {
  let workspace: string;
  let source: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "sp-install-ws-"));
    source = await mkdtemp(join(tmpdir(), "sp-install-src-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  });

  function install(opts: { force?: boolean } = {}) {
    return installPack({
      sourceDir: source,
      workspaceRoot: workspace,
      home: "/nonexistent-home",
      xdgDataHome: undefined,
      force: opts.force ?? false,
    });
  }

  const installedDir = () => join(workspace, ".megasaver", "packs", "demo-pack");

  it("installs a valid pack into <workspace>/.megasaver/packs/<name>", async () => {
    await seedSource(source);
    const installed = await install();
    expect(installed.manifest.name).toBe("demo-pack");
    const files = await readdir(installedDir());
    expect(files).toContain("megasaver-pack.json");
  });

  it("validates BEFORE copy: invalid pack leaves packs root untouched", async () => {
    await seedSource(source, { name: "Bad Name" });
    await expect(install()).rejects.toMatchObject({ code: "manifest_invalid" });
    await expect(readdir(join(workspace, ".megasaver", "packs"))).rejects.toThrow();
  });

  it("pack_already_installed on collision without force; force replaces", async () => {
    await seedSource(source);
    await install();
    await expect(install()).rejects.toMatchObject({ code: "pack_already_installed" });
    await writeFile(join(source, "skills", "hello.md"), "# v2\n");
    const replaced = await install({ force: true });
    expect(replaced.manifest.name).toBe("demo-pack");
  });

  it("skill_id_conflict against an installed pack with the same skill id", async () => {
    await seedSource(source);
    await install();
    const other = await mkdtemp(join(tmpdir(), "sp-install-src2-"));
    try {
      await seedSource(other, { ...MANIFEST, name: "other-pack" });
      await expect(
        installPack({
          sourceDir: other,
          workspaceRoot: workspace,
          home: "/nonexistent-home",
          xdgDataHome: undefined,
          force: false,
        }),
      ).rejects.toMatchObject({ code: "skill_id_conflict" });
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("force reinstall of the same pack does NOT self-conflict (shadow-aware)", async () => {
    await seedSource(source);
    await install();
    await expect(install({ force: true })).resolves.toBeTruthy();
  });

  it("rejects a symlink anywhere in the source tree", async () => {
    await seedSource(source);
    const outside = join(source, "..", `sp-outside-${Date.now()}`);
    await writeFile(outside, "outside\n");
    try {
      await symlink(outside, join(source, "skills", "evil-link"));
      await expect(install()).rejects.toMatchObject({ code: "pack_path_escape" });
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("no .tmp-* residue after a failed install", async () => {
    await seedSource(source, { name: "Bad Name" });
    await install().catch(() => undefined);
    const packsRoot = join(workspace, ".megasaver", "packs");
    const entries = await readdir(packsRoot).catch(() => [] as string[]);
    expect(entries.filter((e) => e.startsWith(".tmp-"))).toEqual([]);
  });

  it("removePack removes an installed pack; pack_not_found for unknown", async () => {
    await seedSource(source);
    await install();
    await removePack({ name: "demo-pack", workspaceRoot: workspace });
    await expect(readdir(installedDir())).rejects.toThrow();
    await expect(removePack({ name: "demo-pack", workspaceRoot: workspace })).rejects.toMatchObject(
      { code: "pack_not_found" },
    );
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @megasaver/skill-packs test -- install` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/skill-packs/src/install.ts
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { scanSkillIdConflicts } from "./conflicts.js";
import { type DiscoveredPack, discoverPacks, workspacePacksRoot } from "./discover.js";
import { SkillPackError } from "./errors.js";
import { loadPack } from "./load-pack.js";

export type InstallPackInput = {
  sourceDir: string;
  workspaceRoot: string;
  home: string;
  xdgDataHome: string | undefined;
  force: boolean;
};

export type InstalledPack = {
  manifest: DiscoveredPack["manifest"];
  root: string;
};

function assertNoSymlinks(dir: string, packRoot: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) {
      throw new SkillPackError("pack_path_escape", `symlink in pack tree rejected: ${full}`, {
        packPath: packRoot,
      });
    }
    if (entry.isDirectory()) assertNoSymlinks(full, packRoot);
  }
}

export async function installPack(input: InstallPackInput): Promise<InstalledPack> {
  // 1. Validate BEFORE any copy (HH §5).
  const manifest = await loadPack(input.sourceDir);
  // 2. Symlink sweep over the whole source tree (spec §3a.2).
  assertNoSymlinks(input.sourceDir, input.sourceDir);

  // 3. Shadow-aware conflict scan: the incoming pack replaces/shadows
  //    any same-name pack, so drop those from the effective set first.
  const discovered = await discoverPacks({
    workspaceRoot: input.workspaceRoot,
    home: input.home,
    xdgDataHome: input.xdgDataHome,
  });
  const effective = discovered.packs.filter((p) => p.manifest.name !== manifest.name);
  const conflicts = scanSkillIdConflicts([
    ...effective,
    { manifest, root: input.sourceDir, source: "workspace" },
  ]);
  if (conflicts.length > 0) {
    const first = conflicts[0];
    throw new SkillPackError(
      "skill_id_conflict",
      `skill id "${first?.skillId}" already provided by: ${first?.packs.join(", ")}`,
      { packPath: input.sourceDir },
    );
  }

  // 4. Collision check.
  const packsRoot = workspacePacksRoot(input.workspaceRoot);
  const target = join(packsRoot, manifest.name);
  if (existsSync(target) && !input.force) {
    throw new SkillPackError("pack_already_installed", `pack already installed: ${manifest.name}`, {
      packPath: target,
    });
  }

  // 5. Atomic copy: stage to .tmp-<name>, then swap (spec §3a.5).
  const staging = join(packsRoot, `.tmp-${manifest.name}`);
  mkdirSync(packsRoot, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  try {
    cpSync(input.sourceDir, staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw new SkillPackError("pack_unreadable", `install copy failed: ${String(err)}`, {
      packPath: input.sourceDir,
      cause: err,
    });
  }
  return { manifest, root: target };
}

export type RemovePackInput = { name: string; workspaceRoot: string };

export async function removePack(input: RemovePackInput): Promise<void> {
  const target = join(workspacePacksRoot(input.workspaceRoot), input.name);
  if (!existsSync(target)) {
    throw new SkillPackError("pack_not_found", `no installed pack named: ${input.name}`, {
      packPath: target,
    });
  }
  rmSync(target, { recursive: true, force: true });
}
```

Add `export * from "./install.js";` to `index.ts`.

- [ ] **Step 4: Run to verify pass** — package test + typecheck green.

- [ ] **Step 5: Commit**

```bash
git add packages/skill-packs/src/install.ts packages/skill-packs/src/index.ts packages/skill-packs/test/install.test.ts
git commit -m "feat(skill-packs): atomic workspace installer with symlink guard"
```

---

### Task 6: CLI dependency + error mapping + allow-list

**Files:**
- Modify: `apps/cli/package.json` (devDependencies — add `"@megasaver/skill-packs": "workspace:*"` after `"@megasaver/policy"`)
- Modify: `apps/cli/test/dependency-graph.test.ts` (ALLOWED list + comment)
- Modify: `apps/cli/src/errors.ts` (one helper)

- [ ] **Step 1: Update the dependency-graph pin FIRST (it is the contract)**

In `apps/cli/test/dependency-graph.test.ts`, extend the allow-list and its WHY comment:

```ts
// §3c allow-list: apps/cli may import exactly these @megasaver/*
// packages. BB8 adds @megasaver/mcp-bridge (the `mega mcp` CLI drives
// the bridge's install/status facade); skill-packs-real adds
// @megasaver/skill-packs (the `mega pack` CLI drives the loader and
// installer directly — core does not depend on skill-packs, so a core
// re-export is not available). The arrow stays acyclic — skill-packs
// depends only on zod, never on the CLI.
// The non-Mega deps (citty, zod) are ignored by the @megasaver/ filter.
const ALLOWED_MEGA_DEPENDENCIES = [
  "@megasaver/connector-generic-cli",
  "@megasaver/connectors-shared",
  "@megasaver/content-store",
  "@megasaver/core",
  "@megasaver/mcp-bridge",
  "@megasaver/output-filter",
  "@megasaver/policy",
  "@megasaver/shared",
  "@megasaver/skill-packs",
];
```

(`FORBIDDEN_DEPENDENCIES` stays `["@megasaver/retrieval", "@megasaver/stats"]`.)

- [ ] **Step 2: Add the dep + install**

`apps/cli/package.json` devDependencies, alphabetical (after `@megasaver/shared`):

```json
    "@megasaver/skill-packs": "workspace:*",
```

Run: `pnpm install`

- [ ] **Step 3: Error helper**

In `apps/cli/src/errors.ts`, after `invalidChunkIdMessage`:

```ts
// `mega pack` boundary: SkillPackError codes surface verbatim so the
// CLI and library observe the same closed enum.
export function skillPackErrorMessage(code: string, detail: string): CliMessage {
  return { message: `error: ${code}: ${detail}`, exitCode: 1 };
}
```

- [ ] **Step 4: Verify** — `pnpm --filter @megasaver/cli test -- dependency-graph` → PASS; `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json pnpm-lock.yaml apps/cli/test/dependency-graph.test.ts apps/cli/src/errors.ts
git commit -m "feat(cli): admit skill-packs dep + error boundary helper"
```

---

### Task 7: `mega pack` command group

**Files:**
- Create: `apps/cli/src/commands/pack/shared.ts`, `install.ts`, `list.ts`, `remove.ts`, `info.ts`, `index.ts`
- Modify: `apps/cli/src/main.ts` (mount)
- Test: `apps/cli/test/pack.test.ts`

- [ ] **Step 1: Write the failing suite**

```ts
// apps/cli/test/pack.test.ts
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runPackInfo } from "../src/commands/pack/info.js";
import { runPackInstall } from "../src/commands/pack/install.js";
import { runPackList } from "../src/commands/pack/list.js";
import { runPackRemove } from "../src/commands/pack/remove.js";

const MANIFEST = {
  name: "demo-pack",
  version: "1.0.0",
  kind: "skill",
  skills: [{ id: "hello", entry: "skills/hello.md" }],
  capabilities: ["read-memory"],
  description: "A demo pack",
};

async function seedSource(dir: string, manifest: unknown = MANIFEST): Promise<void> {
  await mkdir(join(dir, "skills"), { recursive: true });
  await writeFile(join(dir, "megasaver-pack.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "skills", "hello.md"), "# hello\n");
}

type Sink = { out: string[]; err: string[] };
const sink = (): Sink => ({ out: [], err: [] });

describe("mega pack commands", () => {
  let workspace: string;
  let source: string;
  let s: Sink;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "cli-pack-ws-"));
    source = await mkdtemp(join(tmpdir(), "cli-pack-src-"));
    s = sink();
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  });

  const env = () => ({
    rootFlag: workspace,
    cwd: workspace,
    home: "/nonexistent-home",
    xdgDataHome: undefined,
    stdout: (l: string) => s.out.push(l),
    stderr: (l: string) => s.err.push(l),
  });

  it("install: text success line", async () => {
    await seedSource(source);
    const code = await runPackInstall({ ...env(), path: source, force: false, json: false });
    expect(code).toBe(0);
    expect(s.out.join("\n")).toContain("Installed demo-pack@1.0.0 (skill, 1 skills)");
  });

  it("install --json: emits manifest payload", async () => {
    await seedSource(source);
    const code = await runPackInstall({ ...env(), path: source, force: false, json: true });
    expect(code).toBe(0);
    const payload = JSON.parse(s.out[0] as string);
    expect(payload.manifest.name).toBe("demo-pack");
  });

  it("install failure: text stderr, exit 1, no stdout (json mode too)", async () => {
    await seedSource(source, { name: "Bad Name" });
    const code = await runPackInstall({ ...env(), path: source, force: false, json: true });
    expect(code).toBe(1);
    expect(s.out).toHaveLength(0);
    expect(s.err.join("\n")).toContain("error: manifest_invalid:");
  });

  it("list: shows installed packs and discovery warnings on stderr", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const broken = join(workspace, ".megasaver", "packs", "broken");
    await mkdir(broken, { recursive: true });
    await writeFile(join(broken, "megasaver-pack.json"), "{nope");
    const s2 = sink();
    const code = await runPackList({ ...env(), stdout: (l) => s2.out.push(l), stderr: (l) => s2.err.push(l), json: false });
    expect(code).toBe(0);
    expect(s2.out.join("\n")).toContain("demo-pack@1.0.0 skill workspace");
    expect(s2.err.join("\n")).toContain("broken");
  });

  it("list --json: { packs, warnings } shape", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    const code = await runPackList({ ...env(), stdout: (l) => s2.out.push(l), stderr: (l) => s2.err.push(l), json: true });
    expect(code).toBe(0);
    const payload = JSON.parse(s2.out[0] as string);
    expect(payload.packs).toHaveLength(1);
    expect(payload.warnings).toEqual([]);
  });

  it("info: workspace pack renders manifest fields", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    const code = await runPackInfo({ ...env(), stdout: (l) => s2.out.push(l), stderr: (l) => s2.err.push(l), name: "demo-pack", json: false });
    expect(code).toBe(0);
    const joined = s2.out.join("\n");
    expect(joined).toContain("demo-pack");
    expect(joined).toContain("1.0.0");
    expect(joined).toContain("read-memory");
  });

  it("info: unknown pack → pack_not_found, exit 1", async () => {
    const code = await runPackInfo({ ...env(), name: "ghost", json: false });
    expect(code).toBe(1);
    expect(s.err.join("\n")).toContain("error: pack_not_found:");
  });

  it("remove: removes and reports; second remove → pack_not_found", async () => {
    await seedSource(source);
    await runPackInstall({ ...env(), path: source, force: false, json: false });
    const s2 = sink();
    let code = await runPackRemove({ ...env(), stdout: (l) => s2.out.push(l), stderr: (l) => s2.err.push(l), name: "demo-pack", json: false });
    expect(code).toBe(0);
    expect(s2.out.join("\n")).toContain("Removed demo-pack");
    code = await runPackRemove({ ...env(), name: "demo-pack", json: false });
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @megasaver/cli test -- pack` → FAIL (modules missing).

- [ ] **Step 3: Implement the command group**

```ts
// apps/cli/src/commands/pack/shared.ts
import { isAbsolute, resolve } from "node:path";
import { SkillPackError } from "@megasaver/skill-packs";
import { type CliMessage, skillPackErrorMessage } from "../../errors.js";

export type PackEnv = {
  rootFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// --root defaults to cwd (mirrors `mega project create --root`). The
// future skill runtime resolves packs via the registered
// project.rootPath, so installs should target the project root.
export function resolveWorkspaceRoot(env: PackEnv): string {
  if (env.rootFlag !== undefined && env.rootFlag !== "") {
    return isAbsolute(env.rootFlag) ? env.rootFlag : resolve(env.cwd, env.rootFlag);
  }
  return env.cwd;
}

export function packErrorToCli(err: unknown): CliMessage {
  if (err instanceof SkillPackError) return skillPackErrorMessage(err.code, err.message);
  return { message: `error: unexpected failure: ${String(err)}`, exitCode: 1 };
}
```

```ts
// apps/cli/src/commands/pack/install.ts
import { installPack } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackInstallInput = PackEnv & { path: string; force: boolean; json: boolean };

export async function runPackInstall(input: RunPackInstallInput): Promise<0 | 1> {
  try {
    const installed = await installPack({
      sourceDir: input.path,
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      force: input.force,
    });
    if (input.json) {
      input.stdout(JSON.stringify({ manifest: installed.manifest, root: installed.root }));
    } else {
      const m = installed.manifest;
      input.stdout(`Installed ${m.name}@${m.version} (${m.kind}, ${m.skills.length} skills)`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packInstallCommand = defineCommand({
  meta: { name: "install", description: "Install a skill pack into the workspace." },
  args: {
    path: { type: "positional", required: true, description: "Path to the pack directory." },
    force: { type: "boolean", default: false, description: "Replace an existing install." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackInstall({
      path: typeof args.path === "string" ? args.path : "",
      force: !!args.force,
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

```ts
// apps/cli/src/commands/pack/list.ts
import { discoverPacks } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackListInput = PackEnv & { json: boolean };

export async function runPackList(input: RunPackListInput): Promise<0 | 1> {
  try {
    const result = await discoverPacks({
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
    for (const warning of result.warnings) input.stderr(`warning: ${warning}`);
    if (input.json) {
      input.stdout(JSON.stringify({ packs: result.packs, warnings: result.warnings }));
      return 0;
    }
    if (result.packs.length === 0) {
      input.stdout("No packs installed.");
      return 0;
    }
    for (const pack of result.packs) {
      const m = pack.manifest;
      input.stdout(`${m.name}@${m.version} ${m.kind} ${pack.source}`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packListCommand = defineCommand({
  meta: { name: "list", description: "List discovered skill packs (workspace + global)." },
  args: {
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackList({
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

```ts
// apps/cli/src/commands/pack/remove.ts
import { removePack } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackRemoveInput = PackEnv & { name: string; json: boolean };

export async function runPackRemove(input: RunPackRemoveInput): Promise<0 | 1> {
  try {
    await removePack({ name: input.name, workspaceRoot: resolveWorkspaceRoot(input) });
    if (input.json) {
      input.stdout(JSON.stringify({ removed: input.name }));
    } else {
      input.stdout(`Removed ${input.name}`);
    }
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packRemoveCommand = defineCommand({
  meta: { name: "remove", description: "Remove an installed skill pack from the workspace." },
  args: {
    name: { type: "positional", required: true, description: "Installed pack name." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackRemove({
      name: typeof args.name === "string" ? args.name : "",
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

```ts
// apps/cli/src/commands/pack/info.ts
import { SkillPackError, discoverPacks } from "@megasaver/skill-packs";
import { defineCommand } from "citty";
import { type PackEnv, packErrorToCli, resolveWorkspaceRoot } from "./shared.js";

export type RunPackInfoInput = PackEnv & { name: string; json: boolean };

export async function runPackInfo(input: RunPackInfoInput): Promise<0 | 1> {
  try {
    const result = await discoverPacks({
      workspaceRoot: resolveWorkspaceRoot(input),
      home: input.home,
      xdgDataHome: input.xdgDataHome,
    });
    // discoverPacks already dedupes workspace-over-global (HH §4).
    const pack = result.packs.find((p) => p.manifest.name === input.name);
    if (!pack) {
      throw new SkillPackError("pack_not_found", `no discovered pack named: ${input.name}`);
    }
    if (input.json) {
      input.stdout(JSON.stringify(pack));
      return 0;
    }
    const m = pack.manifest;
    input.stdout(`${m.name}@${m.version} (${m.kind}, ${pack.source})`);
    input.stdout(`root: ${pack.root}`);
    input.stdout(`skills: ${m.skills.map((s) => s.id).join(", ") || "none"}`);
    input.stdout(`capabilities: ${m.capabilities.join(", ") || "none"}`);
    if (m.description) input.stdout(`description: ${m.description}`);
    return 0;
  } catch (err) {
    const cli = packErrorToCli(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const packInfoCommand = defineCommand({
  meta: { name: "info", description: "Show a discovered pack's manifest." },
  args: {
    name: { type: "positional", required: true, description: "Pack name." },
    root: { type: "string", description: "Workspace root (defaults to cwd)." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runPackInfo({
      name: typeof args.name === "string" ? args.name : "",
      json: !!args.json,
      rootFlag: typeof args.root === "string" ? args.root : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

```ts
// apps/cli/src/commands/pack/index.ts
import { defineCommand } from "citty";
import { packInfoCommand } from "./info.js";
import { packInstallCommand } from "./install.js";
import { packListCommand } from "./list.js";
import { packRemoveCommand } from "./remove.js";

export const packCommand = defineCommand({
  meta: { name: "pack", description: "Manage skill packs." },
  subCommands: {
    install: packInstallCommand,
    list: packListCommand,
    remove: packRemoveCommand,
    info: packInfoCommand,
  },
});

export { runPackInstall } from "./install.js";
export { runPackList } from "./list.js";
export { runPackRemove } from "./remove.js";
export { runPackInfo } from "./info.js";
```

Mount in `apps/cli/src/main.ts`: import `packCommand` from `./commands/pack/index.js` and add `pack: packCommand,` after `mcp: mcpCommand,`.

Note: `errors.ts` may not export `CliMessage` as a type usable in shared.ts — check the existing export (`export type CliMessage`); it exists (used by every helper).

- [ ] **Step 4: Run to verify pass** — `pnpm --filter @megasaver/cli test -- pack && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/pack apps/cli/src/main.ts apps/cli/test/pack.test.ts
git commit -m "feat(cli): mega pack install/list/remove/info"
```

---

### Task 8: `--json` drift guards + workspace-beats-global test

**Files:**
- Modify: `apps/cli/test/pack.test.ts` (append)

- [ ] **Step 1: Append drift guards + shadowing test**

```ts
// Append inside the top-level describe in apps/cli/test/pack.test.ts:
import { packInfoCommand } from "../src/commands/pack/info.js";
import { packInstallCommand } from "../src/commands/pack/install.js";
import { packListCommand } from "../src/commands/pack/list.js";
import { packRemoveCommand } from "../src/commands/pack/remove.js";
// (imports go at the top of the file)

  describe("--json flag drift guards", () => {
    const commands = [
      ["install", packInstallCommand],
      ["list", packListCommand],
      ["remove", packRemoveCommand],
      ["info", packInfoCommand],
    ] as const;
    it.each(commands)("%s: json flag shape is pinned", (_name, command) => {
      const arg = (command.args as Record<string, { type: string; default?: boolean; description?: string }>).json;
      expect(arg.type).toBe("boolean");
      expect(arg.default).toBe(false);
      expect(arg.description).toBe("Emit JSON output.");
    });
  });

  it("info: workspace pack shadows a same-name global pack", async () => {
    const xdg = await mkdtemp(join(tmpdir(), "cli-pack-xdg-"));
    try {
      await seedSource(source);
      // global copy with a different version
      const globalDir = join(xdg, "megasaver", "packs", "demo-pack");
      await mkdir(join(globalDir, "skills"), { recursive: true });
      await writeFile(
        join(globalDir, "megasaver-pack.json"),
        JSON.stringify({ ...MANIFEST, version: "9.9.9" }),
      );
      await writeFile(join(globalDir, "skills", "hello.md"), "# global\n");
      await runPackInstall({ ...env(), path: source, force: false, json: false });
      const s2 = sink();
      const code = await runPackInfo({
        ...env(),
        xdgDataHome: xdg,
        stdout: (l) => s2.out.push(l),
        stderr: (l) => s2.err.push(l),
        name: "demo-pack",
        json: true,
      });
      expect(code).toBe(0);
      const payload = JSON.parse(s2.out[0] as string);
      expect(payload.manifest.version).toBe("1.0.0");
      expect(payload.source).toBe("workspace");
    } finally {
      await rm(xdg, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run** — `pnpm --filter @megasaver/cli test -- pack` → PASS (these pin existing behavior; any FAIL is an implementation bug — fix it).

- [ ] **Step 3: Commit**

```bash
git add apps/cli/test/pack.test.ts
git commit -m "test(cli): pack drift guards + workspace-shadows-global pin"
```

---

### Task 9: Verify + smoke evidence

- [ ] **Step 1:** `pnpm verify` → green (fix anything; `pnpm lint:fix` for biome style).

- [ ] **Step 2: Smoke (built CLI, temp dirs)**

```bash
pnpm --filter @megasaver/cli build
WS=$(mktemp -d); SRC=$(mktemp -d)
mkdir -p "$SRC/skills"
cat > "$SRC/megasaver-pack.json" << 'EOF'
{"name":"smoke-pack","version":"1.0.0","kind":"skill","skills":[{"id":"hi","entry":"skills/hi.md"}],"capabilities":[],"description":"smoke"}
EOF
echo "# hi" > "$SRC/skills/hi.md"
node apps/cli/dist/cli.js pack install "$SRC" --root "$WS"
node apps/cli/dist/cli.js pack list --root "$WS"
node apps/cli/dist/cli.js pack info smoke-pack --root "$WS" --json
node apps/cli/dist/cli.js pack remove smoke-pack --root "$WS"
node apps/cli/dist/cli.js pack list --root "$WS"
```

Expected: `Installed smoke-pack@1.0.0 (skill, 1 skills)` → list shows it → info JSON carries the manifest → `Removed smoke-pack` → `No packs installed.` Capture as DoD evidence.

---

### Task 10: Changeset + wiki

- [ ] **Step 1:** `.changeset/skill-packs-real.md`:

```md
---
"@megasaver/skill-packs": minor
"@megasaver/cli": minor
---

Real skill-packs subsystem: loadPack (manifest validation, path-escape
and symlink guards), filesystem discovery (workspace beats global),
atomic workspace installer with skill-id conflict detection, and the
`mega pack {install,list,remove,info}` CLI. Retires the
not_implemented placeholder error code.
```

- [ ] **Step 2: Wiki (worktree copies):**
  - Create `wiki/entities/skill-packs.md` (NEW — closes the index "pending" slot): frontmatter per wiki/CLAUDE.md; sections: what the package ships (loader/discovery/conflicts/installer), on-disk layout (`<workspace>/.megasaver/packs/<name>`, global XDG root, `.tmp-*` staging), error enum (7 members), security guards (containment, symlink rejection), CLI surface pointer to [[entities/cli]].
  - `wiki/entities/cli.md`: add `mega pack` section (4 subcommands, `--root`/`--json` flags, failure policy).
  - `wiki/index.md`: entities list gains `[[entities/skill-packs]]`; remove `skill-packs` from the "pending" note; quick-links row `What does mega pack do? → entities/cli`.
  - `wiki/syntheses/post-v1.1-roadmap.md`: item 2 → RESOLVED with PR ref.
  - `wiki/log.md`: `## [2026-06-10] feat | skill-packs real implementation (PR #TBD)` (stamp number at PR time).

- [ ] **Step 3: Commit**

```bash
git add .changeset wiki
git commit -m "docs(wiki): skill-packs subsystem recorded"
```

---

### Task 11: Critic review + PR (HIGH gate)

- [ ] Dispatch adversarial **critic** review (author ≠ reviewer) — HIGH risk requires critic, not just code-reviewer. Findings: fix Critical/Important before merge.
- [ ] Push, open PR `feat: real skill-packs subsystem (loader + installer + mega pack CLI)`; body links spec + plan, includes smoke evidence + security notes (containment, symlink rejection, atomic copy).
- [ ] CI green → squash-merge → stamp PR number in `wiki/log.md` pre-merge → cleanup worktree.
