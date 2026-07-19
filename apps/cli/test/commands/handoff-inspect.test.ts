import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHandoffInspect } from "../../src/commands/handoff/inspect.js";

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const now = () => NOW_MS;
const SECRET = `ghp_${"b".repeat(36)}`;

let dir: string;
let out: string[];
let err: string[];
const stdout = (l: string) => out.push(l);
const stderr = (l: string) => err.push(l);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "megasaver-handoff-inspect-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type PacketOver = {
  resume?: string;
  expiresAt?: string;
  claimedRedactions?: number;
  claimedMemories?: number;
  memories?: unknown[];
  git?: unknown;
  tamper?: boolean;
};

function writePacket(over: PacketOver = {}): string {
  const payload = {
    taskSummary: { text: "Task: ship hot handoff", tokenEstimate: 12 },
    resumeInstructions: over.resume ?? "Resume the handoff task.",
    git: over.git ?? null,
    failures: [],
    memories: over.memories ?? [],
  };
  const payloadJson = JSON.stringify(payload);
  const manifest = {
    schemaVersion: "1",
    kind: "megahandoff",
    sourceProject: { name: "alpha" },
    sourceAgent: "claude-code",
    targetAgent: "codex",
    createdAt: "2026-07-15T11:00:00.000Z",
    expiresAt: over.expiresAt ?? "2026-07-16T11:00:00.000Z",
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    redactionFindings: over.claimedRedactions ?? 0,
    secretPathsExcluded: 0,
    counts: {
      memories: over.claimedMemories ?? (over.memories ?? []).length,
      failures: 0,
      diffFiles: 0,
      commits: 0,
    },
  };
  const written = over.tamper === true ? payloadJson.replace("ship", "shIp") : payloadJson;
  const file = join(dir, "packet.megahandoff");
  writeFileSync(file, `${JSON.stringify(manifest)}\n${written}`);
  return file;
}

const unanchoredMemory = {
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

const anchoredMemory = {
  ...unanchoredMemory,
  id: "44444444-4444-4444-8444-444444444444",
  anchor: {
    repoHead: "abc1234",
    capturedAt: "2026-07-15T10:00:00.000Z",
    files: [],
    symbols: [],
  },
};

function run(filePath: string, over: { json?: boolean; maxPacketBytes?: number } = {}) {
  return runHandoffInspect({
    filePath,
    now,
    json: over.json ?? false,
    ...(over.maxPacketBytes === undefined ? {} : { maxPacketBytes: over.maxPacketBytes }),
    stdout,
    stderr,
  });
}

describe("runHandoffInspect", () => {
  it("valid packet: all statuses ok, exit 0, no gate", async () => {
    expect(await run(writePacket())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("version: ok");
    expect(text).toContain("hash: ok");
    expect(text).toContain("expiry: ok");
    expect(text).toContain("payload: ok");
  });

  it("tampered payload: reports hash mismatch, still exit 0", async () => {
    expect(await run(writePacket({ tamper: true }))).toBe(0);
    expect(out.join("\n")).toContain("hash: mismatch");
  });

  it("expired packet: reports expiry, still exit 0", async () => {
    expect(await run(writePacket({ expiresAt: "2026-07-15T11:59:00.000Z" }))).toBe(0);
    expect(out.join("\n")).toContain("expiry: expired");
  });

  it("forged manifest claims: recomputes and warns, never echoes claims as truth", async () => {
    const file = writePacket({
      resume: `Use ${SECRET} now.`,
      claimedRedactions: 0,
      claimedMemories: 5,
    });
    expect(await run(file)).toBe(0);
    expect(out.join("\n")).toContain("recomputed: redactions 1");
    expect(err.join("\n")).toContain("disagrees with manifest claims");
  });

  it("secret-path scan over payload paths", async () => {
    const file = writePacket({
      git: {
        branch: "main",
        headSha: "abc1234",
        dirty: true,
        commits: [],
        changedFiles: [{ path: ".env", churn: 3 }],
        diff: null,
      },
    });
    expect(await run(file)).toBe(0);
    expect(out.join("\n")).toContain("secret paths 1");
    expect(err.join("\n")).toContain("disagrees with manifest claims");
  });

  it("badges recomputed locally from payload entries", async () => {
    expect(await run(writePacket({ memories: [unanchoredMemory] }))).toBe(0);
    expect(out.join("\n")).toContain("unanchored");
  });

  it("payload sections are printed redacted, never raw", async () => {
    expect(await run(writePacket({ resume: `token ${SECRET}` }))).toBe(0);
    const text = out.join("\n");
    expect(text).not.toContain(SECRET);
    expect(text).toContain("gh*_[REDACTED]");
  });

  it("oversized packet: exit 1 before read", async () => {
    expect(await run(writePacket(), { maxPacketBytes: 4 })).toBe(1);
    expect(err.join("\n")).toContain("exceeds");
  });

  it("anchored badge: text qualifies verified as sender anchor, json carries badgeNote", async () => {
    const file = writePacket({ memories: [anchoredMemory] });
    expect(await run(file)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain(`badge: ${anchoredMemory.id} verified`);
    expect(text).toContain("sender anchor");
    expect(text).toContain("not yet checked against this repo");

    out = [];
    expect(await run(file, { json: true })).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.badgeNote).toBe(
      "badges reflect sender-supplied anchors, not yet checked against this repo",
    );
    expect(parsed.recomputed.badges[0].badge).toBe("verified");
  });

  it("tampered packet with anchored memory: hash mismatch, still qualifies verified badge", async () => {
    const file = writePacket({ memories: [anchoredMemory], tamper: true });
    expect(await run(file)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("hash: mismatch");
    expect(text).toContain(`badge: ${anchoredMemory.id} verified`);
    expect(text).toContain("not yet checked against this repo");
  });
});
