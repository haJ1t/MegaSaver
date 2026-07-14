import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCodeTruthEvent,
  codeTruthEventSchema,
  readCodeTruthEvents,
} from "../src/code-truth-event.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-codetruth-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function demotion(over: Partial<Record<string, unknown>> = {}) {
  return codeTruthEventSchema.parse({
    type: "stale-recall-avoided",
    id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    projectId: PROJECT_ID,
    sessionId: "s1",
    memoryId: "m1",
    avoidedTokens: 120,
    estimated: true,
    createdAt: "2026-07-14T10:00:00.000Z",
    ...over,
  });
}

describe("CodeTruthEvent", () => {
  it("append/read round-trips demotion rows", () => {
    appendCodeTruthEvent({ root }, demotion());
    appendCodeTruthEvent(
      { root },
      demotion({ id: "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2", memoryId: "m2", avoidedTokens: 30 }),
    );
    const events = readCodeTruthEvents({ root }, PROJECT_ID);
    expect(events.map((e) => e.memoryId)).toEqual(["m1", "m2"]);
    expect(events.map((e) => e.avoidedTokens)).toEqual([120, 30]);
  });

  it("throws StatsError schema_invalid on a malformed event", () => {
    expect(() =>
      appendCodeTruthEvent({ root }, { type: "stale-recall-avoided", id: "x" } as never),
    ).toThrowError(expect.objectContaining({ code: "schema_invalid" }));
  });

  it("skips torn lines", () => {
    appendCodeTruthEvent({ root }, demotion());
    appendFileSync(join(root, "stats", PROJECT_ID, "code-truth.events.jsonl"), "{torn\n");
    appendCodeTruthEvent({ root }, demotion({ id: "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3" }));
    expect(readCodeTruthEvents({ root }, PROJECT_ID)).toHaveLength(2);
  });
});
