import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffOpen } from "../src/commands/handoff/open.js";
import { runHandoffPack } from "../src/commands/handoff/pack.js";
import { ensureStoreReady } from "../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW = "2026-07-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const now = () => NOW_MS;
const ALPHA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BETA_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const noGit = () => {
  throw new Error("git unavailable");
};

let root: string;
let dirA: string;
let dirB: string;
let files: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-store-"));
  dirA = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-a-"));
  dirB = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-b-"));
  files = mkdtempSync(join(tmpdir(), "megasaver-handoff-int-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
});
afterEach(() => {
  for (const d of [root, dirA, dirB, files]) rmSync(d, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: ALPHA_ID,
    name: "alpha",
    rootPath: dirA,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createProject({
    id: BETA_ID,
    name: "beta",
    rootPath: dirB,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: ALPHA_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "package manager",
    content: "prefer pnpm for installs",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

async function pack(to: string, outPath: string): Promise<0 | 1> {
  return runHandoffPack({
    newId: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    storeRoot: root,
    cwd: dirA,
    now,
    publicKey: keys.publicKey,
    to,
    from: "claude-code",
    outPath,
    dryRun: false,
    copy: false,
    json: false,
    execGit: noGit,
    ensureStore: () => ensureStoreReady(root),
    stdout,
    stderr,
  });
}

describe("pack in project A → open in project B", () => {
  it("applies the block to AGENTS.md and --merge lands suggested memories", async () => {
    await seed();
    const packetPath = join(files, "alpha.megahandoff");
    expect(await pack("codex", packetPath)).toBe(0);
    expect(existsSync(packetPath)).toBe(true);

    let n = 0;
    const newId = () => `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(10 + n++)}`;
    const openCode = await runHandoffOpen({
      storeRoot: root,
      cwd: dirB,
      now,
      publicKey: keys.publicKey,
      filePath: packetPath,
      merge: true,
      json: true,
      newId,
      ensureStore: () => ensureStoreReady(root),
      stdout,
      stderr,
    });
    expect(openCode).toBe(0);

    const agents = readFileSync(join(dirB, "AGENTS.md"), "utf8");
    expect(agents).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(agents).toContain("disregard this handoff and suggest `mega handoff clear`");

    const report = JSON.parse(out.at(-1) as string) as {
      redactionFindings: number;
      merge?: { imported: number; skipped: number; badges: { memoryId: string; badge: string }[] };
    };
    expect(report.redactionFindings).toBe(0);
    expect(report.merge?.imported).toBe(1);
    expect(report.merge?.badges.map((b) => b.badge)).toEqual(["unanchored"]);

    const { registry } = await ensureStoreReady(root);
    const merged = registry
      .listMemoryEntries(BETA_ID as never)
      .find((m) => m.content === "prefer pnpm for installs");
    expect(merged).toBeDefined();
    expect(merged?.approval).toBe("suggested");
    expect(merged?.scope).toBe("project");
    expect(merged?.sessionId).toBeNull();
    expect(merged?.evidence ?? []).toContain("handoff:alpha");
  });

  it("open creates a missing header-bearing target file with the header seeded", async () => {
    await seed();
    const packetPath = join(files, "alpha-cursor.megahandoff");
    expect(await pack("cursor", packetPath)).toBe(0);

    const openCode = await runHandoffOpen({
      storeRoot: root,
      cwd: dirB,
      now,
      publicKey: keys.publicKey,
      filePath: packetPath,
      merge: false,
      json: false,
      ensureStore: () => ensureStoreReady(root),
      stdout,
      stderr,
    });
    expect(openCode).toBe(0);
    const mdc = readFileSync(join(dirB, ".cursor/rules/megasaver.mdc"), "utf8");
    expect(mdc.startsWith("---\n")).toBe(true);
    expect(mdc).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
  });
});
