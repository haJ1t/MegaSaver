import { type KeyObject, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveBrainId,
  keyfilePath,
  loadConfig,
  loadKeyfile,
  saveConfig,
} from "@megasaver/brain-sync";
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
const PROJECT_ID = "0f0e0d0c-0b0a-4900-8807-060504030201";
// Distinct local ids for machines that share the brain by name (see B1). Real
// machines never share a project UUID — brainId (key+name) is what aligns them.
const B_LOCAL_ID = "aaaa0000-bbbb-4ccc-8ddd-eeee0000ffff";
const C_LOCAL_ID = "cccc1111-dddd-4eee-8fff-111122223333";

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

async function alphaRegistry(root: string) {
  const { registry } = await ensureStore(root);
  const project = registry.listProjects().find((p) => p.name === "alpha");
  if (project === undefined) throw new Error("alpha project not seeded");
  return { registry, projectId: project.id };
}

async function approveImportedSuggestions(root: string): Promise<void> {
  const { registry, projectId } = await alphaRegistry(root);
  for (const m of registry.listMemoryEntries(projectId)) {
    if (
      m.approval === "suggested" &&
      (m.evidence ?? []).some((e) => e.startsWith("brain-import:"))
    ) {
      registry.updateMemoryEntry(m.id, {
        approval: "approved",
        updatedAt: "2026-07-09T12:00:00.000Z",
      });
    }
  }
}

async function memoryContents(root: string): Promise<string[]> {
  const { registry, projectId } = await alphaRegistry(root);
  return registry
    .listMemoryEntries(projectId)
    .map((m) => m.content)
    .sort();
}

async function seedProject(root: string, name: string, projectId = PROJECT_ID): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createProject({
    id: projectId,
    name,
    rootPath: "/tmp/alpha",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z",
  } as never);
}

