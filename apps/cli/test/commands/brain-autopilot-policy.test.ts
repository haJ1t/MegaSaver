import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAutopilotPolicy } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runAutopilotOff,
  runAutopilotOn,
  runAutopilotStatus,
} from "../../src/commands/brain/autopilot.js";
import { brainCommand } from "../../src/commands/brain/index.js";
import { ensureStoreReady } from "../../src/store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const MEM_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const MEM_C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const TS = "2026-07-01T00:00:00.000Z";

let store: string;
let out: string[];
let err: string[];

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "megasaver-autopilot-policy-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

async function seedStore(withMemories = false): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  if (withMemories) {
    const base = {
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      keywords: [],
      confidence: "medium",
      source: "manual",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    };
    const rows = [
      { ...base, id: MEM_A, title: "a", content: "a", approval: "suggested" },
      { ...base, id: MEM_B, title: "b", content: "b", approval: "suggested" },
      { ...base, id: MEM_C, title: "c", content: "c", approval: "approved" },
    ];
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    );
  }
}

function statusInput() {
  return {
    storeRoot: store,
    ensureStore: () => ensureStoreReady(store),
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

function onInput(typesFlag: string | undefined, maxFlag: string | undefined) {
  return {
    storeRoot: store,
    typesFlag,
    maxFlag,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe("mega brain autopilot status/on/off", () => {
  it("status on a fresh store shows the fail-closed defaults", async () => {
    await seedStore();
    const code = await runAutopilotStatus(statusInput());
    expect(code).toBe(0);
    expect(out).toContain("enabled: no");
    expect(out).toContain("auto-approve types: bug, test_behavior");
    expect(out).toContain("min confidence: high");
    expect(out).toContain("max per session: 10");
    expect(out).toContain("pending suggested (all projects): 0");
    expect(out).toContain("last digest (any project): never");
  });

  it("on writes the policy; off flips enabled back, preserving fields", async () => {
    await seedStore();
    expect(runAutopilotOn(onInput("bug,decision", "5"))).toBe(0);
    let policy = readAutopilotPolicy(store);
    expect(policy.enabled).toBe(true);
    expect(policy.autoApproveTypes).toEqual(["bug", "decision"]);
    expect(policy.maxAutoApprovesPerSession).toBe(5);
    expect(out.join("\n")).toContain("autopilot on");

    expect(
      runAutopilotOff({
        storeRoot: store,
        stdout: (line: string) => out.push(line),
        stderr: (line: string) => err.push(line),
      }),
    ).toBe(0);
    policy = readAutopilotPolicy(store);
    expect(policy.enabled).toBe(false);
    expect(policy.autoApproveTypes).toEqual(["bug", "decision"]);
    expect(policy.maxAutoApprovesPerSession).toBe(5);
  });

  it("rejects an unknown --auto-approve-types entry with the valid list", async () => {
    await seedStore();
    const code = runAutopilotOn(onInput("bug,nonsense", undefined));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid memory type "nonsense"');
    expect(err.join("\n")).toContain("decision");
    expect(err.join("\n")).toContain("test_behavior");
    // Zero writes on the reject path: the policy file is never created.
    expect(existsSync(join(store, "autopilot.json"))).toBe(false);
    expect(readAutopilotPolicy(store).enabled).toBe(false);
  });

  it("rejects a non-positive --max-per-session", async () => {
    await seedStore();
    expect(runAutopilotOn(onInput(undefined, "0"))).toBe(1);
    expect(err.join("\n")).toContain("--max-per-session");
    expect(readAutopilotPolicy(store).enabled).toBe(false);
  });

  it("status counts suggested rows project-agnostically", async () => {
    await seedStore(true);
    const code = await runAutopilotStatus(statusInput());
    expect(code).toBe(0);
    expect(out).toContain("pending suggested (all projects): 2");
  });

  it("brain command registers the autopilot subcommand", () => {
    expect(Object.keys(brainCommand.subCommands ?? {})).toContain("autopilot");
  });
});
