# mega compress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `mega compress <path>` — a Pro-gated command that runs the existing `compressProse` engine over one `.md`/`.txt`/`.mdc` file, previews the lossy result + savings by default, and on `--apply` atomically overwrites the file after writing a mandatory `<path>.bak`.

**Architecture:** The extractive engine (`compressProse`) already exists in `@megasaver/output-filter`; we expose it from that package's public entry (one line). A new pure composer in `@megasaver/pro-analytics` (`composeCompressionReport` + `renderCompressionSummary`) measures the before/after strings — it does NOT import the engine, so pro-analytics gains no dependency. The CLI command (`apps/cli/src/commands/compress.ts`) gates on entitlement first, then orchestrates read → compress (core, static import) → measure (Pro, lazy import) → dry-run preview or `--apply` write. All fs + git access is injected for deterministic tests; the default writer is atomic (temp-in-same-dir + rename). savings-fix R5 advice is re-pointed at the new command (basename only, preserving the m6 privacy invariant).

**Tech Stack:** TypeScript strict ESM, Vitest, Citty, Node `node:fs`/`node:child_process`, `@megasaver/entitlement` (Ed25519 offline licenses), `@megasaver/stats` money model.

**Risk:** CRITICAL — first module to mutate user repo files. Slice D runs the full CRITICAL review chain (code-reviewer + critic + security-reviewer + tracer + 3-lens final) in a worktree.

---

## File Structure

- Create: `packages/pro-analytics/src/compress-file.ts` — pure `composeCompressionReport` + `renderCompressionSummary` + `CompressionReport` type.
- Create: `packages/pro-analytics/test/compress-file.test.ts` — engine unit tests.
- Modify: `packages/pro-analytics/src/index.ts` — re-export the new engine symbols.
- Modify: `packages/output-filter/src/index.ts` — expose `compressProse`.
- Modify: `packages/output-filter/test/compress-prose.test.ts` — assert `compressProse` is importable from the package public entry.
- Create: `apps/cli/src/commands/compress.ts` — `runCompress` + `compressCommand` + `defaultCompressFs`.
- Create: `apps/cli/test/commands/compress.test.ts` — CLI gating, guards, apply, real-fs round-trip.
- Modify: `packages/pro-analytics/src/fix.ts` — R5 `command` pointer.
- Modify: `packages/pro-analytics/test/fix.test.ts` — R5 command assertions.
- Modify: `packages/pro-analytics/test/teardown.test.ts` — privacy addendum for the R5 command.
- Modify: `apps/cli/src/main.ts` — register `compress`.
- Modify: `README.md` — command row + Pro lines.
- Create: `.changeset/compress.md` — `@megasaver/cli` minor.

---

## Slice A — pure engine + expose compressProse

### Task 1: Expose `compressProse` from output-filter's public entry

**Files:**
- Modify: `packages/output-filter/src/index.ts`
- Test: `packages/output-filter/test/compress-prose.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing file)

```ts
import { compressProse as compressProseFromIndex } from "../src/index.js";

