import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionDecisionTrace } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemoryEntryView, OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const MEMORY_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-04T12:00:00.000Z";
// FNV-1a of the cwd; the reader keys evidence by it, but the join under test is
// the inline path, so any valid workspace key works — evidence is absent.
const WK = "0".repeat(16);

// The memory's relatedFiles term. It must appear VERBATIM in the file content so
// the ranker's substring match attributes MEMORY_ID to a selected chunk, which
// buildRankingTrace unions into RankingTrace.rankedByMemoryIds inline on the
// trace — the causal join the reader now surfaces WITHOUT any evidence record.
const MEMORY_TERM = "src/auth-token.ts";

function makeFakeRegistry(projectRoot: string): OrchestratorRegistry {
  const memory: MemoryEntryView = {
    id: MEMORY_ID,
    approval: "approved",
    stale: false,
    relatedFiles: [MEMORY_TERM],
  };
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: (id) => (id === PROJECT_ID ? [memory] : []),
    listProjectRules: () => [],
  };
}

describe("decision-trace join is real end-to-end (Slice C)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-dtjoin-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-dtjoin-root-"));
  });
  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("surfaces the inline ranking-causal memory id with no evidence dir written", async () => {
    const notesPath = join(projectRoot, "notes.log");
    // The memory term appears verbatim so ranking attributes the memory id.
    await writeFile(notesPath, `investigating token handling in ${MEMORY_TERM}\n`);

    const outcome = await runOutputPipeline({
      registry: makeFakeRegistry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-join-real",
      loadPermissions: () => null,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const trace = readSessionDecisionTrace(
      { root: store },
      { projectId: PROJECT_ID, sessionId: SESSION_ID, workspaceKey: WK },
    );
    expect(trace.outputs).toHaveLength(1);
    const output = trace.outputs[0];
    // The join is REAL: the memory id surfaces from the inline trace, not evidence.
    expect(output?.memory?.rankedByMemoryIds).toContain(MEMORY_ID);
    expect(output?.evidencePresent).toBe(true);
    // …and it surfaced WITHOUT the fail-closed evidence store ever being written.
    expect(existsSync(join(store, "evidence"))).toBe(false);
  });
});
