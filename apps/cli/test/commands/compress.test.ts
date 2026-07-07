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
function fakeFs(over: Partial<CompressFs> = {}): {
  fs: CompressFs;
  writes: Array<[string, string]>;
} {
  const writes: Array<[string, string]> = [];
  const fs: CompressFs = {
    readFile: () => BIG_DOC,
    // Default world: the target exists, no prior backup. Tests that need an
    // existing .bak override fileExists explicitly.
    fileExists: (p) => !p.endsWith(".bak"),
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
    expect(writes[0]?.[0]).toBe(`${path}.bak`);
    expect(writes[0]?.[1]).toBe(BIG_DOC);
    expect(writes[1]?.[0]).toBe(path);
    expect(writes[1]?.[1]).not.toBe(BIG_DOC);
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
