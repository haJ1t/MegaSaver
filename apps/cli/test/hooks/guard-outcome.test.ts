import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_GUARD_STATE,
  readGuardEvents,
  readGuardState,
  writeGuardState,
} from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybeRecordGuardOutcome } from "../../src/hooks/guard-outcome.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:05:00.000Z";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const INTERCEPT_ID = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardoutcome-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedWithIntercept(signatures: string[]) {
  const { registry } = await ensureStoreReady(root);
  // Idempotent: the auto-mute test re-seeds to restore the intercept entry,
  // and createProject rejects a duplicate id.
  if (registry.listProjects().length === 0) {
    registry.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/work/demo",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
  writeGuardState(root, PROJECT_ID, {
    ...DEFAULT_GUARD_STATE,
    sessions: {
      s1: {
        firedIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        intercepts: {
          [INTERCEPT_ID]: {
            command: "pnpm vitest --shard 2",
            signatures,
            candidateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        },
      },
    },
  });
}

function payload(command: string, stdout: string, stderr = "") {
  return {
    session_id: "s1",
    cwd: "/work/demo",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr, interrupted: false, isImage: false },
  };
}

describe("maybeRecordGuardOutcome", () => {
  it("records overridden-failed when the re-run output contains an original signature", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(
      payload("pnpm vitest --shard 2", "boom at src/run.ts again"),
      root,
      () => NOW,
    );
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({
      type: "outcome",
      outcome: "overridden-failed",
      interceptId: INTERCEPT_ID,
    });
  });

  it("records overridden-ok and counts a strike when no original signature recurs", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(
      payload("pnpm vitest --shard 2", "42 tests passed"),
      root,
      () => NOW,
    );
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({ type: "outcome", outcome: "overridden-ok" });
    expect(
      readGuardState(root, PROJECT_ID)?.autoMuted["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ).toBe(1);
  });

  it("records plain overridden when the original had zero signatures (no strike)", async () => {
    await seedWithIntercept([]);
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "anything"), root, () => NOW);
    const events = readGuardEvents({ root }, PROJECT_ID as never);
    expect(events[0]).toMatchObject({ type: "outcome", outcome: "overridden" });
    expect(readGuardState(root, PROJECT_ID)?.autoMuted).toEqual({});
  });

  it("auto-mutes after 3 overridden-ok strikes", async () => {
    await seedWithIntercept(["src/run.ts"]);
    const state = readGuardState(root, PROJECT_ID);
    writeGuardState(root, PROJECT_ID, {
      ...(state ?? DEFAULT_GUARD_STATE),
      autoMuted: { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": 2 },
    } as never);
    await seedWithIntercept(["src/run.ts"]); // restore the intercept entry
    const s2 = readGuardState(root, PROJECT_ID);
    writeGuardState(root, PROJECT_ID, {
      ...(s2 ?? DEFAULT_GUARD_STATE),
      autoMuted: { "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": 2 },
    } as never);
    await maybeRecordGuardOutcome(
      payload("pnpm vitest --shard 2", "42 tests passed"),
      root,
      () => NOW,
    );
    expect(readGuardState(root, PROJECT_ID)?.mutedIds).toContain(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  it("removes the intercept entry after recording (one outcome per intercept)", async () => {
    await seedWithIntercept(["src/run.ts"]);
    await maybeRecordGuardOutcome(
      payload("pnpm vitest --shard 2", "boom src/run.ts"),
      root,
      () => NOW,
    );
    await maybeRecordGuardOutcome(
      payload("pnpm vitest --shard 2", "boom src/run.ts"),
      root,
      () => NOW,
    );
    expect(readGuardEvents({ root }, PROJECT_ID as never).length).toBe(1);
  });

  it("zero-cost skip: never touches the registry when no guard dir exists, and never throws", async () => {
    await expect(
      maybeRecordGuardOutcome(payload("ls", "ok"), root, () => NOW),
    ).resolves.toBeUndefined();
    await expect(maybeRecordGuardOutcome({ garbage: 1 }, root, () => NOW)).resolves.toBeUndefined();
  });

  it("works on small outputs (below the saver compress floor) — insertion above decide()", async () => {
    await seedWithIntercept(["src/run.ts"]);
    // 10-byte output would PASSTHROUGH in decide(); the outcome step still runs.
    await maybeRecordGuardOutcome(payload("pnpm vitest --shard 2", "tiny"), root, () => NOW);
    expect(readGuardEvents({ root }, PROJECT_ID as never).length).toBe(1);
  });
});
