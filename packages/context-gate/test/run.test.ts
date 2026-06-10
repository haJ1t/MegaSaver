import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
