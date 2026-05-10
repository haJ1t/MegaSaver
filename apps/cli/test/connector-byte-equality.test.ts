import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertBlock } from "@megasaver/connectors-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConnectorContext } from "../src/commands/connector/shared.js";
import { runConnectorSync } from "../src/commands/connector/sync.js";
import { KNOWN_TARGETS } from "../src/known-targets.js";

// S6 — Byte-equality regression fixture.
//
// `mega connector sync`'s `noop` status word fires when
// `upsertBlock(existing, ctx) === existing` — the predicate that
// the freshly-rendered block is byte-identical to what is already
// on disk. If render/upsert ever drifts toward non-determinism
// (timestamps, ordering, padding, …), `noop` silently regresses
// to `wrote` and downstream tooling that relies on the byte-stable
// predicate breaks. This fixture pins the predicate per target.

const PROJECT_ID = "10000000-0000-4000-8000-000000000000";
const SESSION_ID = "20000000-0000-4000-8000-000000000000";
const TS = "2026-05-09T00:00:00.000Z";

describe("upsertBlock — byte-equality regression fixture (S6)", () => {
  let store: string;
  let projectRoot: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-cli-byteq-store-"));
    projectRoot = await mkdtemp(join(tmpdir(), "megasaver-cli-byteq-root-"));
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function seedStore(agentId: string): Promise<void> {
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
          agentId,
          riskLevel: "medium",
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ]),
    );
  }

  for (const target of KNOWN_TARGETS) {
    it(`${target.id}: re-applying upsertBlock to a freshly-synced file is byte-identical`, async () => {
      await seedStore(target.agentId);
      const code = await runConnectorSync({
        projectName: "demo",
        targetFlag: target.id,
        storeFlag: store,
        cwd: projectRoot,
        home: "/tmp",
        xdgDataHome: undefined,
        stdout: () => {},
        stderr: () => {},
      });
      expect(code).toBe(0);

      const absPath = join(projectRoot, target.relativePath);
      const written = await readFile(absPath, "utf8");
      const project = {
        id: PROJECT_ID,
        name: "demo",
        rootPath: projectRoot,
        createdAt: TS,
        updatedAt: TS,
      };
      const sessions = [
        {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId: target.agentId,
          riskLevel: "medium" as const,
          title: null,
          startedAt: TS,
          endedAt: null,
        },
      ];
      const context = buildConnectorContext(target, project, sessions, []);
      const upserted = upsertBlock({ existingContent: written, context });

      // Byte-identical re-application is the contract that drives
      // `noop`; assert content equality, then pin the same-instance
      // shortcut upsertBlock takes when the content is unchanged.
      expect(upserted).toBe(written);
    });
  }
});
