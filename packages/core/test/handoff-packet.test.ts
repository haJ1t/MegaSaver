import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { FailedAttempt } from "../src/failed-attempt.js";
import {
  type HandoffManifest,
  type HandoffPacket,
  HandoffPacketError,
  type HandoffPayload,
  diagnoseHandoffPacket,
  parseHandoffPacket,
  serializeHandoffPacket,
} from "../src/handoff-packet.js";
import type { MemoryEntry } from "../src/memory-entry.js";

const sha256ForTest = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const NOW_ISO = "2026-07-18T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const EXPIRES_ISO = "2026-07-19T12:00:00.000Z";
const PROJECT_ID = "0f0e0d0c-0b0a-4900-8807-060504030201";

const memory: MemoryEntry = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: PROJECT_ID,
  sessionId: null,
  scope: "project",
  type: "decision",
  title: "Use NDJSON bundles",
  content: "Two-line NDJSON keeps payload hashing byte-exact.",
  keywords: ["ndjson"],
  confidence: "high",
  source: "manual",
  approval: "approved",
  stale: false,
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
} as MemoryEntry;

const failure: FailedAttempt = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "bundle import",
  failedStep: "hash check",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: NOW_ISO,
} as unknown as FailedAttempt;

const payload: HandoffPayload = {
  taskSummary: { text: "Fix flaky test in session store", tokenEstimate: 42 },
  resumeInstructions: "You are resuming a task handed off from claude-code.",
  git: {
    branch: "feat/hot-handoff",
    headSha: "abc1234",
    dirty: true,
    commits: [{ sha: "abc1234", subject: "feat: start", date: NOW_ISO }],
    changedFiles: [{ path: "src/a.ts", churn: 3 }],
    diff: {
      text: "diff --git a/src/a.ts b/src/a.ts",
      truncated: false,
      excludedPaths: [".env"],
    },
  },
  failures: [failure],
  memories: [memory],
};

const manifest: HandoffManifest = {
  schemaVersion: "1",
  kind: "megahandoff",
  sourceProject: { name: "alpha" },
  sourceAgent: "claude-code",
  targetAgent: "codex",
  createdAt: NOW_ISO,
  expiresAt: EXPIRES_ISO,
  payloadSha256: "0".repeat(64),
  redactionFindings: 0,
  secretPathsExcluded: 1,
  counts: { memories: 1, failures: 1, diffFiles: 1, commits: 1 },
};

const packet: HandoffPacket = { manifest, payload };
const text = serializeHandoffPacket(packet);

const manifestLineOf = (t: string) => JSON.parse(t.slice(0, t.indexOf("\n"))) as HandoffManifest;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffPacketError);
    return (error as HandoffPacketError).code;
  }
  return expect.unreachable() as never;
}

describe("serializeHandoffPacket", () => {
  it("writes manifest + payload lines and recomputes payloadSha256", () => {
    const idx = text.indexOf("\n");
    expect(idx).toBeGreaterThan(0);
    expect(text.endsWith("\n")).toBe(false);
    const line = manifestLineOf(text);
    expect(line.kind).toBe("megahandoff");
    expect(line.payloadSha256).toBe(sha256ForTest(text.slice(idx + 1)));
    expect(line.payloadSha256).not.toBe("0".repeat(64));
  });
});

