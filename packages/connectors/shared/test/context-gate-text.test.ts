import { describe, expect, it } from "vitest";
import {
  MEGA_SAVER_BLOCK_END,
  MEGA_SAVER_BLOCK_START,
  MEGA_SAVER_CG_BLOCK_END,
  MEGA_SAVER_CG_BLOCK_START,
  renderContextGateBlockText,
  upsertContextGateBlockText,
} from "../src/index.js";

const block = (mode: "aggressive" | "balanced" | "safe" = "balanced", bytes = 12_000) =>
  renderContextGateBlockText({
    sessionId: "(workspace-wide)",
    projectId: "my-app",
    mode,
    maxReturnedBytes: bytes,
  });

describe("renderContextGateBlockText", () => {
  it("renders a sentinel-bounded block carrying mode + budget + identity", () => {
    const out = block("aggressive", 4_000);
    expect(out.startsWith(MEGA_SAVER_CG_BLOCK_START)).toBe(true);
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_END);
    expect(out).toContain("Mode: aggressive");
    expect(out).toContain("Max returned bytes: 4000");
    expect(out).toContain("Session: (workspace-wide)");
    expect(out).toContain("Project: my-app");
  });

  it("ends with a trailing newline", () => {
    expect(block().endsWith("\n")).toBe(true);
  });
});

describe("upsertContextGateBlockText", () => {
  it("inserts the block when absent and preserves human content", () => {
    const out = upsertContextGateBlockText("# My notes\n\nhello\n", block());
    expect(out).toContain("# My notes");
    expect(out).toContain("hello");
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_START);
  });

  it("is idempotent — applying twice yields identical output", () => {
    const once = upsertContextGateBlockText("# My notes\n", block());
    const twice = upsertContextGateBlockText(once, block());
    expect(twice).toBe(once);
  });

  it("removes the block on empty render and restores surrounding content", () => {
    const withBlock = upsertContextGateBlockText("# My notes\n\nhello\n", block());
    const removed = upsertContextGateBlockText(withBlock, "");
    expect(removed).not.toContain(MEGA_SAVER_CG_BLOCK_START);
    expect(removed).toContain("# My notes");
    expect(removed).toContain("hello");
  });

  it("leaves a pre-existing legacy MEGA_SAVER block untouched", () => {
    const legacy = `${MEGA_SAVER_BLOCK_START}\nlegacy body\n${MEGA_SAVER_BLOCK_END}\n`;
    const out = upsertContextGateBlockText(legacy, block());
    expect(out).toContain(MEGA_SAVER_BLOCK_START);
    expect(out).toContain("legacy body");
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_START);
  });

  it("preserves CRLF line endings (dominant-EOL round-trip)", () => {
    const out = upsertContextGateBlockText("# My notes\r\n\r\nhello\r\n", block());
    expect(out).toContain("\r\n");
    expect(out).toContain(MEGA_SAVER_CG_BLOCK_START);
  });
});
