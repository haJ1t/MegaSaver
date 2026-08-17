import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { join } from "node:path";
import { saveChunkSet } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gatherResumeSources,
  readMeshPresenceLastSeenMs,
  resolveResumeTarget,
} from "../../src/commands/resume/gather.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = Date.parse("2026-08-06T10:00:00.000Z");
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const LIVE_ID = "55555555-5555-4555-8555-555555555555";
const tmpdir = () => realpathSync(readTemporaryDirectory());

let storeRoot: string;
let projectRoot: string;

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-gather-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "megasaver-resume-gather-project-"));
  writeFileSync(join(projectRoot, "auth.ts"), "export const x = 1;\n");
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: projectRoot,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "auth fix",
    startedAt: new Date(NOW - 3_600_000).toISOString(),
    endedAt: null,
  } as never);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("resolveResumeTarget", () => {
  it("resolves a registry session with its project workspace key", async () => {
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    expect(target?.layout).toBe("registry");
    expect(target?.workspaceKey).toBe(encodeWorkspaceKey(projectRoot));
  });

  it("resolves an overlay live session from its stats summary", async () => {
    const wk = encodeWorkspaceKey(projectRoot);
    mkdirSync(join(storeRoot, "stats", wk), { recursive: true });
    writeFileSync(
      join(storeRoot, "stats", wk, `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        eventsTotal: 2,
        rawBytesTotal: 2000,
        returnedBytesTotal: 400,
        bytesSavedTotal: 1600,
        savingRatio: 0.8,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 2,
        updatedAt: new Date(NOW - 30 * 60_000).toISOString(),
      }),
    );
    const target = await resolveResumeTarget({ storeRoot, sessionId: LIVE_ID });
    expect(target?.layout).toBe("overlay");
    expect(target?.workspaceKey).toBe(wk);
  });

  it("returns null for an unknown session id", async () => {
    await expect(
      resolveResumeTarget({ storeRoot, sessionId: "no-such-session" }),
    ).resolves.toBeNull();
  });
});

describe("gatherResumeSources", () => {
  it("joins the read-index to file chunk sets and marks freshness", async () => {
    const filePath = join(projectRoot, "auth.ts");
    await saveChunkSet({
      storeRoot,
      chunkSet: {
        chunkSetId: "cs-file-1",
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: new Date(NOW - 1_800_000).toISOString(),
        source: { kind: "file", path: filePath },
        rawBytes: 20,
        redacted: true,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 20, text: "export const x = 1;" }],
      } as never,
    });
    // read-index entry recording the hash of DIFFERENT content -> "changed"
    const sessionDir = join(storeRoot, "content", PROJECT_ID, SESSION_ID);
    writeFileSync(
      join(sessionDir, "read-index.json"),
      JSON.stringify({ deadbeef: { contentHash: "0".repeat(64), chunkSetId: "cs-file-1" } }),
    );
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    if (target === null) throw new Error("target fixture missing");
    const sources = await gatherResumeSources({ storeRoot, target, nowMs: NOW });
    expect(sources.files).toHaveLength(1);
    expect(sources.files[0]?.freshness).toBe("changed");
    expect(sources.liveness.verdict).toBe("presumed-dead");
  });

  it("degrades every missing source to a labeled omission", async () => {
    const target = await resolveResumeTarget({ storeRoot, sessionId: SESSION_ID });
    if (target === null) throw new Error("target fixture missing");
    const sources = await gatherResumeSources({ storeRoot, target, nowMs: NOW });
    expect(sources.files).toHaveLength(0);
    expect(sources.stats).toBeNull();
    expect(sources.omissions.length).toBeGreaterThan(0);
  });
});

describe("readMeshPresenceLastSeenMs", () => {
  it("reads a fresh presence stamp and tolerates a malformed one", () => {
    const dir = join(storeRoot, "mesh", "presence");
    mkdirSync(dir, { recursive: true });
    // Fixture mirrors the mesh presenceRecordSchema: liveSessionId +
    // ISO-offset lastSeenAt; the reader ignores every other field.
    writeFileSync(
      join(dir, `${LIVE_ID}.json`),
      JSON.stringify({
        liveSessionId: LIVE_ID,
        status: "idle",
        lastSeenAt: new Date(NOW - 60_000).toISOString(),
      }),
    );
    expect(readMeshPresenceLastSeenMs(storeRoot, LIVE_ID)).toBe(NOW - 60_000);
    writeFileSync(join(dir, `${LIVE_ID}.json`), "{broken");
    expect(readMeshPresenceLastSeenMs(storeRoot, LIVE_ID)).toBeNull();
  });
});
