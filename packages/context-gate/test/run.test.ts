import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { readSummary } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-06-10T12:00:00.000Z";
const NEW_ID = "fixed-id";

function registry(
  projectRoot: string,
  opts: { storeRawOutput?: boolean } = {},
): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: {
              mode: "balanced",
              maxReturnedBytes: 12_000,
              storeRawOutput: opts.storeRawOutput ?? true,
            },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
  };
}

describe("runOutputPipeline — stats event wiring", () => {
  let store: string;
  let projectRoot: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-run-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-run-root-"));
    logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, "line one\nerror: boom\nline three\n");
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(reg: OrchestratorRegistry) {
    return runOutputPipeline({
      registry: reg,
      storeRoot: store,
      sessionId: SESSION_ID,
      path: logPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => NEW_ID,
      loadPermissions: () => null,
    });
  }

  it("appends one event and updates the summary on success", async () => {
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
      "utf8",
    );
    const lines = eventsRaw.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] as string);
    expect(event.sourceKind).toBe("file");
    expect(event.label).toBe(logPath);
    expect(event.sessionId).toBe(SESSION_ID);
    expect(event.mode).toBe("balanced");
    expect(event.chunkSetId).toBe(NEW_ID);
    expect(event.rawBytes).toBeGreaterThan(0);

    const summary = readSummary({ root: store }, PROJECT_ID, SESSION_ID);
    expect(summary?.eventsTotal).toBe(1);
    expect(summary?.rawBytesTotal).toBe(event.rawBytes);
  });

  it("storeRawOutput=false still appends the event, without chunkSetId", async () => {
    const outcome = await run(registry(projectRoot, { storeRawOutput: false }));
    expect(outcome.ok).toBe(true);

    const eventsRaw = await readFile(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
      "utf8",
    );
    const event = JSON.parse(eventsRaw.trimEnd());
    expect(event.chunkSetId).toBeUndefined();
    expect(readSummary({ root: store }, PROJECT_ID, SESSION_ID)?.eventsTotal).toBe(1);
  });

  it("redacted secrets increment secretsRedactedTotal on the file path", async () => {
    await writeFile(logPath, "key=sk-ant-0123456789012345678901234567\nline two\n");
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(true);
    const summary = readSummary({ root: store }, PROJECT_ID, SESSION_ID);
    expect(summary?.secretsRedactedTotal).toBeGreaterThanOrEqual(1);
  });

  it("stats write failure → store_write_failed (not a throw)", async () => {
    // Plant a FILE at <store>/stats so appendEvent's mkdirSync(recursive) throws.
    await writeFile(join(store, "stats"), "not a directory");
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });

  it("chunkSet write failure → store_write_failed (not a throw)", async () => {
    // Plant a FILE at <store>/content so saveChunkSet's mkdir throws.
    await writeFile(join(store, "content"), "not a directory");
    const outcome = await run(registry(projectRoot));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("store_write_failed");
  });
});

describe("runOutputPipeline — diff-on-reread suppression (registry)", () => {
  let store: string;
  let projectRoot: string;
  let filePath: string;
  let idCounter: number;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-reread-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-reread-root-"));
    filePath = join(projectRoot, "f.txt");
    await writeFile(filePath, "line one\nerror: boom\nline three\n");
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(opts: { storeRawOutput?: boolean } = {}) {
    return runOutputPipeline({
      registry: registry(projectRoot, opts),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: filePath,
      intent: "find the error",
      now: () => NOW,
      newId: () => `cs-${idCounter++}`,
      loadPermissions: () => null,
    });
  }

  function sessionContentDir() {
    return join(store, "content", PROJECT_ID, SESSION_ID);
  }

  it("T6: first read is a miss — persists, records, no unchanged field", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect("unchanged" in r1.result).toBe(false);
    expect(r1.result.chunkSetId).toBeDefined();

    const names = await readdir(sessionContentDir());
    expect(names).toContain("read-index.json");
    expect(names.filter((n) => n.endsWith(".json") && n !== "read-index.json")).toHaveLength(1);
  });

  it("T7: second read of an unchanged file suppresses + skips filter/persist", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstChunkSetId = r1.result.chunkSetId;

    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.excerpts).toEqual([]);
    expect(r2.result.unchanged?.priorChunkSetId).toBe(firstChunkSetId);
    expect(r2.result.decision).toBe("unchanged-marker");
    expect(r2.result.summary).toContain("unchanged");

    // No second chunk-set persisted: still exactly one chunk-set on disk.
    const names = await readdir(sessionContentDir());
    expect(names.filter((n) => n.endsWith(".json") && n !== "read-index.json")).toHaveLength(1);
  });

  it("T8/T10: changed content is a miss with no unchanged field; index updated", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const firstChunkSetId = r1.result.chunkSetId;

    await writeFile(filePath, "DIFFERENT bytes now\n");
    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("unchanged" in r2.result).toBe(false);
    expect(r2.result.chunkSetId).toBeDefined();
    expect(r2.result.chunkSetId).not.toBe(firstChunkSetId);

    const names = await readdir(sessionContentDir());
    expect(names.filter((n) => n.endsWith(".json") && n !== "read-index.json")).toHaveLength(2);
  });

  it("T12: storeRawOutput=false writes no index; next read is a normal miss", async () => {
    const r1 = await run({ storeRawOutput: false });
    expect(r1.ok).toBe(true);
    await expect(readdir(sessionContentDir())).rejects.toMatchObject({ code: "ENOENT" });

    const r2 = await run({ storeRawOutput: false });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect("unchanged" in r2.result).toBe(false);
  });
});