async function seedApprovedMemory(
  root: string,
  id = "11111111-1111-4111-8111-111111111111",
  content = "plain knowledge",
  projectId = PROJECT_ID,
): Promise<void> {
  const { registry } = await ensureStore(root);
  registry.createMemoryEntry({
    projectId,
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
  opts?: { publicKey?: KeyObject; force?: boolean },
): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await op({
    storeRoot: root,
    now,
    projectName: "alpha",
    ...(opts?.publicKey === undefined ? {} : { publicKey: opts.publicKey }),
    ...(opts?.force === undefined ? {} : { force: opts.force }),
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

async function runReset(
  root: string,
  force: boolean,
): Promise<{ code: 0 | 1; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runBrainSyncReset({
    storeRoot: root,
    now,
    publicKey: keys.publicKey,
    projectName: "alpha",
    force,
    ensureStore: () => ensureStore(root),
    stdout: (l) => out.push(l),
    stderr: (l) => err.push(l),
  });
  return { code, out, err };
}

const brainPrefix = (root: string): string =>
  `megasaver-brain/${deriveBrainId(loadKeyfile(keyfilePath(root)), "alpha")}/`;

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

    const prefix = brainPrefix(root);
    const storeKeys = [...d.store.keys()];
    expect(storeKeys).toContain(`${prefix}manifest.json.enc`);
    expect(storeKeys.filter((k) => k.startsWith(`${prefix}objects/`))).toHaveLength(1);
  });

  it("--force pushed+merged: merges the remote inside push, publishes gen 2, surfaces both lines", async () => {
    // The non-force path now pulls-first and would BLOCK here (the merge imports
    // A's entry as a pending suggestion). --force skips the guard, so push's own
    // internal mergeRemote fires — the documented override that can drop the
    // un-approved import from the approved-only bundle.
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
    // A distinct approved memory so B's export differs from A's remote and the
    // merge is followed by a real gen-2 publish (not an up-to-date no-op).
    await seedApprovedMemory(rootB, "22222222-2222-4222-8222-222222222222", "beta knowledge");

    const { code, out } = await runOp(runBrainSyncPush, rootB, {
      publicKey: keys.publicKey,
      force: true,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("merged: +");
    expect(out.join("\n")).toContain(
      "pushed generation 2 (merged remote changes first — imported entries are suggested; run: mega memory approve)",
    );
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

describe("brain sync — B2 push-guard + reset last-seen", () => {
  // A pushes an approved memory; B joins and pulls it — it lands as a
  // suggested sync-import (evidence `brain-import:alpha`). B's own bundle is
  // approved-only, so a plain push would drop the un-approved suggestion from
  // the remote. push must refuse until B resolves it (or forces).
  async function joinAndPull(): Promise<{ d: S3Double; rootB: string }> {
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
    expect((await runOp(runBrainSyncPull, rootB, { publicKey: keys.publicKey })).code).toBe(0);
    return { d, rootB };
  }

  it("refuses to push while sync-imported suggestions are pending approval", async () => {
    const { rootB } = await joinAndPull();

    const { code, err } = await runOp(runBrainSyncPush, rootB, { publicKey: keys.publicKey });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("synced suggestion");
    expect(err.join("\n")).toContain("--force");
  });

  it("--force overrides the pending-suggestion guard and publishes", async () => {
    const { rootB } = await joinAndPull();

    const { code, out } = await runOp(runBrainSyncPush, rootB, {
      publicKey: keys.publicKey,
      force: true,
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("pushed generation 2");
  });

  it("reset --force clears the local last-seen entry for the brain", async () => {
    const root = mkStore();
    activatePro(root);
    const d = await double();
    expect(await initStore(root, d.url)).toBe(0);
    await seedProject(root, "alpha");
    await seedApprovedMemory(root);
    expect((await runOp(runBrainSyncPush, root, { publicKey: keys.publicKey })).code).toBe(0);

    const brainId = deriveBrainId(loadKeyfile(keyfilePath(root)), "alpha");
    expect(loadConfig(root).lastSeen[brainId]).toBe(1);

    expect((await runReset(root, true)).code).toBe(0);
    expect(loadConfig(root).lastSeen[brainId]).toBeUndefined();
  });

  it("merge-during-push window: refuses to drop a remote entry push would merge, approve→push keeps both", async () => {
    // A publishes approved X (gen1). B (same name, DIFFERENT local id) holds its
    // OWN approved Y and has NOT pulled. Pre-fix, B's push would internally
    // merge X (as suggested) then drop it from the approved-only bundle — silent
    // loss. The pull-before-guard must catch X and refuse.
    const rootA = mkStore();
    activatePro(rootA);
    const d = await double();
    const recovery = await recoveryCodeOf(rootA, d.url);
    await seedProject(rootA, "alpha");
    await seedApprovedMemory(rootA); // X = "plain knowledge"
    expect((await runOp(runBrainSyncPush, rootA, { publicKey: keys.publicKey })).code).toBe(0);

    const prefix = brainPrefix(rootA);
    const manifestKey = `${prefix}manifest.json.enc`;
    const gen1Manifest = d.store.get(manifestKey);

    const rootB = mkStore();
    activatePro(rootB);
    expect(await initStore(rootB, d.url, recovery)).toBe(0);
    await seedProject(rootB, "alpha", B_LOCAL_ID);
    await seedApprovedMemory(
      rootB,
      "22222222-2222-4222-8222-222222222222",
      "beta-knowledge",
      B_LOCAL_ID,
    ); // Y

    // Push WITHOUT force: the pre-push pull imports X → guard blocks, exit 1.
    const blocked = await runOp(runBrainSyncPush, rootB, { publicKey: keys.publicKey });
    expect(blocked.code).toBe(1);
    expect(blocked.err.join("\n")).toContain("synced suggestion");
    expect(blocked.err.join("\n")).toContain("--force");
    // Remote is untouched — X was NOT dropped, still generation 1 (one object).
    expect(d.store.get(manifestKey)).toEqual(gen1Manifest);
    expect([...d.store.keys()].filter((k) => k.startsWith(`${prefix}objects/`))).toHaveLength(1);

    // Approve the imported X, then push: nothing pending → publishes gen2.
    await approveImportedSuggestions(rootB);
    const ok = await runOp(runBrainSyncPush, rootB, { publicKey: keys.publicKey });
    expect(ok.code).toBe(0);
    expect(ok.out.join("\n")).toContain("pushed generation 2");

    // A fresh third machine pulls gen2 and sees BOTH X and Y — the bundle
    // preserved X and added Y (the window is closed).
    const rootC = mkStore();
    activatePro(rootC);
    expect(await initStore(rootC, d.url, recovery)).toBe(0);
    await seedProject(rootC, "alpha", C_LOCAL_ID);
    expect((await runOp(runBrainSyncPull, rootC, { publicKey: keys.publicKey })).code).toBe(0);
    expect(await memoryContents(rootC)).toEqual(["beta-knowledge", "plain knowledge"]);
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
