import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FilterOutputResult } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WORKSPACE_KEY = "0123456789abcdef";
const LIVE_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-28T09:00:00.000Z";
const CHUNK_SET_ID = "recovery-set";

// The line the fit step is expected to DROP. Plain ASCII, no ANSI, no trailing
// whitespace and no secret-shaped substring, so neither normalization nor
// redaction can rewrite it between the file and the stored chunk — the test
// compares against the literal it wrote rather than re-deriving it through the
// production chunker it is policing.
const BURIED_LINE = "inventory reconciliation ticket QZX4417 settled against ledger row 512";
// Recovery has to reach the far end of the file too, not just far enough to
// clear the needle — a sink that stored a truncated prefix would otherwise pass.
const LAST_LINE = "worker heartbeat step 899 nominal";

// Large enough that the fit step cannot return the whole file, with the needle
// far from the ranked-interesting lines at the top.
function buildLargeFile(): string {
  const lines: string[] = [];
  lines.push("error: boom while starting the worker pool");
  lines.push("error: retry budget exhausted for queue drain");
  for (let i = 0; i < 900; i += 1) {
    lines.push(i === 500 ? BURIED_LINE : `worker heartbeat step ${i} nominal`);
  }
  return `${lines.join("\n")}\n`;
}

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 800, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

function deliveredTextOf(result: FilterOutputResult): string {
  return [result.summary, ...result.excerpts.map((e) => e.text)].join("\n");
}

// Walk the recovery surface exactly as an agent does: the footer advertises
// i = 0..N-1, so fetch upward until the store says the id does not exist.
async function recoverAllChunks(storeRoot: string, chunkSetId: string): Promise<string[]> {
  const texts: string[] = [];
  for (let i = 0; i < 200; i += 1) {
    const fetched = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!fetched.ok) break;
    texts.push(fetched.chunk.text);
  }
  return texts;
}

describe("runOutputPipeline — what the production read path makes recoverable", () => {
  let store: string;
  let projectRoot: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-recovery-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-recovery-root-"));
    logPath = join(projectRoot, "worker.log");
    await writeFile(logPath, buildLargeFile());
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("stores a line the delivered excerpts dropped, fetchable through fetchChunk", async () => {
    const outcome = await runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: logPath,
      intent: "why did the worker pool fail",
      now: () => NOW,
      newId: () => CHUNK_SET_ID,
      loadPermissions: () => null,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { result } = outcome;

    // Guards against a vacuous pass: recovery only proves anything if the fit
    // step actually dropped the line, and only the raw-derived branch of the
    // sink is under test (outline persists its own bodies instead).
    expect(result.chunks).toBeUndefined();
    expect(deliveredTextOf(result)).not.toContain(BURIED_LINE);
    expect(result.chunkSetId).toBe(CHUNK_SET_ID);

    const recovered = await recoverAllChunks(store, CHUNK_SET_ID);
    expect(recovered.join("\n")).toContain(BURIED_LINE);
    expect(recovered.join("\n")).toContain(LAST_LINE);
    expect(recovered.length).toBeGreaterThan(1);
  });
});

describe("runOverlayOutputPipeline — what the production overlay read path makes recoverable", () => {
  let store: string;
  let cwd: string;
  let logPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-recovery-ov-store-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-recovery-ov-cwd-"));
    logPath = join(cwd, "worker.log");
    await writeFile(logPath, buildLargeFile());
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("stores a line the delivered excerpts dropped, fetchable through fetchChunk", async () => {
    const outcome = await runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WORKSPACE_KEY,
      liveSessionId: LIVE_SESSION_ID,
      cwd,
      path: logPath,
      intent: "why did the worker pool fail",
      mode: "balanced",
      maxReturnedBytes: 800,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => CHUNK_SET_ID,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { result } = outcome;

    expect(deliveredTextOf(result)).not.toContain(BURIED_LINE);
    expect(result.chunkSetId).toBe(CHUNK_SET_ID);

    const recovered = await recoverAllChunks(store, CHUNK_SET_ID);
    expect(recovered.join("\n")).toContain(BURIED_LINE);
    expect(recovered.join("\n")).toContain(LAST_LINE);
    expect(recovered.length).toBeGreaterThan(1);
  });
});
