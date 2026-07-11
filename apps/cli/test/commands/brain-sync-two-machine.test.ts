import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, keyfilePath } from "@megasaver/brain-sync";
import { activateLicense } from "@megasaver/entitlement";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
// One fixed project id shared by A and B so their per-project S3 prefix and
// manifest AAD line up — the precondition for two machines sharing one brain.
const PROJECT_ID = projectIdSchema.parse("0f0e0d0c-0b0a-4900-8807-060504030201");

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
  const r = mkdtempSync(join(tmpdir(), "megasaver-cli-sync2m-"));
  roots.push(r);
  return r;
}

async function double(): Promise<S3Double> {
  const d = await startS3Double();
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

async function seedProject(root: string): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createProject({
    id: PROJECT_ID,
    name: "alpha",
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
}

async function seedApprovedMemory(root: string, id: string, content: string): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createMemoryEntry({
    projectId: PROJECT_ID,
    id,
    type: "decision",
    title: "t",
    content,
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

async function runInit(
  root: string,
  fields: { endpoint: string; join?: string },
): Promise<{ code: 0 | 1; out: string[] }> {
  const out: string[] = [];
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
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: () => {},
  });
  return { code, out };
}

type OpFn = typeof runBrainSyncPush;
async function runOp(op: OpFn, root: string): Promise<{ code: 0 | 1; out: string[] }> {
  const out: string[] = [];
  const code = await op({
    storeRoot: root,
    now,
    projectName: "alpha",
    publicKey: keys.publicKey,
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: () => {},
  });
  return { code, out };
}

async function projectMemories(
  root: string,
): Promise<Array<{ content: string; approval: string }>> {
  const { registry } = await ensureStore(root);
  return registry.listMemoryEntries(PROJECT_ID).map((m) => ({
    content: m.content,
    approval: m.approval,
  }));
}

const ALPHA_ID = "11111111-1111-4111-8111-111111111111";
const BETA_ID = "22222222-2222-4222-8222-222222222222";

describe("brain sync — two-machine lifecycle", () => {
  it("A inits, seeds+pushes; B joins by recovery code, pulls (suggested), and dedupes on re-pull", async () => {
    const d = await double();
    const rootA = mkStore();
    const rootB = mkStore();
    activatePro(rootA);
    activatePro(rootB);

    // 1. A init (generate key) → recovery code + keyfile + config on disk.
    const initA = await runInit(rootA, { endpoint: d.url });
    expect(initA.code).toBe(0);
    const recovery = /Recovery code: ([A-Z2-7-]+)/.exec(initA.out.join("\n"))?.[1];
    expect(recovery).toBeDefined();
    expect(existsSync(keyfilePath(rootA))).toBe(true);
    expect(existsSync(configPath(rootA))).toBe(true);

    // 2. A seeds an approved project memory and pushes generation 1.
    await seedProject(rootA);
    await seedApprovedMemory(rootA, ALPHA_ID, "alpha-knowledge");
    const pushA1 = await runOp(runBrainSyncPush, rootA);
    expect(pushA1.code).toBe(0);
    expect(pushA1.out.join("\n")).toContain("pushed generation 1");
    const prefix = `megasaver-brain/${PROJECT_ID}/`;
    const storeKeys = [...d.store.keys()];
    expect(storeKeys).toContain(`${prefix}manifest.json.enc`);
    expect(storeKeys.filter((k) => k.startsWith(`${prefix}objects/`))).toHaveLength(1);

    // 3. B init --join <recoveryCode>: no recovery code printed, identical keyfile.
    const initB = await runInit(rootB, { endpoint: d.url, join: recovery as string });
    expect(initB.code).toBe(0);
    expect(initB.out.join("\n")).not.toContain("Recovery code");
    expect(readFileSync(keyfilePath(rootB))).toEqual(readFileSync(keyfilePath(rootA)));

    // 4. B pull: merges remote generation 1; alpha lands as a suggested entry.
    await seedProject(rootB);
    const pullB1 = await runOp(runBrainSyncPull, rootB);
    expect(pullB1.code).toBe(0);
    const pullB1Text = pullB1.out.join("\n");
    expect(pullB1Text).toContain("merged remote generation 1");
    expect(pullB1Text).toContain("mega memory approve");
    expect(pullB1Text).toContain("merged: +1 memories (suggested)");
    expect(await projectMemories(rootB)).toEqual([
      { content: "alpha-knowledge", approval: "suggested" },
    ]);

    // 5. B status: up to date at generation 1.
    const statusB = await runOp(runBrainSyncStatus, rootB);
    expect(statusB.code).toBe(0);
    expect(statusB.out.join("\n")).toContain(
      "remote generation: 1 / last seen: 1 / up to date: yes",
    );

    // 6. A seeds a second approved memory and pushes generation 2 (bundle now
    //    carries alpha + beta — both approved on A). A is already up to date vs
    //    gen 1, so this is a plain publish, not a merge.
    await seedApprovedMemory(rootA, BETA_ID, "beta-knowledge");
    const pushA2 = await runOp(runBrainSyncPush, rootA);
    expect(pushA2.code).toBe(0);
    expect(pushA2.out.join("\n")).toContain("pushed generation 2");

    // 7. Cross-machine dedupe: B pulls generation 2 (bundle = alpha + beta).
    //    B already holds alpha (suggested), so content dedupe skips it and only
    //    beta is imported — proven by `merged: +1` (not +2) and a count of 2.
    const pullB2 = await runOp(runBrainSyncPull, rootB);
    expect(pullB2.code).toBe(0);
    const pullB2Text = pullB2.out.join("\n");
    expect(pullB2Text).toContain("merged remote generation 2");
    expect(pullB2Text).toContain("merged: +1 memories (suggested)");
    const afterDedupe = await projectMemories(rootB);
    expect(afterDedupe).toHaveLength(2);
    expect(afterDedupe.filter((m) => m.content === "alpha-knowledge")).toHaveLength(1);
    expect(afterDedupe).toContainEqual({ content: "beta-knowledge", approval: "suggested" });

    // 8. Idempotent re-pull: nothing new to merge, no further imports.
    const pullB3 = await runOp(runBrainSyncPull, rootB);
    expect(pullB3.code).toBe(0);
    const pullB3Text = pullB3.out.join("\n");
    expect(pullB3Text).toContain("already up to date (generation 2)");
    expect(pullB3Text).not.toContain("merged:");
    expect(await projectMemories(rootB)).toHaveLength(2);
  });
});
