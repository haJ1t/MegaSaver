import { describe, expect, it } from "vitest";
import { observeTreeDelta } from "../src/commands/session/disclosure/observe.js";
import type { ExecGit } from "../src/git-delta.js";

function fakeGit(status: string, log: string | null): ExecGit {
  return (args) => {
    if (args[0] === "status") return status;
    if (args[0] === "log") {
      if (log === null) throw new Error("unborn HEAD");
      return log;
    }
    if (args[0] === "rev-parse") return "abc123\n";
    if (args[0] === "diff") return "";
    throw new Error(`unexpected git ${args[0] ?? "<none>"}`);
  };
}

describe("observeTreeDelta", () => {
  const WINDOW = { startedAt: "2026-08-06T10:00:00.000Z", endedAt: null };

  it("unions dirty worktree paths with committed-window paths", () => {
    const status = " M src/a.ts\0?? pnpm-lock.yaml\0";
    const delta = observeTreeDelta({
      cwd: "/repo",
      ...WINDOW,
      execGit: fakeGit(status, "src/committed.ts\n"),
    });
    expect(delta).toEqual({
      paths: ["src/a.ts", "pnpm-lock.yaml", "src/committed.ts"],
      dirtyCount: 2,
      committedCount: 1,
    });
  });

  it("treats a failed log as empty but a failed status as not-a-repo", () => {
    const delta = observeTreeDelta({
      cwd: "/repo",
      ...WINDOW,
      execGit: fakeGit(" M src/a.ts\0", null),
    });
    expect(delta?.paths).toEqual(["src/a.ts"]);
    const broken: ExecGit = () => {
      throw new Error("not a git repository");
    };
    expect(observeTreeDelta({ cwd: "/repo", ...WINDOW, execGit: broken })).toBeNull();
  });
});
