import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHooksUninstall } from "../../src/commands/hooks/uninstall.js";

function tmpSettings(initial: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "ms-cli-uninstall-")), "settings.json");
  writeFileSync(p, `${JSON.stringify(initial, null, 2)}\n`);
  return p;
}

describe("runHooksUninstall", () => {
  it("removes Mega Saver hooks and returns 0", () => {
    const p = tmpSettings({
      hooks: {
        PreToolUse: [
          {
            matcher: "Read|Bash|Grep|Glob|LS",
            hooks: [{ type: "command", command: "mega hooks log" }],
          },
        ],
        PostToolUse: [
          {
            matcher: "Read|Bash|Grep|Glob|LS",
            hooks: [{ type: "command", command: "mega hooks saver" }],
          },
        ],
      },
    });
    const out: string[] = [];
    const code = runHooksUninstall({
      target: "claude-code",
      settingsPath: p,
      stdout: (l) => out.push(l),
      stderr: () => {},
      json: false,
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({});
  });

  it("rejects an unknown target with exit 1", () => {
    const errs: string[] = [];
    const code = runHooksUninstall({
      target: "cursor",
      settingsPath: "/tmp/x.json",
      stdout: () => {},
      stderr: (l) => errs.push(l),
      json: false,
    });
    expect(code).toBe(1);
    expect(errs[0]).toContain("unknown hook target");
  });
});
