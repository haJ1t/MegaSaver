import { describe, expect, it } from "vitest";
import { resolveModelId } from "../src/model-provenance.js";

const at = Date.parse("2026-08-01T12:00:00.000Z");

describe("model-provenance", () => {
  it("prefers a proxy usage row inside the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [{ atMs: at - 5_000, modelId: "claude-opus-5" }],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-opus-5");
  });

  it("ignores a proxy row outside the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [{ atMs: at - 600_000, modelId: "claude-opus-5" }],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("falls back to the configured default when no proxy row exists", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [],
        configuredDefaultModelId: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("returns undefined when nothing is known — it never guesses", () => {
    expect(resolveModelId({ eventAtMs: at, windowMs: 60_000, proxyRows: [] })).toBeUndefined();
  });

  it("picks the closest proxy row when several are in the window", () => {
    expect(
      resolveModelId({
        eventAtMs: at,
        windowMs: 60_000,
        proxyRows: [
          { atMs: at - 30_000, modelId: "claude-haiku-4-5" },
          { atMs: at - 1_000, modelId: "claude-opus-5" },
        ],
      }),
    ).toBe("claude-opus-5");
  });
});
