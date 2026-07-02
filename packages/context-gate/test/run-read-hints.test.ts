import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionFailureId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestratorRegistry, SessionFailureRecord } from "../src/registry-port.js";
import { runOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const NOW = "2026-07-02T12:00:00.000Z";

function failure(errorOutput: string): SessionFailureRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333" as SessionFailureId,
    projectId: PROJECT_ID,
    sessionId: SESSION_ID,
    command: "pnpm tsc",
    errorOutput,
    source: "proxy-classifier",
    createdAt: NOW,
  };
}

function registry(projectRoot: string, failures: SessionFailureRecord[]): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? { projectId: PROJECT_ID, tokenSaver: { mode: "balanced", storeRawOutput: true } }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => failures,
  };
}

// 40 prose lines (one generic chunk) with no dots, error words, or intent
// keywords, followed by the line that references the failed file — it lands
// in the second chunk, so the two rank independently.
const NOISE_LINES = Array.from(
  { length: 40 },
  (_, i) => `plain release chatter line ${i + 1} about roadmap and planning`,
);
const FILE_BODY = `${[
  ...NOISE_LINES,
  "token validation logic lives in src/auth.ts near the session refresh",
].join("\n")}\n`;

describe("runOutputPipeline — failure-aware ranking (registry reads)", () => {
  let store: string;
  let projectRoot: string;
  let notesPath: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-read-hints-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-read-hints-root-"));
    notesPath = join(projectRoot, "notes.log");
    await writeFile(notesPath, FILE_BODY);
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run(failures: SessionFailureRecord[]) {
    return runOutputPipeline({
      registry: registry(projectRoot, failures),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-hints",
      loadPermissions: () => null,
    });
  }

  it("a prior failure signature boosts the chunk that references it above noise", async () => {
    const outcome = await run([
      failure("error TS2322: Type 'string' is not assignable at src/auth.ts:42"),
    ]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const top = outcome.result.excerpts[0];
    expect(top?.text).toContain("src/auth.ts");
    expect(top?.engine).toBeDefined();
    expect(top?.engine?.failureHistoryBoost).toBeGreaterThan(0);
  });

  it("no recorded failures → engine ranking still on, boost stays zero", async () => {
    const outcome = await run([]);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const top = outcome.result.excerpts[0];
    expect(top?.engine).toBeDefined();
    expect(top?.engine?.failureHistoryBoost).toBe(0);
  });
});
