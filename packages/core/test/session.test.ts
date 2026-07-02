import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentId } from "@megasaver/shared";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type Session, sessionSchema } from "../src/session.js";
import {
  type TokenSaverSettings,
  defaultTokenSaverSettings,
  tokenSaverSettingsSchema,
} from "../src/token-saver.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STARTED_AT = "2026-05-04T12:10:00.000Z";
const ENDED_AT = "2026-05-04T12:20:00.000Z";

const validSession = {
  id: SESSION_ID,
  projectId: PROJECT_ID,
  agentId: "claude-code",
  riskLevel: "high",
  title: "Implement core foundation",
  startedAt: STARTED_AT,
  endedAt: null,
};

const __dirname = dirname(fileURLToPath(import.meta.url));

const validTokenSaver: TokenSaverSettings = {
  enabled: true,
  mode: "balanced",
  maxReturnedBytes: 12_000,
  storeRawOutput: true,
  redactSecrets: true,
  autoRepair: true,
  createdAt: "2026-05-10T10:00:00.000Z",
  updatedAt: "2026-05-10T10:00:00.000Z",
};

describe("sessionSchema", () => {
  it("parses a valid active session", () => {
    expect(sessionSchema.parse(validSession)).toEqual(validSession);
  });

  it("parses a completed session", () => {
    expect(sessionSchema.parse({ ...validSession, endedAt: ENDED_AT })).toEqual({
      ...validSession,
      endedAt: ENDED_AT,
    });
  });

  it("allows a null title", () => {
    expect(sessionSchema.parse({ ...validSession, title: null }).title).toBe(null);
  });

  it("trims non-null titles", () => {
    expect(sessionSchema.parse({ ...validSession, title: "  Core work  " }).title).toBe(
      "Core work",
    );
  });

  it("rejects empty titles after trimming", () => {
    const result = sessionSchema.safeParse({ ...validSession, title: "   " });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["title"]);
    }
  });

  it("rejects invalid ids, agent ids, risk levels, and datetimes", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      id: "not-a-uuid",
      projectId: "not-a-uuid",
      agentId: "not-an-agent",
      riskLevel: "extreme",
      startedAt: "now",
      endedAt: "later",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "id",
        "projectId",
        "agentId",
        "riskLevel",
        "startedAt",
        "endedAt",
      ]);
    }
  });

  it("rejects unknown fields", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      agentConfigPath: "/tmp/AGENTS.md",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("property: any shipped v0.1 agent id is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom("claude-code", "codex", "generic-cli"), (agentId) => {
        expect(sessionSchema.safeParse({ ...validSession, agentId }).success).toBe(true);
      }),
    );
  });

  it("exports the inferred Session type", () => {
    expectTypeOf<Session>().toMatchTypeOf<{
      id: string;
      projectId: string;
      agentId: AgentId;
      riskLevel: "low" | "medium" | "high" | "critical";
      title: string | null;
      startedAt: string;
      endedAt: string | null;
    }>();
  });

  it("normalizes title to NFC form", () => {
    // NFD input: c-a-f-e-́ (5 code units, combining acute accent)
    const nfdTitle = "café";
    // NFC expected: c-a-f-é (4 code units, precomposed é)
    const nfcExpected = "café";
    const parsed = sessionSchema.parse({
      ...validSession,
      title: nfdTitle,
    });
    expect(parsed.title).toBe(nfcExpected);
    expect(parsed.title?.length).toBe(4);
  });

  it("preserves null title without normalization", () => {
    const parsed = sessionSchema.parse({
      ...validSession,
      title: null,
    });
    expect(parsed.title).toBeNull();
  });

  it("BB1: tokenSaver is undefined on legacy (no field) sessions", () => {
    const parsed = sessionSchema.parse(validSession);
    expect(parsed.tokenSaver).toBeUndefined();
  });

  it("BB1: accepts a valid tokenSaver settings object", () => {
    const parsed = sessionSchema.parse({ ...validSession, tokenSaver: validTokenSaver });
    expect(parsed.tokenSaver).toEqual(validTokenSaver);
  });

  it("BB1: rejects tokenSaver with an unknown key (strict)", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      tokenSaver: { ...validTokenSaver, surprise: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("BB1: rejects tokenSaver with an unknown mode", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      tokenSaver: { ...validTokenSaver, mode: "yolo" },
    });
    expect(result.success).toBe(false);
  });

  it("BB1: rejects tokenSaver.maxReturnedBytes of zero (not positive)", () => {
    const result = sessionSchema.safeParse({
      ...validSession,
      tokenSaver: { ...validTokenSaver, maxReturnedBytes: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("BB1: parses v0.4-era sessions.json fixture (no tokenSaver field) cleanly", () => {
    // F-MED-5: ensures additive-only schema delta does not break pre-AA
    // session records persisted on disk. Fixture mirrors the actual v0.4
    // on-disk shape (no tokenSaver field).
    const fixturePath = join(__dirname, "fixtures/sessions-v0.4.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown[];
    expect(fixture.length).toBeGreaterThan(0);
    for (const raw of fixture) {
      const parsed = sessionSchema.parse(raw);
      expect(parsed.tokenSaver).toBeUndefined();
    }
  });
});

describe("tokenSaverSettingsSchema", () => {
  it("parses a valid settings object", () => {
    expect(tokenSaverSettingsSchema.parse(validTokenSaver)).toEqual(validTokenSaver);
  });

  it("rejects an unknown key (strict)", () => {
    const result = tokenSaverSettingsSchema.safeParse({ ...validTokenSaver, extra: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("unrecognized_keys");
    }
  });

  it("rejects a non-positive maxReturnedBytes", () => {
    expect(
      tokenSaverSettingsSchema.safeParse({ ...validTokenSaver, maxReturnedBytes: -1 }).success,
    ).toBe(false);
  });

  it("rejects a non-integer maxReturnedBytes", () => {
    expect(
      tokenSaverSettingsSchema.safeParse({ ...validTokenSaver, maxReturnedBytes: 1.5 }).success,
    ).toBe(false);
  });

  it("rejects an invalid datetime in createdAt", () => {
    expect(
      tokenSaverSettingsSchema.safeParse({ ...validTokenSaver, createdAt: "yesterday" }).success,
    ).toBe(false);
  });
});

describe("defaultTokenSaverSettings", () => {
  it("returns disabled balanced settings stamped with the injected now()", () => {
    const stamp = "2026-05-11T08:00:00.000Z";
    const settings = defaultTokenSaverSettings(() => stamp);
    expect(settings).toEqual({
      enabled: false,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      redactSecrets: true,
      autoRepair: true,
      createdAt: stamp,
      updatedAt: stamp,
    });
  });

  it("round-trips through tokenSaverSettingsSchema", () => {
    const settings = defaultTokenSaverSettings(() => "2026-05-11T08:00:00.000Z");
    expect(tokenSaverSettingsSchema.parse(settings)).toEqual(settings);
  });
});
