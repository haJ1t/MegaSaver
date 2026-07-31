import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { listEvidenceByWorkspace } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { readOverlayEvents } from "@megasaver/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { excerptHandler } from "../src/handlers.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-excerpt-idem-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const RAW = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join(
  "\n",
);
const WS = encodeWorkspaceKey("/test/proj");
const LIVE = "22222222-2222-4222-8222-222222222222";
// The hook's content-derived chunk-set id: identical on the daemon body and
// the in-process fallback for the same tool output.
const CHUNK_SET_ID = `cs-${createHash("sha256").update(RAW).digest("hex").slice(0, 32)}`;

// B11 (HOOK-3): the hook aborts the daemon POST after 1.5s and falls back to
// the in-process record. When the timeout fires AFTER the daemon already
// wrote, both writers record the SAME compression — the store must hold
// exactly one savings event (and one evidence row), not two.
describe("excerpt daemon-write-then-timeout-fallback idempotency", () => {
  it("daemon path then in-process fallback for the same output records ONE savings event", async () => {
    const daemonRes = await excerptHandler(store, {
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      includeFooter: true,
      chunkSetId: CHUNK_SET_ID,
    });
    expect(daemonRes.status).toBe(200);
    expect(daemonRes.json.decision).toBe("compressed");

    const fallback = await recordAndFilterOverlayOutput({
      storeRoot: store,
      evidenceStoreRoot: store,
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      includeFooter: true,
      newId: () => CHUNK_SET_ID,
    });
    expect(fallback.decision).toBe("compressed");

    const savings = readOverlayEvents({ root: store }, WS, LIVE).filter(
      (e) => e.kind !== "expansion",
    );
    expect(savings).toHaveLength(1);

    const evidence = await listEvidenceByWorkspace({ storeRoot: store, workspaceKey: WS });
    expect(evidence).toHaveLength(1);
  });

  it("daemon and fallback derive the SAME id for the same dual-stream part", async () => {
    // streamSlot rides the /excerpt body so a slot-carrying part dedupes
    // across the daemon write and the in-process replay, while its
    // byte-identical sibling stream stays a distinct event.
    const daemonRes = await excerptHandler(store, {
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      chunkSetId: CHUNK_SET_ID,
      streamSlot: "stdout",
    });
    expect(daemonRes.status).toBe(200);

    const replay = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      newId: () => CHUNK_SET_ID,
      streamSlot: "stdout",
    });
    expect(replay.decision).toBe("compressed");
    expect(readOverlayEvents({ root: store }, WS, LIVE)).toHaveLength(1);

    const sibling = await excerptHandler(store, {
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      chunkSetId: CHUNK_SET_ID,
      streamSlot: "stderr",
    });
    expect(sibling.status).toBe(200);
    expect(readOverlayEvents({ root: store }, WS, LIVE)).toHaveLength(2);
  });

  it("a DIFFERENT output in the same session still records its own event", async () => {
    await excerptHandler(store, {
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: RAW,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      chunkSetId: CHUNK_SET_ID,
    });
    const other = `${RAW}\nerror: boom`;
    const res = await excerptHandler(store, {
      workspaceKey: WS,
      liveSessionId: LIVE,
      raw: other,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
      chunkSetId: `cs-${createHash("sha256").update(other).digest("hex").slice(0, 32)}`,
    });
    expect(res.status).toBe(200);
    expect(readOverlayEvents({ root: store }, WS, LIVE)).toHaveLength(2);
  });
});
