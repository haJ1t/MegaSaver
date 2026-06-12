import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryApprove } from "../src/commands/memory/approve.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-06-12T00:00:00.000Z";

describe("runMemoryApprove", () => {
  let store: string;
  const lines: string[] = [];
  const errLines: string[] = [];

  function makeInput(
    opts: Partial<Parameters<typeof runMemoryApprove>[0]> & {
      approval: "approved" | "rejected";
    },
  ): Parameters<typeof runMemoryApprove>[0] {
    return {
      memoryEntryId: MEMORY_ID,
      storeFlag: store,
      jsonFlag: opts.jsonFlag ?? false,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (line) => lines.push(line),
      stderr: (line) => errLines.push(line),
      now: () => TS,
      ...opts,
    };
  }

  async function seedStore(): Promise<void> {
    await mkdir(store, { recursive: true });
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(
      join(store, "projects.json"),
      JSON.stringify([
        { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
      ]),
    );
    await writeFile(join(store, "sessions.json"), "[]");
    const entry = JSON.stringify({
      id: MEMORY_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "Use TypeScript strict",
      content: "strict mode enabled",
      keywords: [],
      confidence: "high",
      source: "agent",
      stale: false,
      approval: "suggested",
      createdAt: TS,
      updatedAt: TS,
    });
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${entry}\n`);
  }

  async function readStoredEntry(): Promise<Record<string, unknown> | undefined> {
    const path = join(store, "memory", `${PROJECT_ID}.jsonl`);
    const raw = await readFile(path, "utf8").catch(() => "");
    const entries = raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    return entries[0];
  }

  async function readStoredApproval(): Promise<string | undefined> {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    return (await readStoredEntry())?.["approval"] as string | undefined;
  }

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-approve-"));
    lines.length = 0;
    errLines.length = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("sets suggested memory to approved", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "approved" }));
    expect(code).toBe(0);
    expect(await readStoredApproval()).toBe("approved");
    expect(lines[0]).toBe(MEMORY_ID);
  });

  it("is idempotent — re-approving returns 0 and does not churn updatedAt", async () => {
    await seedStore();
    const FIRST = "2026-06-12T01:00:00.000Z";
    await runMemoryApprove(makeInput({ approval: "approved", now: () => FIRST }));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect((await readStoredEntry())?.["updatedAt"]).toBe(FIRST);

    lines.length = 0;
    // No-op re-approve with a LATER clock must not advance updatedAt.
    const LATER = "2026-06-12T02:00:00.000Z";
    const code = await runMemoryApprove(makeInput({ approval: "approved", now: () => LATER }));
    expect(code).toBe(0);
    expect(await readStoredApproval()).toBe("approved");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect((await readStoredEntry())?.["updatedAt"]).toBe(FIRST);
  });

  it("sets suggested memory to rejected", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "rejected" }));
    expect(code).toBe(0);
    expect(await readStoredApproval()).toBe("rejected");
  });

  it("returns exit 1 with not-found message for missing id", async () => {
    await seedStore();
    const code = await runMemoryApprove(
      makeInput({
        approval: "approved",
        memoryEntryId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    expect(code).toBe(1);
    expect(errLines.some((l) => /memory entry "99999999.*" not found/.test(l))).toBe(true);
  });

  it("emits full JSON object when --json is set", async () => {
    await seedStore();
    const code = await runMemoryApprove(makeInput({ approval: "approved", jsonFlag: true }));
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? "{}") as { id: string; approval: string };
    expect(parsed.id).toBe(MEMORY_ID);
    expect(parsed.approval).toBe("approved");
  });
});
