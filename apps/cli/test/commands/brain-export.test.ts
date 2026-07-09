import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAIN_EXPORT_UPSELL, runBrainExport } from "../../src/commands/brain/export.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;

let root: string;
let outDir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-brain-"));
  outDir = mkdtempSync(join(tmpdir(), "megasaver-brain-out-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedProject(name: string): Promise<void> {
  const { ensureStoreReady } = await import("../../src/store.js");
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name,
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
}

function run(over: { project?: string; outPath?: string; json?: boolean } = {}) {
  const ensureStore = vi.fn(async () => {
    const { ensureStoreReady } = await import("../../src/store.js");
    return ensureStoreReady(root);
  });
  const code = runBrainExport({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: over.project ?? "alpha",
    ...(over.outPath === undefined ? {} : { outPath: over.outPath }),
    json: over.json ?? false,
    ensureStore,
    stdout,
    stderr,
  });
  return { code, ensureStore };
}

describe("runBrainExport — gating", () => {
  it("free tier: upsell, exit 0, store never opened", async () => {
    const { code, ensureStore } = run();
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_EXPORT_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runBrainExport — entitled", () => {
  it("unknown project → stderr + exit 1", async () => {
    activatePro();
    const { code } = run({ project: "nope" });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('project "nope" not found');
  });

  it("writes a parseable bundle to --out and reports counts", async () => {
    activatePro();
    await seedProject("alpha");
    const outPath = join(outDir, "alpha.megabrain");
    const { code } = run({ outPath });
    expect(await code).toBe(0);
    const text = readFileSync(outPath, "utf8");
    const { parseBrainBundle } = await import("@megasaver/core");
    const { manifest } = parseBrainBundle(text);
    expect(manifest.sourceProject.name).toBe("alpha");
    expect(out.join("\n")).toContain(outPath);
  });

  it("--json emits a stable object", async () => {
    activatePro();
    await seedProject("alpha");
    const outPath = join(outDir, "alpha.megabrain");
    const { code } = run({ outPath, json: true });
    expect(await code).toBe(0);
    const report = JSON.parse(out[0] as string);
    expect(report.status).toBe("exported");
    expect(report.path).toBe(outPath);
    expect(report.counts).toEqual({ memories: 0, rules: 0, failures: 0 });
  });

  it("unwritable --out (missing dir) → stderr + exit 1, no partial file", async () => {
    activatePro();
    await seedProject("alpha");
    const outPath = join(outDir, "no-such-subdir", "x.megabrain");
    const { code } = run({ outPath });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("cannot write bundle");
    expect(existsSync(outPath)).toBe(false);
  });

  it("default filename is <project>-<YYYYMMDD>.megabrain under cwd", async () => {
    activatePro();
    await seedProject("alpha");
    const { code } = run();
    expect(await code).toBe(0);
    expect(out.join("\n")).toContain("alpha-20260715.megabrain");
    rmSync(join(process.cwd(), "alpha-20260715.megabrain"), { force: true });
  });
});
