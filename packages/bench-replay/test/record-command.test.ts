import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIRST_PARTY_FLAG, TASK_PROMPTS, buildRecordCommand } from "../src/record-command.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

function command() {
  return buildRecordCommand({
    claudeBin: "/usr/local/bin/claude",
    prompt: "Add a date picker to the event creation form.",
    repoDir: "/tmp/bench-repo",
    proxyUrl: "http://127.0.0.1:51234",
    baseEnv: {
      PATH: "/usr/bin",
      ANTHROPIC_BASE_URL: "http://the-operators-own-proxy",
      EMPTY: undefined,
    },
  });
}

describe("buildRecordCommand", () => {
  it("passes an empty --setting-sources so ~/.claude settings (and `mega hooks`) cannot leak in", () => {
    const { args } = command();
    const i = args.indexOf("--setting-sources");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe("");
  });

  it("sets the first-party flag so the custom base URL does not distort prompt caching", () => {
    expect(command().env[FIRST_PARTY_FLAG]).toBe("1");
  });

  it("points ANTHROPIC_BASE_URL at the capture proxy, overriding any inherited value", () => {
    expect(command().env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:51234");
  });

  it("requests the json output format that becomes the same-conversation reference", () => {
    const { args } = command();
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
  });

  it("passes the prompt after -p", () => {
    const { args } = command();
    expect(args[args.indexOf("-p") + 1]).toBe("Add a date picker to the event creation form.");
  });

  it("drops undefined entries from the inherited environment", () => {
    expect(command().env).not.toHaveProperty("EMPTY");
    expect(command().env.PATH).toBe("/usr/bin");
  });
});

describe("recording inputs stay pinned to the historical benchmark", () => {
  it("uses exactly the 4 prompts from run-megasaver-claude-limit-test.sh", () => {
    const shell = readFileSync(
      join(REPO_ROOT, "scripts", "run-megasaver-claude-limit-test.sh"),
      "utf8",
    );
    const block = shell.match(/^TASKS=\(\n([\s\S]*?)^\)$/m);
    expect(block).not.toBeNull();
    const fromShell = [...(block?.[1] ?? "").matchAll(/^\s*"(.*)"\s*$/gm)].map((m) => m[1]);
    expect(fromShell).toHaveLength(4);
    expect([...TASK_PROMPTS]).toEqual(fromShell);
  });

  // A typo in this env var name is silent: Claude Code simply stays in
  // non-first-party mode and the recording freezes a 2.6x-inflated cache pattern.
  it("spells the first-party flag exactly as the claude-code connector does", () => {
    const source = readFileSync(
      join(REPO_ROOT, "packages", "connectors", "claude-code", "src", "proxy-route.ts"),
      "utf8",
    );
    const declared = source.match(/export const FIRST_PARTY_FLAG = "([^"]+)"/);
    expect(declared?.[1]).toBe(FIRST_PARTY_FLAG);
  });
});
