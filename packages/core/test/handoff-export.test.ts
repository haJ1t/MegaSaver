import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type FailedAttempt, failedAttemptSchema } from "../src/failed-attempt.js";
import { type BuildHandoffPacketInput, buildHandoffPacket } from "../src/handoff-export.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";

const NOW_ISO = "2026-07-18T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const EXPIRES = NOW + 24 * 60 * 60 * 1000;
const PROJECT_ID = projectIdSchema.parse("0f0e0d0c-0b0a-4900-8807-060504030201");
const SESSION_ID = sessionIdSchema.parse("44444444-4444-4444-8444-444444444444");
const OTHER_SESSION_ID = sessionIdSchema.parse("55555555-5555-4555-8555-555555555555");
const SECRET = "sk-ant-api03-abcdefghij0123456789";

let seq = 0;
function nextSuffix(): string {
  seq += 1;
  return String(seq).padStart(12, "0");
}

function memory(overrides: Record<string, unknown> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: `11111111-1111-4111-8111-${nextSuffix()}`,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "decision title",
    content: "decided something",
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    ...overrides,
  });
}

function failure(overrides: Record<string, unknown> = {}): FailedAttempt {
  return failedAttemptSchema.parse({
    id: `33333333-3333-4333-8333-${nextSuffix()}`,
    projectId: PROJECT_ID,
    sessionId: null,
    task: "deploy",
    failedStep: "auth",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: NOW_ISO,
    ...overrides,
  });
}

function baseInput(overrides: Partial<BuildHandoffPacketInput> = {}): BuildHandoffPacketInput {
  return {
    projectName: "alpha",
    projectId: PROJECT_ID,
    sourceAgent: "claude-code",
    targetAgent: "codex",
    resumeInstructions: "You are resuming a task handed off from claude-code on project alpha.",
    now: NOW,
    expiresAt: EXPIRES,
    memories: [],
    failedAttempts: [],
    rules: [],
    sessionId: null,
    gitDelta: null,
    dirtyState: null,
    permissions: null,
    budgetTokens: 2000,
    ...overrides,
  };
}

describe("buildHandoffPacket — memory selection", () => {
  it("includes approved project memories; excludes suggested, stale, archival", () => {
    const keep = memory({ content: "keep me" });
    const suggested = memory({ approval: "suggested", content: "suggested row" });
    const stale = memory({ stale: true, content: "stale row" });
    const archival = memory({ tier: "archival", content: "archival row" });
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [keep, suggested, stale, archival] }),
    );
    const contents = packet.payload.memories.map((m) => m.content);
    expect(contents).toEqual(["keep me"]);
  });

  it("includes session memories of the resolved session only", () => {
    const mine = memory({ scope: "session", sessionId: SESSION_ID, content: "session insight" });
    const other = memory({
      scope: "session",
      sessionId: OTHER_SESSION_ID,
      content: "other session",
    });
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [mine, other], sessionId: SESSION_ID }),
    );
    const contents = packet.payload.memories.map((m) => m.content);
    expect(contents).toContain("session insight");
    expect(contents).not.toContain("other session");
  });

  it("excludes all session memories when no session resolved", () => {
    const mine = memory({ scope: "session", sessionId: SESSION_ID, content: "session insight" });
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [mine] }));
    expect(packet.payload.memories).toEqual([]);
    expect(report.noOpenSession).toBe(true);
  });

  it("ranks by effectiveConfidence and caps at 20", () => {
    const low = memory({ confidence: "low", content: "low confidence" });
    const high = memory({ confidence: "high", content: "high confidence" });
    const filler = Array.from({ length: 25 }, () => memory({ confidence: "medium" }));
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [low, high, ...filler] }));
    expect(packet.payload.memories).toHaveLength(20);
    expect(packet.payload.memories[0]?.content).toBe("high confidence");
    expect(packet.payload.memories.map((m) => m.content)).not.toContain("low confidence");
    expect(report.counts.memories).toBe(20);
  });
});

