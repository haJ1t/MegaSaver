import { describe, expect, it } from "vitest";
import { overlayTokenSaverEventSchema, tokenSaverEventSchema } from "../src/event.js";

const BASE = {
  id: "evt-1",
  sessionId: "22222222-2222-4222-8222-222222222222",
  projectId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-08-06T12:00:00.000Z",
  sourceKind: "command",
  label: "grep error src",
  rawBytes: 2000,
  returnedBytes: 500,
  bytesSaved: 1500,
  savingRatio: 0.75,
  summary: "3 kept",
};

const OVERLAY_BASE = {
  ...BASE,
  sessionId: undefined,
  projectId: undefined,
  liveSessionId: "33333333-3333-4333-8333-333333333333",
  workspaceKey: "0123456789abcdef",
};

describe("childExitCode receipt field", () => {
  it("parses a clean-exit receipt (0)", () => {
    const parsed = tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: 0 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBe(0);
  });

  it("parses null — a bound-killed child has no meaningful exit code", () => {
    const parsed = tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBeNull();
  });

  it("keeps pre-C3 rows parsing — absence means UNRECORDED, never zero", () => {
    const parsed = tokenSaverEventSchema.safeParse(BASE);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.childExitCode).toBeUndefined();
  });

  it("rejects a stringly exit code and a float", () => {
    expect(tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: "0" }).success).toBe(false);
    expect(tokenSaverEventSchema.safeParse({ ...BASE, childExitCode: 1.5 }).success).toBe(false);
  });

  it("overlay schema carries the same field with the same semantics", () => {
    const { sessionId: _s, projectId: _p, ...overlay } = OVERLAY_BASE;
    expect(overlayTokenSaverEventSchema.safeParse({ ...overlay, childExitCode: 2 }).success).toBe(
      true,
    );
    expect(overlayTokenSaverEventSchema.safeParse(overlay).success).toBe(true);
  });
});
