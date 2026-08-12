import { describe, expect, it } from "vitest";
import {
  boardFactSchema,
  claimRecordSchema,
  meshEventSchema,
  presenceRecordSchema,
} from "../src/types.js";

describe("mesh schemas", () => {
  it("presence requires workspaceKey and strict rejects unknown", () => {
    const ok = {
      liveSessionId: "a1",
      agent: "claude-code",
      status: "working" as const,
      lastSeenAt: new Date().toISOString(),
      workspaceKey: "0123456789abcdef",
      cwd: "/repo",
    };
    expect(presenceRecordSchema.safeParse(ok).success).toBe(true);
    expect(
      presenceRecordSchema.safeParse({ ...ok, extra: 1 } as unknown as typeof ok).success,
    ).toBe(false);
  });

  it("meshEvent kind union is exactly message|ask|answer in Phase1", () => {
    const base = {
      id: "1",
      kind: "message" as const,
      from: "a1",
      text: "hi",
      createdAt: new Date().toISOString(),
    };
    expect(meshEventSchema.safeParse(base).success).toBe(true);
    expect(
      meshEventSchema.safeParse({ ...base, kind: "unknown" as unknown as typeof base.kind })
        .success,
    ).toBe(false);
  });

  it("claimRecordSchema is strict and validates required fields", () => {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const claim = {
      claimId: "c1",
      liveSessionId: "a1",
      workspaceKey: "0123456789abcdef",
      paths: ["src/auth.ts"],
      createdAt: now,
      refreshedAt: now,
      expiresAt: later,
    };
    expect(claimRecordSchema.safeParse(claim).success).toBe(true);
    expect(
      claimRecordSchema.safeParse({ ...claim, extra: 1 } as unknown as typeof claim).success,
    ).toBe(false);
  });

  it("boardFactSchema enforces §13 and strict rejects unknown", () => {
    const now = new Date().toISOString();
    const fact = {
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      topic: "api z",
      text: "fact text",
      source: { liveSessionId: "a1", agent: "claude-code" },
      createdAt: now,
      confidence: "high" as const,
      scope: { repoKey: "0123456789abcdef" },
      expiresAt: null,
      status: "active" as const,
      disputedWith: [],
    };
    expect(boardFactSchema.safeParse(fact).success).toBe(true);
    expect(boardFactSchema.safeParse({ ...fact, extra: 1 } as unknown as typeof fact).success).toBe(
      false,
    );
  });

  it("boardFactSchema requires expiresAt explicit null and rejects missing", () => {
    const now = new Date().toISOString();
    const fact = {
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      topic: "api z",
      text: "fact text",
      source: { liveSessionId: "a1", agent: "claude-code" },
      createdAt: now,
      confidence: "high" as const,
      scope: { repoKey: "0123456789abcdef" },
      status: "active" as const,
      disputedWith: [],
    };
    // Missing expiresAt should fail (field is required, even if null)
    expect(boardFactSchema.safeParse(fact as unknown as Record<string, unknown>).success).toBe(
      false,
    );
  });
});