describe("buildHandoffPacket — failures", () => {
  it("keeps unresolved failures only", () => {
    const open = failure({ task: "open one" });
    const resolved = failure({ task: "resolved one", resolution: "fixed by pinning node" });
    const converted = failure({ task: "converted one", convertedToRule: true });
    const { packet } = buildHandoffPacket(
      baseInput({ failedAttempts: [open, resolved, converted] }),
    );
    expect(packet.payload.failures.map((f) => f.task)).toEqual(["open one"]);
  });

  it("orders most recent first and caps at 10", () => {
    const older = failure({ task: "older", createdAt: "2026-07-18T09:00:00.000Z" });
    const newer = failure({ task: "newer", createdAt: "2026-07-18T11:00:00.000Z" });
    const filler = Array.from({ length: 11 }, () =>
      failure({ createdAt: "2026-07-18T10:00:00.000Z" }),
    );
    const { packet } = buildHandoffPacket(baseInput({ failedAttempts: [older, ...filler, newer] }));
    expect(packet.payload.failures).toHaveLength(10);
    expect(packet.payload.failures[0]?.task).toBe("newer");
    expect(packet.payload.failures.map((f) => f.task)).not.toContain("older");
  });
});

describe("buildHandoffPacket — task summary", () => {
  it("assembles a timeless standard brief, never micro", () => {
    const { packet } = buildHandoffPacket(baseInput({ memories: [memory()] }));
    const lines = packet.payload.taskSummary.text.split("\n");
    expect(lines[0]).toBe("# Warm Start — alpha");
    expect(packet.payload.taskSummary.text).toContain("## Standing decisions");
    expect(packet.payload.taskSummary.tokenEstimate).toBeGreaterThan(0);
  });
});

describe("buildHandoffPacket — redaction, manifest, report", () => {
  it("redacts secrets in every free-text field and sums findings", () => {
    const input = baseInput({
      memories: [memory({ content: `uses ${SECRET} here` })],
      failedAttempts: [failure({ errorOutput: `auth failed with ${SECRET}` })],
      resumeInstructions: `resume with ${SECRET}`,
    });
    const { packet, report } = buildHandoffPacket(input);
    expect(JSON.stringify(packet)).not.toContain(SECRET);
    expect(packet.manifest.redactionFindings).toBeGreaterThanOrEqual(3);
    expect(report.redactionFindings).toBe(packet.manifest.redactionFindings);
  });

  it("writes manifest identity, expiry, and counts", () => {
    const { packet } = buildHandoffPacket(
      baseInput({ memories: [memory()], failedAttempts: [failure()] }),
    );
    expect(packet.manifest.kind).toBe("megahandoff");
    expect(packet.manifest.schemaVersion).toBe("1");
    expect(packet.manifest.sourceProject).toEqual({ name: "alpha" });
    expect(packet.manifest.sourceAgent).toBe("claude-code");
    expect(packet.manifest.targetAgent).toBe("codex");
    expect(packet.manifest.createdAt).toBe(NOW_ISO);
    expect(packet.manifest.expiresAt).toBe(new Date(EXPIRES).toISOString());
    expect(packet.manifest.counts).toEqual({
      memories: 1,
      failures: 1,
      diffFiles: 0,
      commits: 0,
    });
    expect(packet.manifest.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags degraded git and passes plain git state through", () => {
    const degraded = buildHandoffPacket(baseInput());
    expect(degraded.packet.payload.git).toBeNull();
    expect(degraded.report.degradedGit).toBe(true);

    const withGit = buildHandoffPacket(
      baseInput({
        gitDelta: {
          commits: [{ sha: "abc1234", subject: "feat: x", date: NOW_ISO }],
          changedFiles: [{ path: "src/app.ts", churn: 3 }],
          branch: "feat/hot-handoff",
        },
        dirtyState: { headSha: "abc1234", dirty: true, statusPaths: [], diffText: null },
      }),
    );
    expect(withGit.report.degradedGit).toBe(false);
    expect(withGit.packet.payload.git).toEqual({
      branch: "feat/hot-handoff",
      headSha: "abc1234",
      dirty: true,
      commits: [{ sha: "abc1234", subject: "feat: x", date: NOW_ISO }],
      changedFiles: [{ path: "src/app.ts", churn: 3 }],
      diff: null,
    });
    expect(withGit.packet.manifest.counts.commits).toBe(1);
  });

  it("recomputes badges into the report, never the payload", () => {
    const anchored = memory({
      content: "anchored row",
      anchor: { repoHead: "abc1234", capturedAt: NOW_ISO, files: [], symbols: [] },
    });
    const plain = memory({ content: "plain row", confidence: "low" });
    const { packet, report } = buildHandoffPacket(baseInput({ memories: [anchored, plain] }));
    expect(report.badges).toEqual([
      { memoryId: anchored.id, badge: "verified" },
      { memoryId: plain.id, badge: "unanchored" },
    ]);
    for (const m of packet.payload.memories) {
      expect(m).not.toHaveProperty("badge");
    }
  });
});
