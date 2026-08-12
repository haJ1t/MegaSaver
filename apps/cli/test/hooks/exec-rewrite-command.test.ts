import { describe, expect, it } from "vitest";
import {
  MAX_EXEC_REWRITE_COMMAND_BYTES,
  classifyExecRewrite,
} from "../../src/hooks/exec-rewrite-command.js";

describe("classifyExecRewrite — accepted grammar", () => {
  it.each([
    ["vitest run", "vitest", ["run"]],
    ["tsc --noEmit", "tsc", ["--noEmit"]],
    ["pytest -q tests", "pytest", ["-q", "tests"]],
    ["eslint src", "eslint", ["src"]],
    ["go test ./...", "go", ["test", "./..."]],
    ["cargo test", "cargo", ["test"]],
    ["cargo clippy", "cargo", ["clippy"]],
    ["git status", "git", ["status"]],
    ["git log --oneline -5", "git", ["log", "--oneline", "-5"]],
    ["git diff HEAD", "git", ["diff", "HEAD"]],
    ["ls -la src", "ls", ["-la", "src"]],
    ["grep -rn TODO src", "grep", ["-rn", "TODO", "src"]],
    ["grep -w exact src/a.ts", "grep", ["-w", "exact", "src/a.ts"]],
    ["rg TODO src", "rg", ["TODO", "src"]],
    ["find src -type f", "find", ["src", "-type", "f"]],
  ] as const)("accepts %s", (command, program, args) => {
    expect(classifyExecRewrite(command)).toEqual({ command: program, args: [...args] });
  });
});

describe("classifyExecRewrite — rejects (null-biased)", () => {
  it.each([
    // script runners (Open Q2 — not v1)
    "pnpm test",
    "npm run build",
    // watchers
    "vitest --watch",
    "vitest watch",
    "vitest -w",
    "tsc -w",
    "tsc --watch",
    // find mutators
    "find . -delete",
    "find . -type f -exec rm {} ;",
    "find . -execdir touch x ;",
    "find . -ok rm x ;",
    "find . -okdir rm x ;",
    // mega launchers anywhere (loop safety)
    "mega output chunk cs-1 0",
    "./node_modules/.bin/mega hooks guard",
    "node dist/mega.mjs output gc",
    // non-allowlisted programs / subcommands
    "sudo ls",
    "git push",
    "git rebase main",
    "cargo run",
    "go build ./...",
    "vim src/a.ts",
    "python repl.py",
    // shell syntax / env-prefix (unsafe tokens or unlisted program)
    "vitest run | tee out.log",
    'vitest "run"',
    "FOO=1 vitest run",
    "vitest run > out.txt",
    "vitest run && echo ok",
    "vitest\trun",
    " vitest run",
    "",
  ])("rejects %j", (command) => {
    expect(classifyExecRewrite(command)).toBeNull();
  });

  it("rejects above the byte cap", () => {
    const long = `grep ${"a".repeat(MAX_EXEC_REWRITE_COMMAND_BYTES)}`;
    expect(classifyExecRewrite(long)).toBeNull();
  });

  it("rejects above the 64-token cap", () => {
    const many = `ls ${Array.from({ length: 70 }, (_, i) => `f${i}`).join(" ")}`;
    expect(classifyExecRewrite(many)).toBeNull();
  });
});