describe("parseHandoffPacket", () => {
  it("roundtrips an unexpired packet", () => {
    const parsed = parseHandoffPacket(text, { now: NOW });
    expect(parsed.manifest.targetAgent).toBe("codex");
    expect(parsed.payload.memories[0]?.title).toBe("Use NDJSON bundles");
    expect(parsed.payload.git?.diff?.excludedPaths).toEqual([".env"]);
  });

  it("tolerates a trailing newline", () => {
    expect(parseHandoffPacket(`${text}\n`, { now: NOW }).manifest.sourceAgent).toBe("claude-code");
  });

  it("rejects at expiresAt exactly (fail-closed boundary)", () => {
    expect(codeOf(() => parseHandoffPacket(text, { now: Date.parse(EXPIRES_ISO) }))).toBe(
      "expired",
    );
  });

  it("rejects after expiry with code expired", () => {
    expect(codeOf(() => parseHandoffPacket(text, { now: Date.parse(EXPIRES_ISO) + 1 }))).toBe(
      "expired",
    );
  });

  it("checks hash before expiry: tampered + expired reports hash_mismatch", () => {
    const tampered = text.replace("Fix flaky", "Fix fluky");
    expect(codeOf(() => parseHandoffPacket(tampered, { now: Date.parse(EXPIRES_ISO) + 1 }))).toBe(
      "hash_mismatch",
    );
  });

  it("fails closed when expiresAt is zod-valid but unparseable (NaN)", () => {
    const idx = text.indexOf("\n");
    const line = { ...manifestLineOf(text), expiresAt: "2026-07-18T12:00:00-99:00" };
    const nanText = `${JSON.stringify(line)}\n${text.slice(idx + 1)}`;
    expect(codeOf(() => parseHandoffPacket(nanText, { now: NOW }))).toBe("expired");
    expect(diagnoseHandoffPacket(nanText, { now: NOW }).expiry).toBe("expired");
  });

  it("rejects unknown schemaVersion with unsupported_version", () => {
    const future = { ...manifestLineOf(text), schemaVersion: "2", extraFutureField: true };
    const idx = text.indexOf("\n");
    expect(
      codeOf(() =>
        parseHandoffPacket(`${JSON.stringify(future)}\n${text.slice(idx + 1)}`, { now: NOW }),
      ),
    ).toBe("unsupported_version");
  });

  it("rejects a single-line file with malformed", () => {
    expect(codeOf(() => parseHandoffPacket("{}", { now: NOW }))).toBe("malformed");
  });

  it("rejects non-slug agent fields (escape/newline forgery)", () => {
    const idx = text.indexOf("\n");
    const hostile = { ...manifestLineOf(text), sourceAgent: "claude\u001b[31m\n-code" };
    const hostileText = `${JSON.stringify(hostile)}\n${text.slice(idx + 1)}`;
    expect(codeOf(() => parseHandoffPacket(hostileText, { now: NOW }))).toBe("malformed");
    expect(diagnoseHandoffPacket(hostileText, { now: NOW }).manifest).toBe("malformed");
    const badTarget = { ...manifestLineOf(text), targetAgent: "Codex Agent" };
    expect(
      codeOf(() =>
        parseHandoffPacket(`${JSON.stringify(badTarget)}\n${text.slice(idx + 1)}`, { now: NOW }),
      ),
    ).toBe("malformed");
  });
});

describe("diagnoseHandoffPacket", () => {
  it("reports all ok on a valid packet and returns parsed data", () => {
    const d = diagnoseHandoffPacket(text, { now: NOW });
    expect(d).toMatchObject({
      version: "ok",
      manifest: "ok",
      hash: "ok",
      expiry: "ok",
      payloadSchema: "ok",
    });
    expect(d.parsedManifest?.targetAgent).toBe("codex");
    expect(d.parsedPayload?.memories).toHaveLength(1);
  });

  it("reports expiry and hash independently on an expired tampered packet", () => {
    const tampered = text.replace("Fix flaky", "Fix fluky");
    const d = diagnoseHandoffPacket(tampered, { now: Date.parse(EXPIRES_ISO) + 1 });
    expect(d.version).toBe("ok");
    expect(d.manifest).toBe("ok");
    expect(d.hash).toBe("mismatch");
    expect(d.expiry).toBe("expired");
    expect(d.payloadSchema).toBe("ok");
  });

  it("reports payload schema failure with hash ok", () => {
    const badPayloadRaw = JSON.stringify({ nope: true });
    const line = { ...manifestLineOf(text), payloadSha256: sha256ForTest(badPayloadRaw) };
    const d = diagnoseHandoffPacket(`${JSON.stringify(line)}\n${badPayloadRaw}`, { now: NOW });
    expect(d.hash).toBe("ok");
    expect(d.expiry).toBe("ok");
    expect(d.payloadSchema).toBe("malformed");
    expect(d.parsedPayload).toBeUndefined();
  });

  it("never throws on garbage", () => {
    expect(diagnoseHandoffPacket("", { now: NOW })).toEqual({
      version: "unsupported",
      manifest: "malformed",
      hash: "skipped",
      expiry: "skipped",
      payloadSchema: "skipped",
    });
    const d = diagnoseHandoffPacket("nope\n{}", { now: NOW });
    expect(d.manifest).toBe("malformed");
    expect(d.hash).toBe("skipped");
    expect(d.payloadSchema).toBe("malformed");
  });
});
