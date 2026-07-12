import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendGuardEvent, guardEventSchema, readGuardEvents } from "../src/guard-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardevent-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function intercept(over: Partial<Record<string, unknown>> = {}) {
  return guardEventSchema.parse({
    type: "intercept",
    id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    projectId: PROJECT_ID,
    sessionId: "s1",
    matchedId: "f1",
    matchedKind: "auto-capture",
    normalizedCommand: "pnpm vitest --shard 2",
    tier: "t1",
    action: "warn",
    avoidedTokens: 4200,
    estimated: true,
    createdAt: "2026-07-12T10:00:00.000Z",
    ...over,
  });
}

describe("GuardEvent", () => {
  it("append/read round-trips intercept and outcome rows", () => {
    appendGuardEvent({ root }, intercept());
    appendGuardEvent(
      { root },
      guardEventSchema.parse({
        type: "outcome",
        id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2",
        projectId: PROJECT_ID,
        sessionId: "s1",
        interceptId: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
        outcome: "overridden-ok",
        createdAt: "2026-07-12T10:01:00.000Z",
      }),
    );
    const events = readGuardEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.type)).toEqual(["intercept", "outcome"]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() => appendGuardEvent({ root }, { type: "intercept", id: "x" } as never)).toThrowError(
      expect.objectContaining({ code: "schema_invalid" }),
    );
  });

  it("skips torn lines", () => {
    appendGuardEvent({ root }, intercept());
    const path = join(root, "stats", PROJECT_ID, "guard.events.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, "{torn\n");
    expect(readGuardEvents({ root }, PROJECT_ID).length).toBe(1);
  });

  it("rejects estimated:false — guard numbers are estimates by contract", () => {
    expect(guardEventSchema.safeParse({ ...intercept(), estimated: false }).success).toBe(false);
  });
});
