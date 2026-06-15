import { describe, expect, it } from "vitest";
import { renderSaverStdout } from "../../src/hooks/saver-run.js";

describe("renderSaverStdout", () => {
  it("emits the PostToolUse envelope on compress", () => {
    const s = renderSaverStdout({ updatedToolOutput: { stdout: "X", stderr: "" } });
    expect(JSON.parse(s)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: { stdout: "X", stderr: "" },
      },
    });
  });
  it("emits nothing on passthrough", () => {
    expect(renderSaverStdout({ passthrough: true })).toBe("");
  });
});
