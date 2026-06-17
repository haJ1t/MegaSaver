import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryExplain } from "../src/commands/memory/explain.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TS = "2026-06-17T00:00:00.000Z";

describe("runMemoryExplain — validation sidecar", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  function makeInput(over: Partial<Parameters<typeof runMemoryExplain>[0]> = {}) {
    return {
      memoryEntryId: ENTRY_ID,
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform as NodeJS.Platform,
      localAppData: undefined,
      stdout: (line: string) => lines.push(line),
      stderr: (line: string) => errLines.push(line),
      ...over,
    };
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-explain-val-"));
    await mkdir(join(store, "memory"), { recursive: true });
    await mkdir(join(store, "memory-validations"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const entry = JSON.stringify({
      id: ENTRY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use strict ESM",
      content: "strict mode enabled",
      keywords: [],
      confidence: "high",
      source: "agent",
      approval: "approved",
      stale: false,
      createdAt: TS,
      updatedAt: TS,
    });
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${entry}\n`);
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("shows 'unvalidated' when no sidecar exists", async () => {
    const code = await runMemoryExplain(makeInput());
    expect(code).toBe(0);
    const allText = lines.join("\n");
    expect(allText).toMatch(/validationStatus.*unvalidated/);
  });

  it("shows sidecar fields when sidecar exists", async () => {
    const sidecar = {
      memoryEntryId: ENTRY_ID,
      validationStatus: "valid",
      reasons: [],
      conflictIds: [],
      validatedAt: TS,
      validatedBy: "system",
      policyVersion: "1",
    };
    await writeFile(
      join(store, "memory-validations", `${ENTRY_ID}.json`),
      `${JSON.stringify(sidecar, null, 2)}\n`,
    );
    const code = await runMemoryExplain(makeInput());
    expect(code).toBe(0);
    const allText = lines.join("\n");
    expect(allText).toMatch(/validationStatus.*valid/);
    expect(allText).toMatch(/validatedBy.*system/);
    expect(allText).toMatch(/policyVersion.*1/);
  });

  it("json flag includes validation field", async () => {
    const code = await runMemoryExplain(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const obj = JSON.parse(lines[0] as string) as { validation: unknown };
    expect(obj.validation).toBeDefined();
  });
});
