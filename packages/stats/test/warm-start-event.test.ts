import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendWarmStartEvent,
  readWarmStartEvents,
  warmStartEventSchema,
} from "../src/warm-start-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-wsevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(over: Partial<Record<string, unknown>> = {}) {
  return warmStartEventSchema.parse({
    id: "e1",
    projectId: PROJECT_ID,
    createdAt: "2026-07-12T10:00:00.000Z",
    mode: "standard",
    briefTokens: 812,
    estimated: true,
    ...over,
  });
}

describe("WarmStartEvent", () => {
  it("is its own schema — TokenSaverEvent byte fields are rejected", () => {
    expect(warmStartEventSchema.safeParse({ ...event(), rawBytes: 1 } as unknown).success).toBe(
      false,
    );
  });

  it("appends and reads back per project", () => {
    appendWarmStartEvent({ root }, event({ id: "e1" }));
    appendWarmStartEvent({ root }, event({ id: "e2", mode: "micro" }));
    const events = readWarmStartEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendWarmStartEvent({ root }, event({ id: "e1" }));
    const path = join(root, "stats", PROJECT_ID, "warm-start.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readWarmStartEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("returns [] when nothing recorded", () => {
    expect(readWarmStartEvents({ root }, PROJECT_ID)).toEqual([]);
  });
});
