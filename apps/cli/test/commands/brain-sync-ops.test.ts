import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "@megasaver/brain-sync";
import { activateLicense } from "@megasaver/entitlement";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brainCommand } from "../../src/commands/brain/index.js";
import { BRAIN_SYNC_UPSELL } from "../../src/commands/brain/sync/common.js";
import { brainSyncCommand } from "../../src/commands/brain/sync/index.js";
import { runBrainSyncInit } from "../../src/commands/brain/sync/init.js";
import {
  runBrainSyncPull,
  runBrainSyncPush,
  runBrainSyncStatus,
} from "../../src/commands/brain/sync/ops.js";
import { type S3Double, startS3Double } from "../helpers/s3-double.js";

type Payload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: Payload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);
const now = () => NOW_MS;
const PROJECT_ID = "0f0e0d0c-0b0a-4900-8807-060504030201";

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
  const r = mkdtempSync(join(tmpdir(), "megasaver-cli-syncops-"));
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

async function ensureStore(root: string) {
  const { ensureStoreReady } = await import("../../src/store.js");
  return ensureStoreReady(root);
}

async function seedProject(root: string, name: string): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createProject({
    id: PROJECT_ID,
    name,
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
}

async function seedApprovedMemory(root: string): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createMemoryEntry({
    projectId: PROJECT_ID,
    id: "11111111-1111-4111-8111-111111111111",
    type: "decision",
    title: "t",
    content: "plain knowledge",
    keywords: [],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
    scope: "project",
    sessionId: null,
    approval: "approved",
  } as never);
}

async function initStore(root: string, endpoint: string, join?: string): Promise<0 | 1> {
  return runBrainSyncInit({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    endpoint,
    bucket: "brain",
    prefix: "megasaver-brain",
    region: "auto",
    pathStyle: true,
    ...(join === undefined ? {} : { join }),
    ensureStore: () => ensureStore(root),
    stdout: () => {},
    stderr: () => {},
  });
}

type OpFn = typeof runBrainSyncPush;
async function runOp(
  op: OpFn,
  root: string,
  opts?: { publicKey?: KeyObject },
): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await op({
    storeRoot: root,
    now,
    projectName: "alpha",
    ...(opts?.publicKey === undefined ? {} : { publicKey: opts.publicKey }),
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

async function recoveryCodeOf(root: string, endpoint: string): Promise<string> {
  const out: string[] = [];
  await runBrainSyncInit({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    endpoint,
    bucket: "brain",
    prefix: "megasaver-brain",
    region: "auto",
    pathStyle: true,
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: () => {},
  });
  const line = out.find((l) => l.startsWith("Recovery code:"));
  return (line as string).slice("Recovery code: ".length);
}

describe("runBrainSyncPush", () => {
  it("pushes generation 1 and writes manifest + one object under the project prefix", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    expect(await initStore(root, d.url)).toBe(0);
    await seedProject(root, "alpha");
    await seedApprovedMemory(root);

    const { code, out } = await runOp(runBrainSyncPush, root, { publicKey: keys.publicKey });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("pushed generation 1");

    const prefix = `megasaver-brain/${PROJECT_ID}/`;
    const storeKeys = [...d.store.keys()];
    expect(storeKeys).toContain(`${prefix}manifest.json.enc`);
    expect(storeKeys.filter((k) => k.startsWith(`${prefix}objects/`))).toHaveLength(1);
  });

  it("free tier: prints the upsell, exits 0, and never touches the remote", async () => {
    const root = mkStore();
    const d = await double();
    // No init, no license — but seed a project so the only gate is entitlement.
    await seedProject(root, "alpha");

    const { code, out } = await runOp(runBrainSyncPush, root, { publicKey: keys.publicKey });
    expect(code).toBe(0);
    expect(out).toContain(BRAIN_SYNC_UPSELL);
    expect(d.store.size).toBe(0);
  });

  it("maps a transport failure to a single-line error and exits 1", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    expect(await initStore(root, d.url)).toBe(0);
    await seedProject(root, "alpha");
    // Repoint config at a dead endpoint: the transport connection is refused.
    const config = loadConfig(root);
    saveConfig(root, { ...config, endpoint: "http://127.0.0.1:1" });

    const { code, out, err } = await runOp(runBrainSyncPush, root, { publicKey: keys.publicKey });
    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^error: /);
    expect(err[0]).not.toContain("\n");
  });
});

