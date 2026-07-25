import { type KeyObject, createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activateLicense } from "@megasaver/entitlement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffOpen } from "../../src/commands/handoff/open.js";
import { ensureStoreReady } from "../../src/store.js";

type LicensePayload = { v: number; tier: string; id: string; iat: number; exp: number | null };
const b64url = (buf: Buffer): string => buf.toString("base64url");
function signTestLicense(privateKey: KeyObject, payload: LicensePayload): string {
  const bytes = Buffer.from(JSON.stringify(payload));
  return `msp_${b64url(bytes)}.${b64url(sign(null, bytes, privateKey))}`;
}

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const now = () => NOW_MS;

let root: string;
let projectRoot: string;
let dir: string;
let keys: ReturnType<typeof generateKeyPairSync>;
let out: string[];
let err: string[];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-proj-"));
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-sup-files-"));
  keys = generateKeyPairSync("ed25519");
  out = [];
  err = [];
  const key = signTestLicense(keys.privateKey, { v: 1, tier: "pro", id: "c1", iat: 0, exp: null });
  expect(activateLicense(root, key, { publicKey: keys.publicKey, now }).ok).toBe(true);
  await ensureStoreReady(root); // initialize store shape so snapshots are stable
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

async function seedProject(): Promise<void> {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "receiver",
    rootPath: projectRoot,
    createdAt: "2026-07-15T12:00:00.000Z",
    updatedAt: "2026-07-15T12:00:00.000Z",
  } as never);
}

const RECEIVER_ID = "22222222-2222-4222-8222-222222222222";

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

function writePacket(over: { targetAgent?: string; memories?: unknown[] } = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions: "Resume the handoff task.",
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
    expiresAt: "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: 0,
    secretPathsExcluded: 0,
    counts: { memories: 0, failures: 0, diffFiles: 0, commits: 0 },
  };
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${payloadJson}`);
  return file;
}

function snapshotDir(base: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(base, rel), { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else files.set(childRel, readFileSync(join(base, childRel), "utf8"));
    }
  };
  walk("");
  return files;
}

type Row = {
  name: string;
  seedProject: boolean;
  targetFile?: string;
  targetAgent?: string;
  maxPacketBytes?: number;
  expectStderr: RegExp;
};

const rows: Row[] = [
  { name: "open outside a registered project", seedProject: false, expectStderr: /mega init/ },
  {
    name: "unrecognized packet targetAgent",
    seedProject: true,
    targetAgent: "gpt-6",
    expectStderr: /invalid target/,
  },
  { name: "oversized packet", seedProject: true, maxPacketBytes: 4, expectStderr: /exceeds/ },
  {
    name: "corrupted sentinels (block_conflict)",
    seedProject: true,
    targetFile: "<!-- MEGA SAVER:HANDOFF BEGIN -->\norphaned begin, no end\n",
    expectStderr: /sentinel/,
  },
];

describe("§10 write-suppression table — every failure leaves target + store untouched", () => {
  for (const row of rows) {
    it(`${row.name}: exit 1, zero writes`, async () => {
      if (row.seedProject) await seedProject();
      if (row.targetFile !== undefined) {
        writeFileSync(join(projectRoot, "AGENTS.md"), row.targetFile);
      }
      const file = writePacket(
        row.targetAgent === undefined ? {} : { targetAgent: row.targetAgent },
      );
      const storeBefore = snapshotDir(root);

      const code = await runHandoffOpen({
        storeRoot: root,
        cwd: projectRoot,
        now,
        publicKey: keys.publicKey,
        filePath: file,
        merge: false,
        json: false,
        ...(row.maxPacketBytes === undefined ? {} : { maxPacketBytes: row.maxPacketBytes }),
        ensureStore: () => ensureStoreReady(root),
        stdout: (l) => out.push(l),
        stderr: (l) => err.push(l),
      });

      expect(code).toBe(1);
      expect(err.join("\n")).toMatch(row.expectStderr);
      expect(snapshotDir(root)).toEqual(storeBefore);
      if (row.targetFile === undefined) {
        expect(existsSync(join(projectRoot, "AGENTS.md"))).toBe(false);
      } else {
        expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toBe(row.targetFile);
      }
    });
  }
});

// The one failure mode where the target IS written: the block lands first (the
// committed artifact), then the optional memory merge throws. §10 honesty means
// a clean exit 1 that names the applied block — never an uncaught throw.
describe("§10 merge failure after the block is applied", () => {
  it("exit 1, clean error naming the block, no partial memory, no uncaught throw", async () => {
    await seedProject();
    const file = writePacket({ memories: [packetMemory] });

    const code = await runHandoffOpen({
      storeRoot: root,
      cwd: projectRoot,
      now,
      publicKey: keys.publicKey,
      filePath: file,
      merge: true,
      json: false,
      newId: () => "not-a-valid-uuid",
      ensureStore: () => ensureStoreReady(root),
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
    });

    expect(code).toBe(1);
    expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toContain(
      "<!-- MEGA SAVER:HANDOFF BEGIN -->",
    );
    expect(err.join("\n")).toMatch(/applied the handoff block/);
    expect(err.join("\n")).toMatch(/merging memories failed/);

    const { registry } = await ensureStoreReady(root);
    expect(registry.listMemoryEntries(RECEIVER_ID as never)).toHaveLength(0);
  });
});
