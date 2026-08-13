import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";

const LARGE_RAW = `line ${"x".repeat(50_000)} tail`;

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-origin-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

function lastEventLine(): Record<string, unknown> {
  const wk = encodeWorkspaceKey("/test/proj");
  const path = join(store, "stats", wk, "sess-1.events.jsonl");
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  return JSON.parse(lines[lines.length - 1] ?? "{}") as Record<string, unknown>;
}

function baseInput() {
  return {
    storeRoot: store,
    evidenceStoreRoot: store,
    workspaceKey: encodeWorkspaceKey("/test/proj"),
    liveSessionId: "sess-1",
    raw: LARGE_RAW,
    sourceKind: "command" as const,
    label: "run tests",
    mode: "aggressive" as const,
    storeRawOutput: true,
  };
}

describe("recordAndFilterOverlayOutput origin (exec-rewrite)", () => {
  it("persists origin on the overlay event", async () => {
    await recordAndFilterOverlayOutput({ ...baseInput(), origin: "exec-rewrite" });
    // biome-ignore lint/complexity/useLiteralKeys: property access on a record index signature
    expect(lastEventLine()["origin"]).toBe("exec-rewrite");
  });

  it("omits origin when absent (back-compat)", async () => {
    await recordAndFilterOverlayOutput(baseInput());
    expect("origin" in lastEventLine()).toBe(false);
  });
});
