import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Path to the built CLI binary — must be built before running.
const CLI = resolve(import.meta.dirname, "../../dist/cli.js");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-05-09T00:00:00.000Z";

async function seedStore(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "projects.json"),
    JSON.stringify([
      { id: PROJECT_ID, name: "demo", rootPath: root, createdAt: TS, updatedAt: TS },
    ]),
  );
  await writeFile(
    join(root, "sessions.json"),
    JSON.stringify([
      {
        id: SESSION_ID,
        projectId: PROJECT_ID,
        agentId: "claude-code",
        riskLevel: "medium",
        title: null,
        startedAt: TS,
        endedAt: null,
      },
    ]),
  );
}

function runCli(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString(),
      });
    });
  });
}

describe("concurrent session update — race safety (V1)", () => {
  let store: string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "megasaver-concurrency-"));
    await seedStore(store);
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
  });

  it("two simultaneous updates serialize without corrupting sessions.json", async () => {
    // Launch two processes simultaneously; one sets title A, the other title B.
    const [resultA, resultB] = await Promise.all([
      runCli(["session", "update", SESSION_ID, "--title", "title-A", "--store", store]),
      runCli(["session", "update", SESSION_ID, "--title", "title-B", "--store", store]),
    ]);

    // Both must have exited cleanly (code 0) or with a known serialization error.
    // The file lock ensures one wins; we allow the other to exit 0 (it also succeeds
    // since the lock serializes, not rejects the second writer) or 1 if it races.
    // What is NOT acceptable: a non-zero exit with an unexpected error, or a corrupt file.
    for (const result of [resultA, resultB]) {
      if (result.code !== 0) {
        // Only a concurrent_modification or lock-timeout error is acceptable.
        expect(result.stderr).toMatch(
          /error: (store I\/O failed|session .* not found|concurrent_modification)/,
        );
      }
    }

    // Parse the sessions file — must be valid JSON with exactly one session record.
    const raw = await readFile(join(store, "sessions.json"), "utf8");
    const sessions = JSON.parse(raw) as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    // The title must be exactly one of the two submitted values (not a merge / partial write).
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(["title-A", "title-B"]).toContain(session?.["title"]);
    // All required fields must still be present and coherent.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(session?.["id"]).toBe(SESSION_ID);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(session?.["agentId"]).toBe("claude-code");
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    expect(session?.["endedAt"]).toBeNull();
  }, 30_000);
});