describe("runBrainSyncPull", () => {
  it("merges the remote generation on a second machine joined by recovery code", async () => {
    const rootA = mkStore();
    activatePro(rootA);
    const d = await double();
    const recovery = await recoveryCodeOf(rootA, d.url);
    await seedProject(rootA, "alpha");
    await seedApprovedMemory(rootA);
    expect((await runOp(runBrainSyncPush, rootA, { publicKey: keys.publicKey })).code).toBe(0);

    const rootB = mkStore();
    activatePro(rootB);
    expect(await initStore(rootB, d.url, recovery)).toBe(0);
    await seedProject(rootB, "alpha");

    const { code, out } = await runOp(runBrainSyncPull, rootB, { publicKey: keys.publicKey });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("merged remote generation 1");
    expect(out.join("\n")).toContain("mega memory approve");
  });

  it("reports an empty remote before anyone has pushed", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    expect(await initStore(root, d.url)).toBe(0);
    await seedProject(root, "alpha");

    const { code, out } = await runOp(runBrainSyncPull, root, { publicKey: keys.publicKey });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("remote is empty");
  });
});

describe("runBrainSyncStatus", () => {
  it("reports up-to-date on the pusher and not-up-to-date on a fresh joiner", async () => {
    const rootA = mkStore();
    activatePro(rootA);
    const d = await double();
    const recovery = await recoveryCodeOf(rootA, d.url);
    await seedProject(rootA, "alpha");
    await seedApprovedMemory(rootA);
    expect((await runOp(runBrainSyncPush, rootA, { publicKey: keys.publicKey })).code).toBe(0);

    const a = await runOp(runBrainSyncStatus, rootA, { publicKey: keys.publicKey });
    expect(a.code).toBe(0);
    expect(a.out.join("\n")).toContain("remote generation: 1 / last seen: 1 / up to date: yes");

    const rootB = mkStore();
    activatePro(rootB);
    expect(await initStore(rootB, d.url, recovery)).toBe(0);
    await seedProject(rootB, "alpha");

    const b = await runOp(runBrainSyncStatus, rootB, { publicKey: keys.publicKey });
    expect(b.code).toBe(0);
    expect(b.out.join("\n")).toContain("last seen: 0");
    expect(b.out.join("\n")).toContain("up to date: no");
  });
});

describe("sync registration", () => {
  it("registers the sync group under brain", () => {
    const subCommands = brainCommand.subCommands as { sync?: unknown };
    expect(subCommands.sync).toBe(brainSyncCommand);
  });

  it("dispatches `brain sync status <project>` through citty", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    expect(await initStore(root, d.url)).toBe(0);
    await seedProject(root, "alpha");

    // Runs without throwing; empty remote → status handler returns 0.
    await expect(
      runCommand(brainCommand, { rawArgs: ["sync", "status", "alpha", "--store", root] }),
    ).resolves.toBeDefined();
  });

  it("has no bare `brain sync <project>` form — a bare positional is an unknown command", async () => {
    // Subcommands-only by design: citty routes the first non-flag arg to a
    // subcommand and rejects an unknown one. `push` is the canonical form.
    await expect(runCommand(brainCommand, { rawArgs: ["sync", "alpha"] })).rejects.toThrow(
      /Unknown command/,
    );
  });

  it("routes `brain sync push <project>` to the push leaf (no unknown-command)", async () => {
    const root = mkStore();
    await seedProject(root, "alpha");
    // The citty handler uses the production entitlement key, so an unlicensed
    // store hits the Pro upsell and returns 0 — proving the route resolves to
    // the push leaf rather than throwing "Unknown command". Push side-effects
    // are covered by the runBrainSyncPush tests above (which inject the key).
    await expect(
      runCommand(brainCommand, { rawArgs: ["sync", "push", "alpha", "--store", root] }),
    ).resolves.toBeDefined();
  });
});
