import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, keyfilePath } from "@megasaver/brain-sync";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BRAIN_SYNC_UPSELL } from "../../src/commands/brain/sync/common.js";
import { runBrainSyncInit } from "../../src/commands/brain/sync/init.js";
import { runBrainSyncReset } from "../../src/commands/brain/sync/reset.js";
import { type S3Double, startS3Double } from "../helpers/s3-double.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;

let roots: string[];
let doubles: S3Double[];
let keys: ReturnType<typeof generateKeyPairSync>;

beforeEach(() => {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_ACCESS_KEY_ID"] = "test";
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_SECRET_ACCESS_KEY"] = "test";
  roots = [];
  doubles = [];
  keys = generateKeyPairSync("ed25519");
});
afterEach(async () => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
  await Promise.all(doubles.map((d) => d.close()));
});

function mkStore(): string {
  const r = mkdtempSync(join(tmpdir(), "megasaver-cli-sync-"));
  roots.push(r);
  return r;
}

async function double(opts?: { enforce?: boolean }): Promise<S3Double> {
  const d = await startS3Double(opts);
  doubles.push(d);
  return d;
}

function activatePro(root: string): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedProject(root: string, name: string): Promise<void> {
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

async function ensureStore(root: string) {
  const { ensureStoreReady } = await import("../../src/store.js");
  return ensureStoreReady(root);
}

async function runInit(
  root: string,
  fields: {
    endpoint: string;
    join?: string;
    keyfileImportPath?: string;
    reset?: boolean;
    force?: boolean;
  },
): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBrainSyncInit({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    endpoint: fields.endpoint,
    bucket: "brain",
    prefix: "megasaver-brain",
    region: "auto",
    pathStyle: true,
    ...(fields.join === undefined ? {} : { join: fields.join }),
    ...(fields.keyfileImportPath === undefined
      ? {}
      : { keyfileImportPath: fields.keyfileImportPath }),
    ...(fields.reset === undefined ? {} : { reset: fields.reset }),
    ...(fields.force === undefined ? {} : { force: fields.force }),
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

async function runReset(
  root: string,
  fields: { projectName: string; force?: boolean },
): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBrainSyncReset({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: fields.projectName,
    ...(fields.force === undefined ? {} : { force: fields.force }),
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

describe("runBrainSyncInit — gating", () => {
  it("free tier: upsell, exit 0, config never written", async () => {
    const root = mkStore();
    const { code, out, err } = await runInit(root, { endpoint: "http://127.0.0.1:9" });
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_SYNC_UPSELL);
    expect(err).toEqual([]);
    expect(existsSync(configPath(root))).toBe(false);
  });
});

describe("runBrainSyncInit — entitled", () => {
  it("enforcing endpoint: writes verified config + keyfile, prints recovery code", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    const { code, out } = await runInit(root, { endpoint: d.url });
    expect(code).toBe(0);
    expect(existsSync(keyfilePath(root))).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath(root), "utf8"));
    expect(cfg.conditionalWritesVerified).toBe(true);
    const joined = out.join("\n");
    expect(joined).toContain("Recovery code:");
    expect(joined).toContain("will not be shown again");
  });

  it("non-enforcing endpoint: exit 1, config NOT written (probe rejects)", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double({ enforce: false });
    const { code, err } = await runInit(root, { endpoint: d.url });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("conditional writes");
    expect(existsSync(configPath(root))).toBe(false);
  });

  it("--join reconstructs the same keyfile without printing a recovery code", async () => {
    const root1 = mkStore();
    activatePro(root1);
    const d = await double();
    const first = await runInit(root1, { endpoint: d.url });
    expect(first.code).toBe(0);
    const codeLine = first.out.find((l) => l.startsWith("Recovery code:"));
    expect(codeLine).toBeDefined();
    const recovery = (codeLine as string).slice("Recovery code: ".length);

    const root2 = mkStore();
    activatePro(root2);
    const second = await runInit(root2, { endpoint: d.url, join: recovery });
    expect(second.code).toBe(0);
    expect(second.out.join("\n")).not.toContain("Recovery code:");
    expect(readFileSync(keyfilePath(root2))).toEqual(readFileSync(keyfilePath(root1)));
  });

  it("--keyfile imports an existing key silently (no recovery code printed)", async () => {
    const rootA = mkStore();
    activatePro(rootA);
    const d = await double();
    const a = await runInit(rootA, { endpoint: d.url });
    expect(a.code).toBe(0);

    const rootB = mkStore();
    activatePro(rootB);
    const b = await runInit(rootB, { endpoint: d.url, keyfileImportPath: keyfilePath(rootA) });
    expect(b.code).toBe(0);
    expect(b.out.join("\n")).not.toContain("Recovery code");
    expect(readFileSync(keyfilePath(rootB))).toEqual(readFileSync(keyfilePath(rootA)));
  });

  it("refuses to overwrite an existing keyfile without --reset --force", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    const first = await runInit(root, { endpoint: d.url });
    expect(first.code).toBe(0);
    const second = await runInit(root, { endpoint: d.url });
    expect(second.code).toBe(1);
    expect(second.err.join("\n")).toContain("--reset --force");
  });
});

describe("runBrainSyncReset", () => {
  it("free tier: upsell, exit 0", async () => {
    const root = mkStore();
    const { code, out } = await runReset(root, { projectName: "alpha" });
    expect(code).toBe(0);
    expect(out.join("\n")).toBe(BRAIN_SYNC_UPSELL);
  });

  it("without --force: exit 1, mentions --force", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    await runInit(root, { endpoint: d.url });
    await seedProject(root, "alpha");
    const { code, err } = await runReset(root, { projectName: "alpha" });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--force");
  });

  it("with --force: deletes the remote manifest, exit 0", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    await runInit(root, { endpoint: d.url });
    await seedProject(root, "alpha");
    const { code, out } = await runReset(root, { projectName: "alpha", force: true });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("deleted");
  });
});
