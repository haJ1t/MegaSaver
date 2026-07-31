import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpEnvelopeBytes } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const NOW = "2026-07-31T12:00:00.000Z";

const CONTENT = `${Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit`).join("\n")}\n`;
const RAW_BYTES = Buffer.byteLength(CONTENT, "utf8");

function registry(projectRoot: string): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput: true },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

type LedgerRow = {
  returnedBytes?: number;
  rawBytes?: number;
  bytesSaved?: number;
  deltaBytes?: number;
  savingRatio?: number;
  chunkSetId?: string;
  sourceKind?: string;
  summary?: string;
};

async function readEventLines(path: string): Promise<LedgerRow[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l) as LedgerRow);
}

// Spec §7 item 3 (S2-2/S4-5): an unchanged re-read still delivers a real MCP
// envelope (summary + priorChunkSetId marker), so it must reach the ledger
// with envelope-true bytes — not return before any append.
describe("unchanged re-read reaches the ledger (registry pipeline)", () => {
  let store: string;
  let projectRoot: string;
  let logPath: string;
  let idCounter: number;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-unchanged-reg-"));
    projectRoot = await mkdtemp(join(tmpdir(), "cg-unchanged-reg-root-"));
    logPath = join(projectRoot, "log.txt");
    await writeFile(logPath, CONTENT);
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  function run() {
    return runOutputPipeline({
      registry: registry(projectRoot),
      storeRoot: store,
      sessionId: SESSION_ID,
      path: logPath,
      intent: "find the error",
      now: () => NOW,
      newId: () => `id-${idCounter++}`,
      loadPermissions: () => null,
    });
  }

  it("second identical read appends exactly one more event with envelope-true bytes", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const priorChunkSetId = r1.result.chunkSetId;

    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.decision).toBe("unchanged-marker");

    const events = await readEventLines(
      join(store, "stats", PROJECT_ID, `${SESSION_ID}.events.jsonl`),
    );
    expect(events).toHaveLength(2);
    const ev = events[1] as LedgerRow;

    const envBytes = mcpEnvelopeBytes(r2.result);
    expect(ev.returnedBytes).toBe(envBytes);
    expect(ev.rawBytes).toBe(RAW_BYTES);
    expect(ev.bytesSaved).toBe(Math.max(0, RAW_BYTES - envBytes));
    expect(ev.deltaBytes).toBe(RAW_BYTES - envBytes);
    expect(ev.savingRatio).toBe(Math.max(0, RAW_BYTES - envBytes) / RAW_BYTES);
    expect(ev.chunkSetId).toBe(priorChunkSetId);
    expect(ev.sourceKind).toBe("file");
    expect(String(ev.summary)).toContain("unchanged");
  });
});

describe("unchanged re-read reaches the ledger (overlay pipeline)", () => {
  let store: string;
  let cwd: string;
  let filePath: string;
  let idCounter: number;
  const LSID = SESSION_ID as string;

  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "cg-unchanged-ovl-"));
    cwd = await mkdtemp(join(tmpdir(), "cg-unchanged-ovl-cwd-"));
    filePath = join(cwd, "f.txt");
    await writeFile(filePath, CONTENT);
    idCounter = 0;
  });

  afterEach(async () => {
    await rm(store, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  function run() {
    return runOverlayOutputPipeline({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd,
      path: filePath,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      permissions: null,
      now: () => NOW,
      newId: () => `id-${idCounter++}`,
    });
  }

  it("second identical read appends exactly one more event with envelope-true bytes", async () => {
    const r1 = await run();
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const priorChunkSetId = r1.result.chunkSetId;

    const r2 = await run();
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.result.decision).toBe("unchanged-marker");

    const events = await readEventLines(join(store, "stats", WK, `${LSID}.events.jsonl`));
    expect(events).toHaveLength(2);
    const ev = events[1] as LedgerRow;

    const envBytes = mcpEnvelopeBytes(r2.result);
    expect(ev.returnedBytes).toBe(envBytes);
    expect(ev.rawBytes).toBe(RAW_BYTES);
    expect(ev.bytesSaved).toBe(Math.max(0, RAW_BYTES - envBytes));
    expect(ev.deltaBytes).toBe(RAW_BYTES - envBytes);
    expect(ev.chunkSetId).toBe(priorChunkSetId);
    expect(String(ev.summary)).toContain("unchanged");
  });
});
