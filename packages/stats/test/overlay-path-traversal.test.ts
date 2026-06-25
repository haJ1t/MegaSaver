import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatsError } from "../src/errors.js";
import type { OverlayTokenSaverEvent } from "../src/event.js";
import {
  appendOverlayEvent,
  readOverlayEvents,
  readOverlaySummary,
  resetOverlayOnDisable,
} from "../src/store.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stats-trav-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function eventWith(over: Partial<OverlayTokenSaverEvent>): OverlayTokenSaverEvent {
  return {
    id: "e1",
    liveSessionId: "live1",
    workspaceKey: "ws",
    createdAt: "2026-06-25T00:00:00.000Z",
    sourceKind: "command",
    label: "ls",
    rawBytes: 10,
    returnedBytes: 4,
    bytesSaved: 6,
    savingRatio: 0.6,
    summary: "s",
    mode: "aggressive",
    ...over,
  };
}

describe("overlay path traversal", () => {
  it("rejects a `..` workspaceKey on append and writes nothing outside the store", () => {
    expect(() =>
      appendOverlayEvent({
        store: { root },
        event: eventWith({ workspaceKey: "../escape" }),
        secretsRedacted: 0,
        chunksStored: 0,
      }),
    ).toThrow(StatsError);
    expect(existsSync(join(root, "..", "escape"))).toBe(false);
  });

  it("rejects a `..` liveSessionId on append", () => {
    expect(() =>
      appendOverlayEvent({
        store: { root },
        event: eventWith({ liveSessionId: ".." }),
        secretsRedacted: 0,
        chunksStored: 0,
      }),
    ).toThrow(StatsError);
  });

  it("guards the read/reset path builders too (not just the schema)", () => {
    expect(() => readOverlaySummary({ root }, "../escape", "live1")).toThrow(StatsError);
    expect(() => readOverlayEvents({ root }, "ws", "..")).toThrow(StatsError);
    expect(() => resetOverlayOnDisable({ root }, "../escape", "live1")).toThrow(StatsError);
  });

  it("still accepts safe segments", () => {
    const res = appendOverlayEvent({
      store: { root },
      event: eventWith({ workspaceKey: "ws", liveSessionId: "live1" }),
      secretsRedacted: 0,
      chunksStored: 0,
    });
    expect(res.eventsTotal).toBe(1);
  });
});
