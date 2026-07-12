import { describe, expect, it } from "vitest";
import { type ExecGit, gatherGitDelta } from "../src/git-delta.js";

const SINCE = "2026-07-01T00:00:00.000Z";

function fakeGit(responses: Record<string, string | Error>): ExecGit {
  return (args) => {
    const key = args.join(" ");
    for (const [prefix, value] of Object.entries(responses)) {
      if (key.startsWith(prefix)) {
        if (value instanceof Error) throw value;
        return value;
      }
    }
    throw new Error(`unexpected git ${key}`);
  };
}

describe("gatherGitDelta", () => {
  it("uses merge-base diff on a feature branch", () => {
    const delta = gatherGitDelta(
      "/repo",
      SINCE,
      fakeGit({
        "rev-parse --abbrev-ref HEAD": "feat/x\n",
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "merge-base origin/main HEAD": "aaa111\n",
        "log --since": "abc1234\tfix parser\t2026-07-10T00:00:00+00:00\n",
        "diff --numstat": "10\t2\tsrc/parser.ts\n",
      }),
    );
    expect(delta).not.toBeNull();
    expect(delta?.changedFiles).toEqual([{ path: "src/parser.ts", churn: 12 }]);
    expect(delta?.commits[0]).toEqual({
      sha: "abc1234",
      subject: "fix parser",
      date: "2026-07-10T00:00:00+00:00",
    });
  });

  it("falls back to log --name-only on the default branch (empty diff)", () => {
    const delta = gatherGitDelta(
      "/repo",
      SINCE,
      fakeGit({
        "rev-parse --abbrev-ref HEAD": "main\n",
        "symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main\n",
        "log --since": "abc1234\twip\t2026-07-10T00:00:00+00:00\n",
        "log --name-only": "src/a.ts\nsrc/b.ts\nsrc/a.ts\n",
      }),
    );
    expect(delta?.changedFiles.map((f) => f.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("caps --since at 14 days when lastSeenAt is null", () => {
    const seen: string[] = [];
    gatherGitDelta(
      "/repo",
      null,
      (args) => {
        seen.push(args.join(" "));
        if (args[0] === "rev-parse") return "main\n";
        if (args[0] === "symbolic-ref") return "refs/remotes/origin/main\n";
        return "";
      },
      "2026-07-12T10:00:00.000Z",
    );
    const logCall = seen.find((c) => c.startsWith("log --since"));
    expect(logCall).toContain("2026-06-28"); // 14d before now
  });

  it("returns null when git is unavailable", () => {
    expect(
      gatherGitDelta("/repo", SINCE, () => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });
});
