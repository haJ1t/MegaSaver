import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbedFn, memoryEmbeddingsSidecarPath } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMemoryIndexBuild } from "../src/commands/memory/index-build.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ID_A = "22222222-2222-4222-8222-222222222222";
const ID_B = "33333333-3333-4333-8333-333333333333";
const TS = "2026-05-09T00:00:00.000Z";

function memEntry(id: string, content: string): string {
  return JSON.stringify({
    id,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: content,
    content,
    keywords: [],
    confidence: "medium",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: TS,
    updatedAt: TS,
  });
}

function countingEmbed(): { fn: EmbedFn; texts: string[] } {
  const texts: string[] = [];
  const fn: EmbedFn = async (input) => {
    texts.push(...input);
    return input.map((t) => Float32Array.from([t.charCodeAt(0) ?? 0, t.length]));
  };
  return { fn, texts };
}

let store: string;
let out: string[];
let err: string[];

function env(embedFn: EmbedFn) {
  return {
    projectName: "demo",
    storeFlag: store,
    cwd: store,
    home: store,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    jsonFlag: false,
    embedFn,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  };
}

async function seed(entries: string[]): Promise<void> {
  await mkdir(join(store, "memory"), { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: "/tmp", createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(join(store, "sessions.json"), "[]");
  await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), `${entries.join("\n")}\n`);
}

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "mega-cli-mem-index-"));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(store, { recursive: true, force: true });
});

describe("runMemoryIndexBuild", () => {
  it("builds the sidecar and prints the summary (model-free)", async () => {
    await seed([memEntry(ID_A, "alpha decision"), memEntry(ID_B, "bravo decision")]);
    const r = countingEmbed();
    const code = await runMemoryIndexBuild(env(r.fn));
    expect(code).toBe(0);
    expect(r.texts.length).toBe(2);
    expect(out.join("\n")).toContain("embedded=2");
    expect(out.join("\n")).toContain("carried=0");
    expect(out.join("\n")).toContain("total=2");
    expect(await fileExists(memoryEmbeddingsSidecarPath(store, PROJECT_ID as ProjectId))).toBe(
      true,
    );
  });

  it("re-embeds only the changed memory on rebuild", async () => {
    await seed([memEntry(ID_A, "alpha decision"), memEntry(ID_B, "bravo decision")]);
    await runMemoryIndexBuild(env(countingEmbed().fn));

    // Change B's content on disk, rebuild.
    await writeFile(
      join(store, "memory", `${PROJECT_ID}.jsonl`),
      `${memEntry(ID_A, "alpha decision")}\n${memEntry(ID_B, "bravo decision CHANGED")}\n`,
    );
    const r2 = countingEmbed();
    const code = await runMemoryIndexBuild(env(r2.fn));
    expect(code).toBe(0);
    expect(r2.texts.length).toBe(1);
    expect(r2.texts[0]).toContain("CHANGED");
    expect(out.join("\n")).toContain("embedded=1");
    expect(out.join("\n")).toContain("carried=1");
  });

  it("returns exit 1 for an unknown project", async () => {
    await seed([memEntry(ID_A, "alpha decision")]);
    const code = await runMemoryIndexBuild({ ...env(countingEmbed().fn), projectName: "nope" });
    expect(code).toBe(1);
    expect(err.join("\n").length).toBeGreaterThan(0);
  });
});
