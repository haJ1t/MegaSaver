import { type KeyObject, createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHandoffOpen } from "../../src/commands/handoff/open.js";
import { HANDOFF_UPSELL } from "../../src/commands/handoff/shared.js";
import { ensureStoreReady } from "../../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW = "2026-07-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const now = () => NOW_MS;
const RECEIVER_ID = "22222222-2222-4222-8222-222222222222";

let root: string;
let projectRoot: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-proj-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-open-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

function activatePro(): void {
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
}

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: RECEIVER_ID,
    name: "receiver",
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

type PacketOver = {
  targetAgent?: string;
  expiresAt?: string;
  resume?: string;
  memories?: unknown[];
};

function writePacket(over: PacketOver = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions:
      over.resume ?? "You are resuming a task handed off from claude-code on project alpha.",
    git: null,
    failures: [],
    memories: over.memories ?? [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: over.targetAgent ?? "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: over.expiresAt ?? "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: 0,
    secretPathsExcluded: 0,
    counts: { memories: (over.memories ?? []).length, failures: 0, diffFiles: 0, commits: 0 },
  };
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${payloadJson}`);
  return file;
}

const packetMemory = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: "0f0e0d0c-0b0a-4900-8807-060504030201",
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "handoff decision",
  content: "prefer pnpm for installs",
  keywords: [],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:00.000Z",
};

function run(over: Partial<Parameters<typeof runHandoffOpen>[0]> & { filePath: string }) {
  const ensureStore = vi.fn(() => ensureStoreReady(root));
  const code = runHandoffOpen({
    storeRoot: root,
    cwd: projectRoot,
    now,
    publicKey: keys.publicKey,
    merge: false,
    json: false,
    ensureStore,
    stdout,
    stderr,
    ...over,
  });
  return { code, ensureStore };
}

describe("runHandoffOpen — gating", () => {
  it("free tier: upsell, exit 0, store never opened", async () => {
    const file = writePacket();
    const { code, ensureStore } = run({ filePath: file });
    expect(await code).toBe(0);
    expect(out.join("\n")).toBe(HANDOFF_UPSELL);
    expect(ensureStore).not.toHaveBeenCalled();
  });
});

describe("runHandoffOpen — entitled", () => {
  beforeEach(() => activatePro());

  it("outside a registered project: exit 1 pointing at mega init, nothing written", async () => {
    const file = writePacket();
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("mega init");
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("unknown targetAgent: exit 1, nothing written", async () => {
    await seedProject();
    const file = writePacket({ targetAgent: "gpt-6" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain('invalid target "gpt-6"');
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("oversized packet: refused before read", async () => {
    await seedProject();
    const file = writePacket();
    const { code } = run({ filePath: file, maxPacketBytes: 4 });
    expect(await code).toBe(1);
    expect(err.join("\n")).toContain("exceeds");
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("expired packet: exit 1, nothing written", async () => {
    await seedProject();
    const file = writePacket({ expiresAt: "2026-07-15T11:59:00.000Z" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(1);
    expect(err.join("\n")).toMatch(/expired/);
    expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
  });

  it("creates a missing target file with the handoff block", async () => {
    await seedProject();
    const file = writePacket();
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
    expect(content).toContain("You are resuming a task handed off from claude-code");
    expect(content).toContain("disregard this handoff");
  });

  it("seeds the target header when creating a header-bearing target", async () => {
    await seedProject();
    const file = writePacket({ targetAgent: "cursor" });
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, ".cursor/rules/megasaver.mdc"), "utf8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("<!-- MEGA SAVER:HANDOFF BEGIN -->");
  });

  it("upserts into an existing file: human content kept, no duplicate block", async () => {
    await seedProject();
    writeFileSync(join(projectRoot, "AGENTS.md"), "# My agents\n\nhuman text\n");
    const file = writePacket();
    expect(await run({ filePath: file }).code).toBe(0);
    expect(await run({ filePath: file }).code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("human text");
    expect(content.match(/MEGA SAVER:HANDOFF BEGIN/g)).toHaveLength(1);
  });

  it("open-side redaction: raw secret never reaches the target file, warns", async () => {
    await seedProject();
    const secret = `ghp_${"a".repeat(36)}`;
    const file = writePacket({ resume: `Use token ${secret} to resume.` });
    const { code } = run({ filePath: file });
    expect(await code).toBe(0);
    const content = readFileSync(join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).not.toContain(secret);
    expect(content).toContain("gh*_[REDACTED]");
    expect(err.join("\n")).toContain("open-side redaction");
  });

  it("--merge imports packet memories as suggested with provenance", async () => {
    await seedProject();
    const file = writePacket({ memories: [packetMemory] });
    let n = 0;
    const newId = () => `44444444-4444-4444-8444-4444444444${String(40 + n++)}`;
    const { code } = run({ filePath: file, merge: true, newId });
    expect(await code).toBe(0);
    const { registry } = await ensureStoreReady(root);
    const imported = registry
      .listMemoryEntries(RECEIVER_ID as never)
      .find((m) => m.content === "prefer pnpm for installs");
    expect(imported).toBeDefined();
    expect(imported?.approval).toBe("suggested");
    expect(imported?.scope).toBe("project");
    expect(imported?.sessionId).toBeNull();
    expect(imported?.evidence ?? []).toContain("handoff:alpha");
    expect(out.join("\n")).toContain("suggested");
  });
});
