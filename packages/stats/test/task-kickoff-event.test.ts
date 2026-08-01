import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTaskKickoffEvent,
  readTaskKickoffEvents,
  retractTaskKickoffEvent,
  taskKickoffEventPath,
  taskKickoffEventSchema,
} from "../src/index.js";

const WORKSPACE_KEY = "1a2b3c4d5e6f7a8b";
let root: string;

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/megasaver-task-kickoff-`);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceKey: WORKSPACE_KEY,
    sessionId: "session-1",
    createdAt: "2026-08-01T10:00:00.000Z",
    tokenCount: 321,
    ...overrides,
  };
}

describe("TaskKickoffEvent", () => {
  it("parses a valid event", () => {
    expect(taskKickoffEventSchema.parse(event())).toEqual(event());
  });

  it("rejects a negative token count", () => {
    expect(taskKickoffEventSchema.safeParse(event({ tokenCount: -1 })).success).toBe(false);
  });

  it("rejects an unknown field", () => {
    expect(taskKickoffEventSchema.safeParse(event({ extra: true })).success).toBe(false);
  });

  it("reads appended events in append order", () => {
    appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()));
    appendTaskKickoffEvent(
      { root },
      taskKickoffEventSchema.parse(
        event({
          id: "22222222-2222-4222-8222-222222222222",
          sessionId: "session-2",
        }),
      ),
    );

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY).map((row) => row.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("hides only a retracted kickoff cost event", () => {
    const first = taskKickoffEventSchema.parse(event());
    const second = taskKickoffEventSchema.parse(
      event({ id: "22222222-2222-4222-8222-222222222222", sessionId: "session-2" }),
    );
    appendTaskKickoffEvent({ root }, first);
    appendTaskKickoffEvent({ root }, second);

    retractTaskKickoffEvent({ root }, first);

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([second]);
  });

  it("skips a corrupt JSONL line", () => {
    appendTaskKickoffEvent({ root }, taskKickoffEventSchema.parse(event()));
    const path = taskKickoffEventPath(root, WORKSPACE_KEY);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{corrupt\n");

    expect(readTaskKickoffEvents({ root }, WORKSPACE_KEY)).toEqual([
      taskKickoffEventSchema.parse(event()),
    ]);
  });
});
