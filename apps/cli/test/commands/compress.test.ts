import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

// chmod 0o444 is only meaningful on POSIX; Windows maps modes differently.
const itPosix = process.platform === "win32" ? it.skip : it;

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
    // Mirror the real byte-copy: record (dest, source-content) so the backup-first
    // ordering and write-once assertions still hold on the fake.
    backupFile: (src, dest) => void writes.push([dest, fs.readFile(src)]),
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

  // The backup is write-once: an existing .bak is NEVER overwritten, even with
  // --force. compressProse is not idempotent, so a --force re-run would otherwise
  // read the already-compressed file and clobber the pristine .bak with degraded
  // content — permanently destroying the original (regression guard).
  it.each([{ force: false }, { force: true }])(
    "--apply refuses to touch an existing .bak (force=%o)",
    async ({ force }) => {
      const path = join(root, "CLAUDE.md");
      const { inp, writes } = scenario({
        apply: true,
        force,
        path,
        fsOver: { fileExists: (p) => p === `${path}.bak` || p === path },
      });
      const code = await runCompress(inp);
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("backup already exists");
      expect(writes).toHaveLength(0);
    },
  );

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
    // restore works: mv the .bak back over the compressed target, assert original
    renameSync(`${path}.bak`, path);
    expect(readFileSync(path, "utf8")).toBe(BIG_DOC);
  });

  // Reproduces the review's CONFIRMED critical end-to-end: compressProse is not
  // idempotent, so a --force re-run must never overwrite the pristine .bak. Whichever
  // guard bails (already-tight if the skeleton is a fixed point, or the write-once
  // backup guard otherwise), the pristine backup must survive and still restore.
  it("real-fs: a --force re-run never destroys the pristine backup", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, BIG_DOC);
    const fs = defaultCompressFs();
    const first = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      fs,
      stdout,
      stderr,
    });
    expect(first).toBe(0);
    const skeleton = readFileSync(path, "utf8");
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
    // second --apply --force: bails safely without touching the pristine backup
    const second = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      force: true,
      fs,
      stdout,
      stderr,
    });
    expect([0, 1]).toContain(second);
    // The pristine backup was NEVER overwritten and the file was not degraded further.
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
    expect(readFileSync(path, "utf8")).toBe(skeleton);
    // and mv restore still yields the true original
    renameSync(`${path}.bak`, path);
    expect(readFileSync(path, "utf8")).toBe(BIG_DOC);
  });

  // Reversibility guarantee: the .bak must be a BYTE-EXACT copy of the source, so a
  // non-UTF-8 file (latin-1, UTF-16, stray bytes) survives a compress→restore round
  // trip. A utf8 read→write backup replaces invalid bytes with U+FFFD, so the
  // mv-restore yields mojibake — silent data loss (review #256 blocker).
  it("real-fs: backup is byte-exact for a non-UTF-8 file", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "notes.md");
    // BIG_DOC (the engine compresses it) + a trailing sequence that is invalid UTF-8.
    const rawBytes = Buffer.concat([Buffer.from(BIG_DOC, "utf8"), Buffer.from([0xe9, 0xff, 0xfe])]);
    writeFileSync(path, rawBytes);
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      fs: defaultCompressFs(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(readFileSync(`${path}.bak`).equals(rawBytes)).toBe(true);
    // mv-restore yields the exact original bytes back
    renameSync(`${path}.bak`, path);
    expect(readFileSync(path).equals(rawBytes)).toBe(true);
  });

  // Never overwrite when the "compressed" output is not actually smaller — the
  // engine can emit markers longer than a short body, so report.changed is true
  // but there are no byte savings. Writing would grow the file while printing
  // "0 bytes saved". Skip the write.
  it("--apply does not write when there are no byte savings", async () => {
    proSpies.compose.mockReturnValueOnce({
      originalBytes: 100,
      compressedBytes: 130,
      bytesSaved: 0,
      tokensOriginal: 25,
      tokensCompressed: 33,
      tokensSaved: 0,
      dollarsSaved: 0,
      paragraphsCollapsed: 1,
      listItemsDropped: 0,
      changed: true,
      compressed: "y".repeat(130),
    });
    const { inp, writes } = scenario({ apply: true });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(writes).toHaveLength(0);
    expect(out.join("\n")).toContain("already tight");
  });

  it("errors cleanly when the path is a directory (no stack trace)", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const dir = join(root, "adir.md");
    mkdirSync(dir);
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path: dir,
      apply: true,
      fs: defaultCompressFs(),
      stdout,
      stderr,
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("cannot read");
  });

  it("accepts an uppercase extension (case-insensitive)", async () => {
    const { inp } = scenario({ path: join(root, "NOTES.MD") });
    const code = await runCompress(inp);
    expect(code).toBe(0);
    expect(err.join("\n")).not.toContain("only accepts");
    expect(out.join("\n")).toContain("Savings:");
  });

  it("real-fs: a failed target write leaves the original recoverable via .bak", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, BIG_DOC);
    const base = defaultCompressFs();
    const fs: CompressFs = {
      ...base,
      writeFile: () => {
        throw new Error("disk full");
      },
    };
    await expect(
      runCompress({
        storeRoot: root,
        now,
        publicKey: keys.publicKey,
        path,
        apply: true,
        fs,
        stdout,
        stderr,
      }),
    ).rejects.toThrow("disk full");
    // The byte-exact .bak was written BEFORE the failed target overwrite, and the
    // target is never renamed on failure — so the original is fully recoverable.
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
    expect(readFileSync(path, "utf8")).toBe(BIG_DOC);
    renameSync(`${path}.bak`, path);
    expect(readFileSync(path, "utf8")).toBe(BIG_DOC);
  });

  itPosix("real-fs: compresses a read-only (0o444) source; .bak keeps bytes + mode", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, BIG_DOC);
    chmodSync(path, 0o444);
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      fs: defaultCompressFs(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    // Byte-exact backup that also preserves the source's read-only mode.
    expect(readFileSync(`${path}.bak`, "utf8")).toBe(BIG_DOC);
    expect(statSync(`${path}.bak`).mode & 0o777).toBe(0o444);
    // Target was compressed.
    expect(Buffer.byteLength(readFileSync(path, "utf8"))).toBeLessThan(Buffer.byteLength(BIG_DOC));
  });

  itPosix("real-fs: --apply preserves the source mode (a private file stays private)", async () => {
    const { defaultCompressFs } = await import("../../src/commands/compress.js");
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, BIG_DOC);
    chmodSync(path, 0o600);
    const code = await runCompress({
      storeRoot: root,
      now,
      publicKey: keys.publicKey,
      path,
      apply: true,
      fs: defaultCompressFs(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    // --apply must not widen permissions: the compressed live file and its .bak
    // both keep the original restrictive mode.
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(`${path}.bak`).mode & 0o777).toBe(0o600);
  });
});
