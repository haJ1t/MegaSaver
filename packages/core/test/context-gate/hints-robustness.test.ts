import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionFailureId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonDirectoryCoreRegistry, runOutputPipeline } from "../../src/index.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-01T00:00:00.000Z";
const NOW = "2026-07-02T12:00:00.000Z";

async function seed(store: string, projectRoot: string): Promise<void> {
  await mkdir(store, { recursive: true });
  await writeFile(
    join(store, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: projectRoot, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(store, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: "demo session",
        startedAt: TS,
        endedAt: null,
        tokenSaver: {
          enabled: true,
          mode: "balanced",
          maxReturnedBytes: 12_000,
          storeRawOutput: true,
          redactSecrets: true,
          autoRepair: true,
          createdAt: TS,
          updatedAt: TS,
        },
      },
    ]),
  );
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

describe("hint building over a corrupt json-directory store (best-effort hints)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-hints-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-hints-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("a corrupt memory jsonl degrades to a warning; failure hints still rank", async () => {
    await seed(store, projectRoot);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    registry.createSessionFailure({
      id: "33333333-3333-4333-8333-333333333333" as SessionFailureId,
      projectId: PROJECT_ID as ProjectId,
      sessionId: SESSION_ID as SessionId,
      command: "pnpm tsc",
      errorOutput: "error TS2322: Type 'string' is not assignable at src/auth.ts:42",
      source: "proxy-classifier",
      createdAt: NOW,
    });
    await mkdir(join(store, "memory"), { recursive: true });
    await writeFile(join(store, "memory", `${PROJECT_ID}.jsonl`), "{ this is not json\n");
    const notesPath = join(projectRoot, "notes.log");
    await writeFile(notesPath, FILE_BODY);

    const outcome = await runOutputPipeline({
      registry,
      storeRoot: store,
      sessionId: SESSION_ID as SessionId,
      path: notesPath,
      intent: "auth token validation",
      now: () => NOW,
      newId: () => "cs-hints-robust",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.warnings?.some((w) => w.startsWith("session hints skipped:"))).toBe(true);
    // The failures source is intact — its hints still boost the auth chunk.
    const top = outcome.result.excerpts[0];
    expect(top?.text).toContain("src/auth.ts");
    expect(top?.engine?.failureHistoryBoost).toBeGreaterThan(0);
  });
});
