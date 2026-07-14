import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureCodeAnchor } from "../src/memory-anchor.js";

const NOW = "2026-07-13T12:00:00.000Z";

const TS_SOURCE = `export function alpha(a: number): number {
  return a + 1;
}

export function beta(): void {}
`;

// two top-level defs sharing a name -> the py extractor emits two blocks
// named "dup" (capture-side collision fixture, architect N2)
const PY_DUP_SOURCE = `def dup(a):
    return a + 1

def dup(b):
    return b + 2
`;

function fakeGit(map: Record<string, string>) {
  return (args: string[], _cwd: string): string => {
    const key = args.join(" ");
    const out = map[key];
    if (out === undefined) throw new Error(`fake git rejects: ${key}`);
    return out;
  };
}

// records every argv so a test can assert an unsafe path NEVER reaches a git
// call (not merely that the result was undefined by coincidence).
function spyGit(map: Record<string, string>) {
  const calls: string[][] = [];
  const exec = (args: string[], _cwd: string): string => {
    calls.push(args);
    const out = map[args.join(" ")];
    if (out === undefined) throw new Error(`spy git rejects: ${args.join(" ")}`);
    return out;
  };
  return { exec, calls };
}

describe("captureCodeAnchor (fake git)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "megasaver-anchor-unit-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "a.ts"), TS_SOURCE);
    writeFileSync(join(root, "src", "d.py"), PY_DUP_SOURCE);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("anchors a tracked related file with repoHead + blobSha + capturedAt", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor).toEqual({
      repoHead: "headsha1",
      capturedAt: NOW,
      files: [{ path: "src/a.ts", blobSha: "blobsha1" }],
      symbols: [],
    });
  });

  it("returns undefined when rev-parse HEAD fails (not a git repo)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      now: NOW,
      execGit: fakeGit({}),
    });
    expect(anchor).toBeUndefined();
  });

  it("skips untracked files; nothing anchored -> undefined", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/new.ts"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor).toBeUndefined();
  });

  it("normalizes absolute in-root inputs to repo-relative POSIX", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: [join(root, "src", "a.ts")],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.files).toEqual([{ path: "src/a.ts", blobSha: "blobsha1" }]);
  });

  it("skips escaping paths and control-character paths (N3/N4)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["../outside.ts", "src/a\nb.ts", "/etc/passwd"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor).toBeUndefined();
  });

  it("anchors a path#name symbol from current file content", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedSymbols: ["src/a.ts#alpha"],
      now: NOW,
      execGit: fakeGit({ "rev-parse HEAD": "headsha1\n" }),
    });
    expect(anchor?.symbols).toHaveLength(1);
    const sym = anchor?.symbols[0];
    expect(sym?.path).toBe("src/a.ts");
    expect(sym?.name).toBe("alpha");
    expect((sym?.contentHash.length ?? 0) > 0).toBe(true);
    expect(sym?.startLine).toBeGreaterThan(0);
    expect(sym?.endLine).toBeGreaterThanOrEqual(sym?.startLine ?? Number.MAX_SAFE_INTEGER);
  });

  it("resolves a bare symbol name across relatedFiles", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      relatedSymbols: ["beta"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.symbols.map((s) => s.name)).toEqual(["beta"]);
  });

  it("skips a name-colliding symbol at capture (N2), keeps the file anchor", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/d.py"],
      relatedSymbols: ["src/d.py#dup"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/d.py": "blobsha2\n",
      }),
    });
    expect(anchor?.files).toEqual([{ path: "src/d.py", blobSha: "blobsha2" }]);
    expect(anchor?.symbols).toEqual([]);
  });

  it("skips an unknown symbol name without failing the capture", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/a.ts"],
      relatedSymbols: ["nope"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/a.ts": "blobsha1\n",
      }),
    });
    expect(anchor?.files).toHaveLength(1);
    expect(anchor?.symbols).toEqual([]);
  });

  it("never lets an escaping/control path reach a git argv (spy, N3/N4)", async () => {
    const { exec, calls } = spyGit({ "rev-parse HEAD": "headsha1\n" });
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["../outside.ts", "/etc/passwd", "src/a\nb.ts"],
      relatedSymbols: ["../../etc/passwd#foo"],
      now: NOW,
      execGit: exec,
    });
    expect(anchor).toBeUndefined();
    for (const call of calls) {
      for (const arg of call) {
        expect(arg).not.toContain("..");
        expect(arg).not.toContain("/etc/passwd");
        expect(arg).not.toContain("\n");
      }
    }
    // tightest pin: capture stops after the head lookup — no path spawns git
    expect(calls).toEqual([["rev-parse", "HEAD"]]);
  });

  it("skips a bare name colliding across relatedFiles (N2)", async () => {
    const shared = "export function shared(): void {}\n";
    writeFileSync(join(root, "src", "c1.ts"), shared);
    writeFileSync(join(root, "src", "c2.ts"), shared);
    const anchor = await captureCodeAnchor({
      rootPath: root,
      relatedFiles: ["src/c1.ts", "src/c2.ts"],
      relatedSymbols: ["shared"],
      now: NOW,
      execGit: fakeGit({
        "rev-parse HEAD": "headsha1\n",
        "rev-parse HEAD:src/c1.ts": "blobc1\n",
        "rev-parse HEAD:src/c2.ts": "blobc2\n",
      }),
    });
    expect(anchor?.symbols).toEqual([]);
    expect(anchor?.files).toHaveLength(2);
  });
});

describe("captureCodeAnchor (real git repo)", () => {
  let repo: string;

  function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-anchor-repo-"));
    git(["init"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "a.ts"), TS_SOURCE);
    git(["add", "."], repo);
    git(["commit", "-m", "add a"], repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("captures real head + blob shas plus a symbol hash (default execGit)", async () => {
    const anchor = await captureCodeAnchor({
      rootPath: repo,
      relatedFiles: ["a.ts"],
      relatedSymbols: ["a.ts#alpha"],
      now: NOW,
    });
    expect(anchor?.repoHead).toBe(git(["rev-parse", "HEAD"], repo).trim());
    expect(anchor?.capturedAt).toBe(NOW);
    expect(anchor?.files).toEqual([
      { path: "a.ts", blobSha: git(["rev-parse", "HEAD:a.ts"], repo).trim() },
    ]);
    expect(anchor?.symbols[0]?.name).toBe("alpha");
    expect((anchor?.symbols[0]?.contentHash.length ?? 0) > 0).toBe(true);
  });

  it("returns undefined in a non-git directory (default execGit)", async () => {
    const plain = mkdtempSync(join(tmpdir(), "megasaver-anchor-plain-"));
    writeFileSync(join(plain, "a.ts"), TS_SOURCE);
    try {
      const anchor = await captureCodeAnchor({
        rootPath: plain,
        relatedFiles: ["a.ts"],
        now: NOW,
      });
      expect(anchor).toBeUndefined();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
