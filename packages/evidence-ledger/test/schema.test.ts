import { describe, expect, it } from "vitest";
import {
  isScrubbedSourceRef,
  redactionReportSchema,
  returnedChunkRefSchema,
  scrubSourceRef,
  sessionRefSchema,
  sourceRefSchema,
  transitionSchema,
} from "../src/sub-schemas.js";

describe("evidence-ledger sub-schemas", () => {
  it("sourceRef accepts a partial structured label and rejects unknown keys", () => {
    expect(sourceRefSchema.safeParse({ path: "src/a.ts" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ command: "git", args: ["log"] }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ hookTool: "Bash" }).success).toBe(true);
    expect(sourceRefSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("scrubSourceRef drops secret-bearing fields and keeps only a label", () => {
    const scrubbed = scrubSourceRef({
      command: "curl -H 'Authorization: Bearer sk-live-XYZ' https://api/x",
      args: ["--secret", "abc"],
      url: "https://h/cb?token=SECRET",
      path: "/etc/shadow",
      query: "password=hunter2",
      label: "git-log",
    });
    expect(scrubbed).toEqual({ label: "redacted" });
    expect(isScrubbedSourceRef(scrubbed)).toBe(true);
  });

  it("isScrubbedSourceRef rejects a ref that still carries secret-bearing fields", () => {
    expect(isScrubbedSourceRef({ command: "git log" })).toBe(false);
    expect(isScrubbedSourceRef({ url: "https://x" })).toBe(false);
    expect(isScrubbedSourceRef({ label: "ok" })).toBe(true);
    expect(isScrubbedSourceRef({})).toBe(true);
  });

  it("sessionRef is a kind+id pair or null", () => {
    expect(sessionRefSchema.safeParse(null).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "durable", id: "s-1" }).success).toBe(true);
    expect(sessionRefSchema.safeParse({ kind: "other", id: "x" }).success).toBe(false);
    expect(sessionRefSchema.safeParse({ kind: "live", id: "" }).success).toBe(false);
  });

  it("redactionReport tracks unresolved high-risk findings", () => {
    expect(
      redactionReportSchema.safeParse({ redacted: true, highRiskFindings: 0, unresolvedHighRisk: false })
        .success,
    ).toBe(true);
    expect(
      redactionReportSchema.safeParse({ redacted: true, highRiskFindings: -1, unresolvedHighRisk: false })
        .success,
    ).toBe(false);
  });

  it("returnedChunkRef requires both ids", () => {
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1", chunkId: "0" }).success).toBe(true);
    expect(returnedChunkRefSchema.safeParse({ chunkSetId: "cs-1" }).success).toBe(false);
  });

  it("transition records an auditable event with an optional memoryId", () => {
    expect(
      transitionSchema.safeParse({ at: "2026-06-16T12:00:00.000Z", kind: "created", actor: "system" })
        .success,
    ).toBe(true);
    expect(
      transitionSchema.safeParse({
        at: "2026-06-16T12:00:00.000Z",
        kind: "pinned",
        actor: "system",
        memoryId: "00000000-0000-4000-8000-0000000000a1",
      }).success,
    ).toBe(true);
    expect(transitionSchema.safeParse({ at: "not-a-date", kind: "created" }).success).toBe(false);
  });
});
