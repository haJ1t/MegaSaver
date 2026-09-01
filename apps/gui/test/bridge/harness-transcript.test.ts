import { describe, expect, it } from "vitest";
import { readCodexTranscript } from "../../bridge/claude-sessions/codex-transcript.js";
import { readHarnessTranscript } from "../../bridge/claude-sessions/harness-transcript.js";
import { readOpenCodeTranscript } from "../../bridge/claude-sessions/opencode-transcript.js";
import { readPiTranscript } from "../../bridge/claude-sessions/pi-transcript.js";

describe("harness-transcript dispatcher (Task 1 split)", () => {
  it("re-exports per-harness readers", () => {
    expect(typeof readCodexTranscript).toBe("function");
    expect(typeof readPiTranscript).toBe("function");
    expect(typeof readOpenCodeTranscript).toBe("function");
    expect(typeof readHarnessTranscript).toBe("function");
  });

  it("imports resolve via the dispatcher without throwing", async () => {
    const m = await import("../../bridge/claude-sessions/harness-transcript.js");
    expect(typeof m.readHarnessTranscript).toBe("function");
  });
});
