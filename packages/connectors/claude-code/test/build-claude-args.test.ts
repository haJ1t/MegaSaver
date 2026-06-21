import { type LaunchInput, LauncherError } from "@megasaver/connectors-shared";
import { describe, expect, it } from "vitest";
import { buildClaudeArgs } from "../src/launcher.js";

function base(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    workdir: "/repo",
    instruction: "do the thing",
    model: "opus",
    permissionMode: "plan",
    allowedTools: [],
    sessionId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

describe("buildClaudeArgs", () => {
  it("builds the base argv with --session-id for a new run", () => {
    expect(buildClaudeArgs(base())).toEqual([
      "-p",
      "do the thing",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "opus",
      "--permission-mode",
      "plan",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("uses --resume (not --session-id) for a resumed run", () => {
    const args = buildClaudeArgs(base({ sessionId: undefined, resumeSessionId: "sess-abc" }));
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-abc");
    expect(args).not.toContain("--session-id");
  });

  it("maps acceptEdits and full permission modes", () => {
    expect(buildClaudeArgs(base({ permissionMode: "acceptEdits" }))).toContain("acceptEdits");
    expect(buildClaudeArgs(base({ permissionMode: "full" }))).toContain("bypassPermissions");
  });

  it("passes the model alias through", () => {
    expect(buildClaudeArgs(base({ model: "haiku" }))[6]).toBe("haiku");
  });

  it("includes --allowedTools only when non-empty", () => {
    const withTools = buildClaudeArgs(base({ allowedTools: ["Read", "Grep"] }));
    expect(withTools).toContain("--allowedTools");
    expect(withTools).toContain("Read");
    expect(withTools).toContain("Grep");
    expect(buildClaudeArgs(base())).not.toContain("--allowedTools");
  });

  it("appends persona via --append-system-prompt when set", () => {
    const args = buildClaudeArgs(base({ persona: "You are an architect." }));
    const i = args.indexOf("--append-system-prompt");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("You are an architect.");
    expect(buildClaudeArgs(base())).not.toContain("--append-system-prompt");
  });

  it("throws LauncherError when neither session id is provided", () => {
    expect(() => buildClaudeArgs(base({ sessionId: undefined }))).toThrow(LauncherError);
  });

  it("throws LauncherError when both session ids are provided", () => {
    expect(() => buildClaudeArgs(base({ resumeSessionId: "x" }))).toThrow(LauncherError);
  });
});
