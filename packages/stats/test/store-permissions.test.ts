import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import { type StatsStore, appendEvent } from "../src/store.js";
import { describeUnlessWindows } from "./_platform.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

let root: string;
let store: StatsStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-stats-perm-"));
  store = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const projectDir = () => join(root, "stats", PROJECT_ID);
const eventFile = () => join(projectDir(), `${SESSION_ID}.events.jsonl`);
const summaryFile = () => join(projectDir(), `${SESSION_ID}.json`);

const event = () =>
  ({
    id: "evt-1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-07-25T12:00:00.000Z",
    sourceKind: "file",
    label: "read",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio: 0.8,
    summary: "s",
    mode: "balanced",
  }) as TokenSaverEvent;

const append = () => appendEvent({ store, event: event(), secretsRedacted: 0, chunksStored: 1 });

describeUnlessWindows("appendEvent permissions", () => {
  it("writes the event log and summary owner-only (0600)", () => {
    append();
    expect(statSync(eventFile()).mode & 0o777).toBe(0o600);
    expect(statSync(summaryFile()).mode & 0o777).toBe(0o600);
  });

  it("creates the project dir owner-only (0700)", () => {
    append();
    expect(statSync(projectDir()).mode & 0o777).toBe(0o700);
  });

  // appendFileSync's mode is ignored once the file exists, so an install
  // written before this fix keeps a world-readable log unless we chmod.
  it("repairs a world-readable log and dir left by an earlier build", () => {
    mkdirSync(projectDir(), { recursive: true });
    writeFileSync(eventFile(), "");
    chmodSync(projectDir(), 0o755);
    chmodSync(eventFile(), 0o644);
    append();
    expect(statSync(eventFile()).mode & 0o777).toBe(0o600);
    expect(statSync(projectDir()).mode & 0o777).toBe(0o700);
  });
});
