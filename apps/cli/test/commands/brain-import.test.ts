import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAIN_IMPORT_UPSELL, runBrainImport } from "../../src/commands/brain/import.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}
const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;

let root: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-brainimp-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-brainimp-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedTargetAndBundle(): Promise<string> {
  const { ensureStoreReady } = await import("../../src/store.js");
  const { exportBrain } = await import("@megasaver/core");
  const { registry } = await ensureStoreReady(root);
  const source = registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name: "alpha",
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030299",
    name: "beta",
    rootPath: "/tmp/beta",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: source.id,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "knowledge travels",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
  const text = exportBrain({
    registry,
    projectId: source.id,
    createdAt: "2026-07-09T12:00:00.000Z",
  });
  const file = join(dir, "alpha.megabrain");
  writeFileSync(file, text);
  return file;
}

function run(over: { project?: string; file: string; json?: boolean; maxBundleBytes?: number }) {
  const ensureStore = vi.fn(async () => {
    const { ensureStoreReady } = await import("../../src/store.js");
    return ensureStoreReady(root);
  });
  const code = runBrainImport({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: over.project ?? "beta",
    filePath: over.file,
    json: over.json ?? false,
    ...(over.maxBundleBytes === undefined ? {} : { maxBundleBytes: over.maxBundleBytes }),
    ensureStore,
    stdout,
    stderr,
  });
  return { code, ensureStore };
}

describe("runBrainImport — gating", () => {
  it("free tier: upsell, exit 0, store never opened, file never read", async () => {
    const file = join(dir, "whatever.megabrain");
    const { code, ensureStore } = run({ file });
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_IMPORT_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runBrainImport — entitled", () => {
  it("imports a bundle and reports suggested-gate hint", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file });
    expect(await code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("imported");
    expect(text).toContain("mega memory approve");
    const { ensureStoreReady } = await import("../../src/store.js");
    const { registry } = await ensureStoreReady(root);
    const beta = registry.listProjects().find((p) => p.name === "beta");
    const entries = registry.listMemoryEntries(beta?.id as never);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.approval).toBe("suggested");
  });

  it("--json emits imported/skipped counts", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("imported");
    expect(report.imported).toEqual({ memories: 1, rules: 0, failures: 0 });
    expect(report.skipped).toEqual({ memories: 0, rules: 0, failures: 0 });
  });

  it("tampered bundle → stderr corrupted + exit 1, nothing written", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace("knowledge travels", "knowledge travelz"),
    );
    const { code } = run({ file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/corrupted or tampered/);
    const { ensureStoreReady } = await import("../../src/store.js");
    const { registry } = await ensureStoreReady(root);
    const beta = registry.listProjects().find((p) => p.name === "beta");
    expect(registry.listMemoryEntries(beta?.id as never)).toHaveLength(0);
  });

  it("bundle over cap → stderr exceeds + exit 1", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file, maxBundleBytes: 8 });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("exceeds");
  });

  it("unsupported schemaVersion → stderr upgrade hint + exit 1", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const text = readFileSync(file, "utf8");
    const idx = text.indexOf("\n");
    const manifest = JSON.parse(text.slice(0, idx));
    manifest.schemaVersion = "9";
    writeFileSync(file, `${JSON.stringify(manifest)}\n${text.slice(idx + 1)}`);
    const { code } = run({ file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/not supported.*Upgrade/);
  });

  it("missing file → stderr + exit 1", async () => {
    activatePro();
    const { code } = run({ file: join(dir, "absent.megabrain") });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("cannot read bundle");
  });

  it("unknown project → stderr + exit 1", async () => {
    activatePro();
    const file = await seedTargetAndBundle();
    const { code } = run({ file, project: "nope" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('project "nope" not found');
  });
});
