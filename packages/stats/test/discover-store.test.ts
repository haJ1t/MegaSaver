import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorkspaceOverlayEvents } from "../src/store.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-discover-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const eventLine = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    liveSessionId: "sess1",
    workspaceKey: "wk1",
    createdAt: "2026-08-13T10:00:00.000Z",
    sourceKind: "command",
    label: "ls",
    rawBytes: 100,
    returnedBytes: 10,
    bytesSaved: 90,
    savingRatio: 0.9,
    summary: "",
    ...over,
  });

describe("readWorkspaceOverlayEvents", () => {
  it("folds all session event files, skipping corrupt lines and non-event files", () => {
    const dir = join(root, "stats", "wk1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "sess1.events.jsonl"),
      `${eventLine("e1")}\nnot-json\n${eventLine("e2", { origin: "exec-rewrite" })}\n`,
    );
    writeFileSync(join(dir, "sess2.events.jsonl"), `${eventLine("e3")}\n`);
    writeFileSync(join(dir, "sess1.json"), JSON.stringify({ junk: true }));

    const events = readWorkspaceOverlayEvents({ root }, "wk1");
    expect(events.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);
    expect(events.find((e) => e.id === "e2")?.origin).toBe("exec-rewrite");
  });

  it("missing workspace dir -> empty list", () => {
    expect(readWorkspaceOverlayEvents({ root }, "nope")).toEqual([]);
  });
});
