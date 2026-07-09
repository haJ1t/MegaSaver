import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BrainBundleError,
  type BrainManifest,
  type BrainPayload,
  parseBrainBundle,
  serializeBrainBundle,
} from "../src/brain-bundle.js";
import type { FailedAttempt } from "../src/failed-attempt.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import type { ProjectRule } from "../src/project-rule.js";

const sha256ForTest = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

const NOW = "2026-07-09T12:00:00.000Z";
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
  createdAt: NOW,
  updatedAt: NOW,
} as MemoryEntry;

const rule: ProjectRule = {
  id: "22222222-2222-4222-8222-222222222222",
  projectId: PROJECT_ID,
  title: "No raw logs",
  rule: "Never paste raw build logs into context.",
  appliesTo: [],
  evidence: [],
  severity: "warning",
  confidence: "high",
  createdFrom: "manual",
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as ProjectRule;

const failure: FailedAttempt = {
  id: "33333333-3333-4333-8333-333333333333",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "bundle import",
  failedStep: "hash check",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: NOW,
} as unknown as FailedAttempt;

const payload: BrainPayload = { memories: [memory], rules: [rule], failures: [failure] };

function manifestFor(text: string): BrainManifest {
  return JSON.parse(text.slice(0, text.indexOf("\n"))) as BrainManifest;
}

describe("serializeBrainBundle", () => {
  it("produces two lines: manifest then payload", () => {
    const text = serializeBrainBundle({
      sourceProject: { id: PROJECT_ID, name: "alpha" },
      createdAt: NOW,
      redactionFindings: 0,
      payload,
    });
    const idx = text.indexOf("\n");
    expect(idx).toBeGreaterThan(0);
    const manifest = manifestFor(text);
    expect(manifest.schemaVersion).toBe("1");
    expect(manifest.kind).toBe("megabrain");
    expect(manifest.counts).toEqual({ memories: 1, rules: 1, failures: 1 });
    expect(manifest.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(text.slice(idx + 1))).toEqual(JSON.parse(JSON.stringify(payload)));
  });
});

describe("parseBrainBundle", () => {
  const text = serializeBrainBundle({
    sourceProject: { id: PROJECT_ID, name: "alpha" },
    createdAt: NOW,
    redactionFindings: 2,
    payload,
  });

  it("roundtrips a serialized bundle", () => {
    const parsed = parseBrainBundle(text);
    expect(parsed.manifest.sourceProject.name).toBe("alpha");
    expect(parsed.manifest.redactionFindings).toBe(2);
    expect(parsed.payload.memories[0]?.title).toBe("Use NDJSON bundles");
  });

  it("tolerates a benign trailing newline appended after transfer", () => {
    const parsed = parseBrainBundle(`${text}\n`);
    expect(parsed.payload.memories[0]?.title).toBe("Use NDJSON bundles");
  });

  it("rejects a tampered payload byte with hash_mismatch", () => {
    const tampered = text.replace("byte-exact", "byte-exalt");
    expect(() => parseBrainBundle(tampered)).toThrowError(BrainBundleError);
    try {
      parseBrainBundle(tampered);
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("hash_mismatch");
    }
  });

  it("rejects a missing newline with malformed", () => {
    try {
      parseBrainBundle("{}");
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects non-JSON manifest with malformed", () => {
    try {
      parseBrainBundle("not-json\n{}");
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects unknown schemaVersion with unsupported_version before schema errors", () => {
    const manifest = manifestFor(text);
    const future = { ...manifest, schemaVersion: "2", extraFutureField: true };
    const idx = text.indexOf("\n");
    try {
      parseBrainBundle(`${JSON.stringify(future)}\n${text.slice(idx + 1)}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("unsupported_version");
    }
  });

  it("rejects a manifest failing schema with malformed", () => {
    const manifest = manifestFor(text);
    const bad = { ...manifest, payloadSha256: "zzz" };
    const idx = text.indexOf("\n");
    try {
      parseBrainBundle(`${JSON.stringify(bad)}\n${text.slice(idx + 1)}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects a null manifest with malformed", () => {
    try {
      parseBrainBundle("null\n{}");
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects invalid payload JSON syntax with malformed", () => {
    const badPayload = "{not json";
    const manifest = {
      ...manifestFor(text),
      payloadSha256: sha256ForTest(badPayload),
      counts: { memories: 0, rules: 0, failures: 0 },
    };
    try {
      parseBrainBundle(`${JSON.stringify(manifest)}\n${badPayload}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });

  it("rejects payload that fails entity schemas with malformed", () => {
    const rawPayload = JSON.stringify({ memories: [{ nope: true }], rules: [], failures: [] });
    const sha = sha256ForTest(rawPayload);
    const manifest = {
      ...manifestFor(text),
      payloadSha256: sha,
      counts: { memories: 1, rules: 0, failures: 0 },
    };
    try {
      parseBrainBundle(`${JSON.stringify(manifest)}\n${rawPayload}`);
      expect.unreachable();
    } catch (error) {
      expect((error as BrainBundleError).code).toBe("malformed");
    }
  });
});
