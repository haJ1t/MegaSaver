import { describe, expect, it } from "vitest";
import { makeSpawnedSaver } from "../src/saver-subprocess.js";

describe("makeSpawnedSaver", () => {
  it("returns the updatedToolOutput text when the hook compresses", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      storeRoot: "/tmp/store",
      run: () =>
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            updatedToolOutput: { stdout: "SHORT", stderr: "" },
          },
        }),
    });
    expect(apply("LONG RAW")).toBe("SHORT");
  });

  it("returns null on a passthrough decision (no updatedToolOutput)", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      storeRoot: "/tmp/store",
      run: () => "",
    });
    expect(apply("LONG RAW")).toBeNull();
  });

  it("returns null when the hook emits unparseable output (fail-open)", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      storeRoot: "/tmp/store",
      run: () => "{not json",
    });
    expect(apply("LONG RAW")).toBeNull();
  });

  it("feeds the hook a PostToolUse payload carrying the raw output", () => {
    let seen = "";
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      storeRoot: "/tmp/store",
      run: (payload) => {
        seen = payload;
        return "";
      },
    });
    apply("RAW HERE");
    const parsed = JSON.parse(seen);
    expect(parsed.session_id).toBe("s1");
    expect(parsed.cwd).toBe("/repo");
    expect(parsed.tool_name).toBe("Bash");
    expect(parsed.tool_response.stdout).toBe("RAW HERE");
  });

  it("returns null when the hook process throws (fail-open, e.g. binary not found)", () => {
    const apply = makeSpawnedSaver({
      megaBin: "mega",
      cwd: "/repo",
      sessionId: "s1",
      storeRoot: "/tmp/store",
      run: () => {
        throw new Error("spawn failed");
      },
    });
    expect(apply("LONG RAW")).toBeNull();
  });
});