describe("compressProse public export", () => {
  it("is reachable from the package entry and compresses", () => {
    const doc = `${"# H\n"}${"para one\n\npara two\n\npara three\n\npara four\n\npara five\n\npara six\n"}`;
    const out = compressProseFromIndex(doc);
    expect(out).toContain("# H");
    expect(out).toContain("… [");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/output-filter test compress-prose`
Expected: FAIL — `compressProseFromIndex is not a function` (not yet exported from index).

- [ ] **Step 3: Add the export** (in `packages/output-filter/src/index.ts`, directly after the `compressByCategory` export on line 12)

```ts
export { compressByCategory, type CompressorName } from "./compress/index.js";
export { compressProse } from "./compress/prose.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/output-filter test compress-prose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/output-filter/src/index.ts packages/output-filter/test/compress-prose.test.ts
git commit -m "feat(output-filter): expose compressProse from package entry"
```

### Task 2: `composeCompressionReport` + `renderCompressionSummary`

**Files:**
- Create: `packages/pro-analytics/src/compress-file.ts`
- Test: `packages/pro-analytics/test/compress-file.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { composeCompressionReport, renderCompressionSummary } from "../src/compress-file.js";

describe("composeCompressionReport", () => {
  it("counts markers and computes byte/token/dollar savings", () => {
    const original = "x".repeat(400);
    const compressed = "# H\n… [3 paragraphs]\n… [5 more items]";
    const r = composeCompressionReport(original, compressed);
    expect(r.paragraphsCollapsed).toBe(3);
    expect(r.listItemsDropped).toBe(5);
    expect(r.changed).toBe(true);
    expect(r.originalBytes).toBe(400);
    expect(r.compressedBytes).toBe(Buffer.byteLength(compressed, "utf8"));
    expect(r.bytesSaved).toBe(400 - r.compressedBytes);
    expect(r.tokensSaved).toBeGreaterThan(0);
    expect(r.dollarsSaved).toBeCloseTo((r.tokensSaved / 1_000_000) * 3, 10);
  });

  it("reports no change and zero savings for identical strings", () => {
    const r = composeCompressionReport("same", "same");
    expect(r.changed).toBe(false);
    expect(r.bytesSaved).toBe(0);
    expect(r.tokensSaved).toBe(0);
    expect(r.dollarsSaved).toBe(0);
    expect(r.paragraphsCollapsed).toBe(0);
    expect(r.listItemsDropped).toBe(0);
  });

  it("counts singular markers", () => {
    const r = composeCompressionReport("orig-longer-than-out", "… [1 paragraph]\n… [1 more item]");
    expect(r.paragraphsCollapsed).toBe(1);
    expect(r.listItemsDropped).toBe(1);
  });

  it("sums paragraph markers across sections", () => {
    const r = composeCompressionReport("orig", "… [2 paragraphs]\n# H\n… [4 paragraphs]");
    expect(r.paragraphsCollapsed).toBe(6);
  });

  it("prices by utf8 byte length, not char length", () => {
    const original = "héllo…café☕";
    const r = composeCompressionReport(original, "x");
    expect(r.originalBytes).toBeGreaterThan(original.length);
  });
});

describe("renderCompressionSummary", () => {
  it("shows counts, (est.) dollars, and the verbatim note", () => {
    const r = composeCompressionReport("x".repeat(500), "# H\n… [3 paragraphs]");
    const s = renderCompressionSummary(r);
    expect(s).toContain("(est.)");
    expect(s).toContain("Lossy");
    expect(s).toContain("verbatim");
    expect(s).toContain("3 extra paragraph");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/pro-analytics test compress-file`
Expected: FAIL — cannot resolve `../src/compress-file.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/pro-analytics/src/compress-file.ts`:

```ts
import { INPUT_PRICE_PER_MTOK_USD, tokensFromBytes } from "@megasaver/stats";

export interface CompressionReport {
  originalBytes: number;
  compressedBytes: number;
  bytesSaved: number;
  tokensOriginal: number;
  tokensCompressed: number;
  tokensSaved: number;
  dollarsSaved: number;
  paragraphsCollapsed: number;
  listItemsDropped: number;
  changed: boolean;
  compressed: string;
}

// These match the exact markers compressProse emits (singular for N=1). The
// counts are a display aid derived by scanning output; the byte/token/dollar
// figures below are exact and independent of this scan.
const PARA_MARKER = /… \[(\d+) paragraphs?\]/g;
const LIST_MARKER = /… \[(\d+) more items?\]/g;

function sumMarkers(text: string, re: RegExp): number {
  let total = 0;
  for (const m of text.matchAll(re)) total += Number(m[1]);
  return total;
}

export function composeCompressionReport(original: string, compressed: string): CompressionReport {
  const originalBytes = Buffer.byteLength(original, "utf8");
  const compressedBytes = Buffer.byteLength(compressed, "utf8");
  const tokensOriginal = tokensFromBytes(originalBytes);
  const tokensCompressed = tokensFromBytes(compressedBytes);
  const tokensSaved = Math.max(0, tokensOriginal - tokensCompressed);
  return {
    originalBytes,
    compressedBytes,
    bytesSaved: Math.max(0, originalBytes - compressedBytes),
    tokensOriginal,
    tokensCompressed,
    tokensSaved,
    dollarsSaved: (tokensSaved / 1_000_000) * INPUT_PRICE_PER_MTOK_USD,
    paragraphsCollapsed: sumMarkers(compressed, PARA_MARKER),
    listItemsDropped: sumMarkers(compressed, LIST_MARKER),
    changed: compressed !== original,
    compressed,
  };
}

export function renderCompressionSummary(report: CompressionReport): string {
  return [
    "Lossy compression (deterministic, no model):",
    `  ${report.paragraphsCollapsed} extra paragraph(s) collapse to "… [N paragraphs]" markers`,
    `  ${report.listItemsDropped} list item(s) beyond the first 3 collapse to "… [N more items]"`,
    "  headings, code blocks, blockquotes, and each section's first paragraph kept verbatim",
    `Savings: ${report.originalBytes}→${report.compressedBytes} bytes · ~${report.tokensSaved} tokens · ~$${report.dollarsSaved.toFixed(2)} (est.)`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics test compress-file`
Expected: PASS (all cases).

- [ ] **Step 5: Re-export from the package index**

In `packages/pro-analytics/src/index.ts`, append after the `bench.js` export block:

```ts
export {
  type CompressionReport,
  composeCompressionReport,
  renderCompressionSummary,
} from "./compress-file.js";
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @megasaver/pro-analytics typecheck`
Expected: no errors.

```bash
git add packages/pro-analytics/src/compress-file.ts packages/pro-analytics/src/index.ts packages/pro-analytics/test/compress-file.test.ts
git commit -m "feat(pro-analytics): compression report composer + summary renderer"
```

---

## Slice B — gated CLI command

### Task 3: `runCompress` + `compressCommand` + `defaultCompressFs`

**Files:**
- Create: `apps/cli/src/commands/compress.ts`
- Test: `apps/cli/test/commands/compress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/test/commands/compress.test.ts`:

```ts
import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompressFs, GitFileStatus } from "../../src/commands/compress.js";
import { runCompress } from "../../src/commands/compress.js";

const proSpies = vi.hoisted(() => ({ compose: vi.fn() }));
vi.mock("@megasaver/pro-analytics", async (importActual) => {
  const actual = await importActual<typeof import("@megasaver/pro-analytics")>();
  proSpies.compose.mockImplementation(actual.composeCompressionReport);
  return { ...actual, composeCompressionReport: proSpies.compose };
});

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = 1_700_000_000_000;
const now = () => NOW_MS;

// An oversized doc the engine WILL compress (many paragraphs + a long list).
const BIG_DOC = [
  "# Title",
  "first paragraph kept",
  "",
  "second paragraph dropped",
  "",
  "third paragraph dropped",
  "",
  "fourth paragraph dropped",
  "",
  "- a",
  "- b",
  "- c",
  "- d",
  "- e",
  "- f",
  "",
  `${"filler ".repeat(120)}`,
].join("\n");

let root: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-cmp-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  proSpies.compose.mockClear();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

// Build a single fake fs and keep its writes array. `fsOver` patches individual
// members but the returned `writes` ALWAYS tracks the fs that runCompress uses —
// so write-count assertions are reliable no matter which member is overridden.
function fakeFs(over: Partial<CompressFs> = {}): { fs: CompressFs; writes: Array<[string, string]> } {
  const writes: Array<[string, string]> = [];
  const fs: CompressFs = {
    readFile: () => BIG_DOC,
    fileExists: () => true,
    writeFile: (p, c) => void writes.push([p, c]),
    gitFileStatus: (): GitFileStatus => "clean",
    ...over,
  };
  return { fs, writes };
}

function scenario(
  over: {
    fsOver?: Partial<CompressFs>;
    apply?: boolean;
    force?: boolean;
    json?: boolean;
    path?: string;
  } = {},
) {
  const { fs, writes } = fakeFs(over.fsOver);
  const inp: Parameters<typeof runCompress>[0] = {
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    path: over.path ?? join(root, "CLAUDE.md"),
    fs,
    stdout,
    stderr,
    ...(over.apply !== undefined ? { apply: over.apply } : {}),
    ...(over.force !== undefined ? { force: over.force } : {}),
    ...(over.json !== undefined ? { json: over.json } : {}),
  };
  return { inp, writes };
}

describe("runCompress — gating", () => {
  it.each([{}, { apply: true }, { apply: true, force: true }, { json: true }])(
    "with NO license (%o): upsell, exit 0, nothing read/compressed/written",
    async (flags) => {
      const { fs, writes } = fakeFs();
      const readFile = vi.fn(fs.readFile);
      const gitFileStatus = vi.fn(fs.gitFileStatus);
      const writeFile = vi.fn(fs.writeFile);
      const code = await runCompress({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        path: join(root, "CLAUDE.md"),
        fs: { ...fs, readFile, gitFileStatus, writeFile },
        stdout,
        stderr,
        ...flags,
      });
      expect(code).toBe(0);
      expect(out.join("\n")).toContain("mega license activate");
      expect(readFile).not.toHaveBeenCalled();
      expect(writeFile).not.toHaveBeenCalled();
      expect(gitFileStatus).not.toHaveBeenCalled();
      expect(proSpies.compose).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    },
  );
});

describe("runCompress — entitled", () => {
  beforeEach(() => activatePro());

  it("rejects a disallowed extension before reading", async () => {
    const readFile = vi.fn(() => BIG_DOC);
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path: join(root, "notes.js"),
      fs: fakeFs({ readFile }).fs,
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(".md");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("errors when the file does not exist", async () => {
    const { inp, writes } = scenario({ fsOver: { fileExists: () => false } });
    const code = await runCompress(inp);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("no such file");
    expect(writes).toHaveLength(0);
  });

  it("dry-run prints a preview and writes nothing", async () => {
    const { inp, writes } = scenario();
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Savings:");
    expect(out.join("\n")).toContain("--apply");
    expect(writes).toHaveLength(0);
  });

  it("dry-run on an already-tight file reports it and writes nothing", async () => {
    const { inp, writes } = scenario({ fsOver: { readFile: () => "# Tiny\nshort" } });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("already tight");
    expect(writes).toHaveLength(0);
  });

  it("--json emits the report and writes nothing even with --apply", async () => {
    const { inp, writes } = scenario({ json: true, apply: true });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    const r = JSON.parse(out.join("\n")) as { changed: boolean; bytesSaved: number };
    expect(r.changed).toBe(true);
    expect(r.bytesSaved).toBeGreaterThan(0);
    expect(writes).toHaveLength(0);
  });

  it("--apply writes .bak then the compressed file, in that order", async () => {
    const path = join(root, "CLAUDE.md");
    const { inp, writes } = scenario({ apply: true, path });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toBe(`${path}.bak`);
    expect(writes[0][1]).toBe(BIG_DOC);
    expect(writes[1][0]).toBe(path);
    expect(writes[1][1]).not.toBe(BIG_DOC);
    expect(out.join("\n")).toContain(`mv ${path}.bak ${path}`);
  });

  it("--apply refuses a git-dirty file without --force", async () => {
    const { inp, writes } = scenario({ apply: true, fsOver: { gitFileStatus: () => "dirty" } });
    const code = await runCompress(inp);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--force");
    expect(writes).toHaveLength(0);
  });

  it("--apply --force overrides the git-dirty guard", async () => {
    const { inp, writes } = scenario({
      apply: true,
      force: true,
      fsOver: { gitFileStatus: () => "dirty" },
    });
    expect(await runCompress(inp)).toBe(0);
    expect(writes).toHaveLength(2);
  });

  it("--apply refuses to clobber an existing .bak without --force", async () => {
    const path = join(root, "CLAUDE.md");
    const { inp, writes } = scenario({
      apply: true,
      path,
      fsOver: { fileExists: (p) => p === `${path}.bak` || p === path },
    });
    const code = await runCompress(inp);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("backup already exists");
    expect(writes).toHaveLength(0);
  });

  it("--apply on an already-tight file writes nothing", async () => {
    const { inp, writes } = scenario({ apply: true, fsOver: { readFile: () => "# Tiny\nshort" } });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("not writing");
    expect(writes).toHaveLength(0);
  });

  it.each<GitFileStatus>(["untracked", "unknown"])(
    "--apply proceeds for git status %s (the .bak is the safety net)",
    async (status) => {
      const { inp, writes } = scenario({ apply: true, fsOver: { gitFileStatus: () => status } });
      expect(await runCompress(inp)).toBe(0);
      expect(writes).toHaveLength(2);
    },
  );

  it("real-fs round-trip: real compressProse + default atomic writer, backup restores original", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, BIG_DOC);
    const fs = defaultCompressFs();
    // dry-run first: reports a real change (guards the marker-regex ↔ engine coupling)
    const dry = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      fs,
      stdout,
      stderr,
    });
    expect(dry).toBe(0);
    expect(out.join("\n")).toContain("Savings:");
    // apply
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      fs,
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const after = readFileSync(path, "utf8");
    expect(Buffer.byteLength(after)).toBeLessThan(Buffer.byteLength(BIG_DOC));
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
    // no leftover temp files
    expect(readdirSync(root).some((f) => f.endsWith(".tmp"))).toBe(false);
    // restore works
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/cli test compress`
Expected: FAIL — cannot resolve `../../src/commands/compress.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/cli/src/commands/compress.ts`:

```ts
import { execFileSync } from "node:child_process";
import type { KeyObject } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { checkEntitlement } from "@megasaver/entitlement";
import { compressProse } from "@megasaver/output-filter";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { PRO_ANALYTICS_URL } from "./savings/index.js";

export const COMPRESS_UPSELL = `Reversible memory-file compression is a Mega Saver Pro feature. Activate a key: mega license activate <key>. Learn more: ${PRO_ANALYTICS_URL}.`;

const ALLOWED_EXTENSIONS = new Set([".md", ".txt", ".mdc"]);

export type GitFileStatus = "clean" | "dirty" | "untracked" | "unknown";

export type CompressFs = {
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  gitFileStatus: (path: string) => GitFileStatus;
};

function defaultGitFileStatus(path: string): GitFileStatus {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", path], {
      cwd: dirname(path),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim() === "") return "clean";
    if (out.startsWith("??")) return "untracked";
    return "dirty";
  } catch {
    return "unknown";
  }
}

export function defaultCompressFs(): CompressFs {
  return {
    readFile: (path) => readFileSync(path, "utf8"),
    fileExists: (path) => existsSync(path),
    // Atomic: temp file in the SAME directory (rename is only atomic within a
    // filesystem), then rename over the target. Mirrors hooks/intent-run.ts.
    writeFile: (path, content) => {
      const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
      writeFileSync(tmp, content);
      renameSync(tmp, path);
    },
    gitFileStatus: (path) => defaultGitFileStatus(path),
  };
}

export type RunCompressInput = {
  storeRoot: string;
  now: () => number;
  publicKey?: KeyObject | string;
  path: string;
  apply?: boolean;
  force?: boolean;
  json?: boolean;
  fs: CompressFs;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runCompress(input: RunCompressInput): Promise<0 | 1> {
  const ent = checkEntitlement("savings-analytics", {
    storeRoot: input.storeRoot,
    now: input.now,
    ...(input.publicKey === undefined ? {} : { publicKey: input.publicKey }),
  });
  if (!ent.entitled) {
    input.stdout(COMPRESS_UPSELL);
    return 0;
  }

  if (!ALLOWED_EXTENSIONS.has(extname(input.path).toLowerCase())) {
    input.stderr("mega compress only accepts .md, .txt, or .mdc files");
    return 1;
  }

  if (!input.fs.fileExists(input.path)) {
    input.stderr(`no such file: ${input.path}`);
    return 1;
  }

  const original = input.fs.readFile(input.path);
  const compressed = compressProse(original);
  const { composeCompressionReport, renderCompressionSummary } = await import(
    "@megasaver/pro-analytics"
  );
  const report = composeCompressionReport(original, compressed);

  if (input.json) {
    input.stdout(JSON.stringify(report));
    return 0;
  }

  if (input.apply !== true) {
    if (!report.changed) {
      input.stdout("already tight — nothing to compress");
      return 0;
    }
    input.stdout(renderCompressionSummary(report));
    input.stdout("Lossy: paragraph bodies and list tails become markers.");
    input.stdout(`Re-run with --apply to overwrite (a ${input.path}.bak backup is written first).`);
    return 0;
  }

  if (!report.changed) {
    input.stdout("already tight — nothing to compress; not writing");
    return 0;
  }

  if (input.fs.gitFileStatus(input.path) === "dirty" && input.force !== true) {
    input.stderr(`${input.path} has uncommitted changes — commit them or re-run with --force`);
    return 1;
  }

  const bak = `${input.path}.bak`;
  if (input.fs.fileExists(bak) && input.force !== true) {
    input.stderr(`backup already exists: ${bak} — remove it or re-run with --force`);
    return 1;
  }

  input.fs.writeFile(bak, original);
  input.fs.writeFile(input.path, report.compressed);
  input.stdout(
    `compressed ${input.path}: ${report.bytesSaved} bytes (~${report.tokensSaved} tokens, ~$${report.dollarsSaved.toFixed(2)} est.) saved`,
  );
  input.stdout(`backed up to ${bak}`);
  input.stdout(`restore with: mv ${bak} ${input.path}`);
  return 0;
}

export const compressCommand = defineCommand({
  meta: {
    name: "compress",
    description:
      "Compress a memory/doc file with the extractive prose engine — dry-run by default, reversible on --apply (Mega Saver Pro).",
  },
  args: {
    path: {
      type: "positional",
      required: true,
      description: "File to compress (.md, .txt, or .mdc).",
    },
    apply: {
      type: "boolean",
      default: false,
      description: "Overwrite the file (a <path>.bak backup is written first).",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Override the git-dirty and existing-backup guards.",
    },
    json: {
      type: "boolean",
      default: false,
      description: "Emit the CompressionReport as JSON (never writes).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runCompress({
      storeRoot,
      now: () => Date.now(),
      path: resolve(String(args.path)),
      apply: !!args.apply,
      force: !!args.force,
      json: !!args.json,
      fs: defaultCompressFs(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/cli test compress`
Expected: PASS (all cases, incl. real-fs round-trip).

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/compress.ts apps/cli/test/commands/compress.test.ts
git commit -m "feat(cli): mega compress — dry-run default, reversible .bak apply"
```

---

## Slice C — R5 pointer + teardown privacy addendum

### Task 4: Re-point savings-fix R5 at `mega compress`

**Files:**
- Modify: `packages/pro-analytics/src/fix.ts:139-151`
- Test: `packages/pro-analytics/test/fix.test.ts`

- [ ] **Step 1: Write the failing test** (add to `fix.test.ts`)

```ts
describe("R5 memory-file advice points at mega compress", () => {
  it("emits a runnable basename command, stays non-appliable", () => {
    const plan = computeFixPlan([], {
      saver: { enabled: true, mode: "balanced" },
      memoryFiles: [{ path: "/home/u/secret-project/CLAUDE.md", bytes: 40_000 }],
    });
    const r5 = plan.actions.find((a) => a.kind === "advise-compress-memory-file");
    expect(r5).toBeDefined();
    expect(r5?.appliable).toBe(false);
    expect(r5?.command).toBe("mega compress CLAUDE.md");
    expect(r5?.detail).toContain("mega compress");
  });
});
```

Note: import `computeFixPlan` if not already imported at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/pro-analytics test fix`
Expected: FAIL — `command` is `null`, `detail` lacks "mega compress".

- [ ] **Step 3: Edit the R5 branch** in `packages/pro-analytics/src/fix.ts`

Replace the object pushed in the memory-file loop (lines ~141-150) with:

```ts
      actions.push({
        kind: "advise-compress-memory-file",
        appliable: false,
        title: `${baseName(f.path)} is ${Math.round(f.bytes / 1024)}KB — loaded into every session`,
        detail: "Run mega compress <file> to preview a reversible, backed-up compression.",
        command: `mega compress ${baseName(f.path)}`,
        target: f.path,
        estDollarsReturned: dollarsFromTokens(tokensFromBytes(f.bytes)),
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics test fix`
Expected: PASS.

### Task 5: Teardown privacy addendum

**Files:**
- Test: `packages/pro-analytics/test/teardown.test.ts`

- [ ] **Step 1: Add a privacy assertion** for the R5-derived command in the teardown markdown

```ts
it("renders the R5 compress command with basename only (no path leak)", () => {
  const report = composeTeardown([], {
    saver: { enabled: true, mode: "balanced" },
    memoryFiles: [{ path: "/abs/secret-project/AGENTS.md", bytes: 50_000 }],
  });
  const md = renderTeardownMarkdown(report);
  expect(md).toContain("mega compress AGENTS.md");
  expect(md).not.toContain("secret-project");
  expect(md).not.toContain("/abs/");
});
```

Note: ensure `composeTeardown` and `renderTeardownMarkdown` are imported at the top of the file (they are used by existing tests).

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @megasaver/pro-analytics test teardown`
Expected: PASS (R5 command already uses basename from Task 4).

- [ ] **Step 3: Commit**

```bash
git add packages/pro-analytics/src/fix.ts packages/pro-analytics/test/fix.test.ts packages/pro-analytics/test/teardown.test.ts
git commit -m "feat(pro-analytics): R5 advice points at mega compress (basename only)"
```

---

## Slice D — register, docs, changeset, verify, smoke, reviews

### Task 6: Register the command

**Files:**
- Modify: `apps/cli/src/main.ts`

- [ ] **Step 1: Add the import** (alphabetical, after the `connector` import area — place near other command imports)

```ts
import { compressCommand } from "./commands/compress.js";
```

- [ ] **Step 2: Register in subCommands** (add the line; keep the object tidy)

```ts
    compress: compressCommand,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @megasaver/cli typecheck`
Expected: no errors.

### Task 7: README + changeset

**Files:**
- Modify: `README.md`
- Create: `.changeset/compress.md`

- [ ] **Step 1: Add the command-table row and Pro lines** to `README.md` (match the existing table format; add under the Pro commands area):

```
| `mega compress <file>` | Preview/apply reversible extractive compression of a memory/doc file (Pro). |
```

Pro-section example lines:

```
mega compress CLAUDE.md            # dry-run: preview what collapses + tokens/$ saved
mega compress CLAUDE.md --apply    # overwrite (writes CLAUDE.md.bak; restore with mv)
```

Bullet: "Dry-run by default; `--apply` is lossy but writes a `<file>.bak` you restore with `mv`. Only `.md`/`.txt`/`.mdc`."

- [ ] **Step 2: Create `.changeset/compress.md`**

```md
---
"@megasaver/cli": minor
---

mega compress: reversible extractive compression of memory/doc files. Dry-run by
default (preview + token/$ savings); --apply overwrites after writing a mandatory
<file>.bak, atomically, behind a git-dirty guard. savings-fix R5 advice now points
at the command.
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/main.ts README.md .changeset/compress.md
git commit -m "feat(cli): register compress + docs + changeset"
```

### Task 8: Full verify

- [ ] **Step 1: Run the DoD gate**

Run: `pnpm verify`
Expected: `biome check`, `tsc -b --noEmit`, and `vitest run` all green across the workspace. Fix any drift (e.g. `pnpm lint:fix` if Biome flags formatting).

### Task 9: E2E smoke on the packed tarball (bundle-integrity guard)

This proves the lazy `@megasaver/pro-analytics` import AND the newly-exposed `compressProse` both resolve inside the shipped single-file bundle (the 1.6.0 incident class).

- [ ] **Step 1: Build + pack**

Run: `pnpm --filter @megasaver/cli build && pnpm --filter @megasaver/cli pack` (or the repo's established pack step). Capture the tarball path.

- [ ] **Step 2: Install the tarball into a scratch dir, activate a prod-key-signed short-expiry test license** (do NOT print the key), then:

```
mega compress <scratch>/BIG.md            # dry-run → prints "Savings:"
mega compress <scratch>/BIG.md --apply    # shrinks the file, writes BIG.md.bak
# verify BIG.md smaller, BIG.md.bak == original, `mv BIG.md.bak BIG.md` restores
# deactivate/clear license → `mega compress BIG.md` prints the upsell
```

Expected: dry-run shows savings; apply shrinks + backs up; restore works; free path upsells. Capture the terminal session as DoD evidence.

### Task 10: CRITICAL review chain

- [ ] **Step 1:** Dispatch parallel reviews (fresh contexts, author ≠ reviewer): `code-reviewer` (spec-compliance + quality), `critic` (adversarial), `security-reviewer` (repo-mutation attack surface: no-write-without-apply, backup-before-overwrite, atomicity, git-guard, shell-injection via execFile, symlink note), `tracer` (evidence-driven trace of the apply path). Each verifier defaults to "refute" on uncertainty.
- [ ] **Step 2:** Triage findings; reproduce CONFIRMED issues against the built dist before fixing; fix at source; re-run `pnpm verify` + re-smoke.
- [ ] **Step 3:** Dry-check pass: one more sweep for CRITICAL-specific failure modes (partial write, lost backup, clobbered backup, free-path leak).

### Task 11: Finish the branch

- [ ] Use `superpowers:finishing-a-development-branch`: verify tests green → push → open PR (fill template) → merge after review. Then release 1.10.0 (changeset version → stage consumed changeset deletion → `biome check --write apps/cli/package.json` → commit → push → owner OTP publish; verify `bin.mega` has no `./` prefix) and append the wiki `log.md` entry + update `wiki/entities/cli.md` and `wiki/syntheses/pro-differentiation-portfolio.md`.

---

## Self-Review (completed)

- **Spec coverage:** locked decisions 1–4 → Slice A (engine/marker-skeleton), Slice B (dry-run default, git-guard, atomic .bak, extension guard, restore hint), Slice C (R5 pointer). Security section → Slice D reviews + the no-write/atomicity/order tests in Task 3. ✅
- **Placeholder scan:** no TBD/TODO; every code step has complete code; commands have expected output. ✅
- **Type consistency:** `CompressFs`/`GitFileStatus`/`CompressionReport`/`RunCompressInput` names are identical across the CLI impl, its test, and the engine. `composeCompressionReport`/`renderCompressionSummary` match between engine, index re-export, and CLI import. R5 object keys match the existing `FixAction` shape. ✅
- **Note for implementer:** the free-path gating test spies `composeCompressionReport` via `vi.mock`; it is lazy-imported after the gate, so "not called" is both spy-proven and true by construction (no read ⇒ no report).
