import { describe, expect, it } from "vitest";
import {
  MAX_OUTPUT_ROUTE_COMMAND_BYTES,
  classifyOutputRouteCommand,
} from "../../src/hooks/output-route-command.js";

describe("classifyOutputRouteCommand — accepted grammar", () => {
  it.each([
    ["grep -r -e TODO -- src", "grep"],
    ["grep -R -n -i -e error -- src lib", "grep"],
    ["grep -r -H -F -w -x -e fixed -- src", "grep"],
    ["grep -r -e TODO -- .", "grep"],
    ["grep -r -e TODO -- src", "grep"],
    ["grep -r -e TODO -- src/components/Button.tsx", "grep"],
    ["find src", "find"],
    ["find src -type f", "find"],
    ["find src -type d -print", "find"],
    ["find src -type l", "find"],
    ["find .", "find"],
  ] as const)("accepts %s", (command, family) => {
    expect(classifyOutputRouteCommand(command)).toBe(family);
  });

  it("accepts an over-long pattern within the byte budget", () => {
    expect(classifyOutputRouteCommand(`grep -r -e ${"a".repeat(100)} -- src`)).toBe("grep");
  });
});

describe("classifyOutputRouteCommand — rejects", () => {
  it.each([
    // unsupported programs / forms
    "rg TODO src",
    "git log --oneline",
    "grep -e TODO src",
    "grep -r TODO src",
    "grep -r --include=*.ts -e TODO -- src",
    "grep -ri -e TODO -- src",
    "grep -r -in -e TODO -- src",
    "grep -r -l -e TODO -- src",
    "grep -r -e TODO -e FIXME -- src",
    "/usr/bin/grep -r -e TODO -- src",
    "find src -name '*.ts'",
    "find src -type f -delete",
    "find src -exec rm {} ;",
    "find src -maxdepth 2",
    "find src -print -type f",
    "find src -type f -print -print",
    "find src -type x",
    // shell syntax
    "grep -r -e TODO -- src | head",
    "grep -r -e TODO -- src > out",
    "grep -r -e TODO -- src 2>/dev/null",
    "FOO=1 grep -r -e TODO -- src",
    "grep -r -e `whoami` -- src",
    "grep -r -e $(id) -- src",
    "grep -r -e 'TODO' -- src",
    'grep -r -e "TODO" -- src',
    "grep -r -e T\\ O -- src",
    "grep -r -e TODO -- src *.ts",
    "grep -r -e TODO -- ~/src",
    "grep -r -e TODO -- src{a,b}",
    "grep -r -e TODO -- src; rm -rf .",
    "grep -r -e TODO -- src && echo done",
    "grep -r -e TODO # comment -- src",
    // path escapes
    "grep -r -e TODO -- ..",
    "grep -r -e TODO -- src/../lib",
    "grep -r -e TODO -- /etc",
    "find ..",
    "find src/../lib",
    "find /tmp",
    // empty / whitespace
    "",
    "   ",
    "grep",
    "find",
    "grep -r",
    "grep -r -e -- src",
  ])("rejects %s", (command) => {
    expect(classifyOutputRouteCommand(command)).toBeNull();
  });

  it("rejects input past the byte budget", () => {
    expect(
      classifyOutputRouteCommand(`grep -r -e ${"a".repeat(MAX_OUTPUT_ROUTE_COMMAND_BYTES)} -- src`),
    ).toBeNull();
  });

  it("rejects more than 64 tokens", () => {
    const tokens = ["find", "src", ...Array.from({ length: 63 }, () => "-print")];
    expect(classifyOutputRouteCommand(tokens.join(" "))).toBeNull();
  });

  it("rejects tab and newline separators", () => {
    expect(classifyOutputRouteCommand("grep\t-r\t-e\tTODO\t--\tsrc")).toBeNull();
    expect(classifyOutputRouteCommand("grep -r -e TODO -- src\n")).toBeNull();
  });

  it("rejects control characters", () => {
    expect(classifyOutputRouteCommand("grep -r -e TODO -- src\r")).toBeNull();
  });
});
