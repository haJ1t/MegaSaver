import { describe, expect, it } from "vitest";
import {
  OVERLAY_CHUNK_LINES,
  buildRecoveryFooter,
  looksPreTruncated,
} from "../src/recovery-footer.js";

describe("buildRecoveryFooter", () => {
  const base = {
    rawBytes: 100_000,
    returnedBytes: 200,
    chunkSetId: "cs-1",
    rawLooksTruncated: false,
  };

  it("single chunk keeps the wave-2 wording", () => {
    const f = buildRecoveryFooter({ ...base, chunkCount: 1 });
    expect(
      f.startsWith("\n\n[Mega Saver: compressed 100000→200 B (~25000→50 tokens, 99.8%)."),
    ).toBe(true);
    expect(f).toContain('run: mega output chunk "cs-1" "0"');
    expect(f).toContain("proxy_expand_chunk");
    expect(f).not.toContain("chunks of");
    expect(f.endsWith(".]")).toBe(true);
  });

  it("multi chunk advertises N and the id range (no line->id formula)", () => {
    const f = buildRecoveryFooter({ ...base, chunkCount: 5 });
    expect(f).toContain(`stored in 5 chunks of ~${OVERLAY_CHUNK_LINES} lines each`);
    expect(f).toContain('mega output chunk "cs-1" "<i>" (i = 0..4)');
    expect(f).not.toContain("covers lines");
  });

  it("truncated raw switches to the PARTIAL note", () => {
    const f = buildRecoveryFooter({ ...base, chunkCount: 2, rawLooksTruncated: true });
    expect(f).toContain("NOTE: upstream output appears truncated, recovered chunks are PARTIAL");
    expect(f).not.toContain("Full output recoverable");
  });
});

describe("looksPreTruncated", () => {
  it("detects a truncation marker in the tail", () => {
    expect(looksPreTruncated(`${"x".repeat(500)}\n[truncated]`)).toBe(true);
  });
  it("ignores a mid-text mention outside the last 256 bytes", () => {
    expect(looksPreTruncated(`output truncated${"x".repeat(500)}`)).toBe(false);
  });
});
