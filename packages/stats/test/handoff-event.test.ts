import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendHandoffEvent, handoffEventSchema, readHandoffEvents } from "../src/handoff-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-handoffevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function event(over: Partial<Record<string, unknown>> = {}) {
  return handoffEventSchema.parse({
    id: "e1",
    projectId: PROJECT_ID,
    kind: "pack",
    targetAgent: "codex",
    memories: 12,
    failures: 3,
    redactionFindings: 0,
    createdAt: "2026-07-18T10:00:00.000Z",
    ...over,
  });
}

describe("HandoffEvent", () => {
  it("is strict — unknown fields are rejected", () => {
    expect(handoffEventSchema.safeParse({ ...event(), rawBytes: 1 } as unknown).success).toBe(
      false,
    );
  });

  it("rejects an unknown kind", () => {
    expect(handoffEventSchema.safeParse({ ...event(), kind: "inspect" } as unknown).success).toBe(
      false,
    );
  });

  it("appends and reads back per project", () => {
    appendHandoffEvent({ root }, event({ id: "e1" }));
    appendHandoffEvent({ root }, event({ id: "e2", kind: "open" }));
    const events = readHandoffEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(events.map((e) => e.kind)).toEqual(["pack", "open"]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() => appendHandoffEvent({ root }, { id: "x" } as never)).toThrowError(
      expect.objectContaining({ code: "schema_invalid" }),
    );
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendHandoffEvent({ root }, event({ id: "e1" }));
    const path = join(root, "stats", PROJECT_ID, "handoff.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readHandoffEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("returns [] when nothing recorded", () => {
    expect(readHandoffEvents({ root }, PROJECT_ID)).toEqual([]);
  });
});
