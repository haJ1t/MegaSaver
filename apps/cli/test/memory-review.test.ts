import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryReview } from "../src/commands/memory/review.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-17T00:00:00.000Z";

const SUGGESTED_ID = "22222222-2222-4222-8222-222222222222";
const QUARANTINED_ID = "33333333-3333-4333-8333-333333333333";
const REJECTED_ID = "44444444-4444-4444-8444-444444444444";
const APPROVED_ID = "55555555-5555-4555-8555-555555555555";

function makeEntry(id: string, approval: string) {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `Entry ${approval}`,
    content: `content ${approval}`,
    keywords: [],
    confidence: "medium",
    source: "agent",
    approval,
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

describe("runMemoryReview", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  function makeInput(over: Partial<Parameters<typeof runMemoryReview>[0]> = {}) {
    return {
      projectName: "demo",
      storeFlag: store,
      jsonFlag: false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
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
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-review-"));
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const content = [
      makeEntry(SUGGESTED_ID, "suggested"),
      makeEntry(QUARANTINED_ID, "suggested"), // quarantined stays "suggested" approval-wise
      makeEntry(REJECTED_ID, "rejected"),
      makeEntry(APPROVED_ID, "approved"),
    ].join("\n");
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${content}\n`);
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("lists suggested and rejected rows, excludes approved", async () => {
    const code = await runMemoryReview(makeInput());
    expect(code).toBe(0);
    const ids = lines.map((l) => l.slice(0, 36));
    expect(ids).toContain(SUGGESTED_ID);
    expect(ids).toContain(QUARANTINED_ID);
    expect(ids).toContain(REJECTED_ID);
    expect(ids).not.toContain(APPROVED_ID);
  });

  it("json flag emits array of unapproved entries only", async () => {
    const code = await runMemoryReview(makeInput({ jsonFlag: true }));
    expect(code).toBe(0);
    const arr = JSON.parse(lines[0] as string) as Array<{ id: string; approval: string }>;
    expect(arr.every((e) => e.approval !== "approved")).toBe(true);
    expect(arr.map((e) => e.id)).not.toContain(APPROVED_ID);
  });

  it("returns 1 for unknown project", async () => {
    const code = await runMemoryReview(makeInput({ projectName: "no-such" }));
    expect(code).toBe(1);
    expect(errLines[0]).toMatch(/not found/);
  });
});
