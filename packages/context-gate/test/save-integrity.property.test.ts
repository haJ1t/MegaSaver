import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { readAndFilter, persistChunkSet } from "../src/read.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";

// A1 — THE SAVE-INTEGRITY CONTRACT (spec 2026-07-28-saver-compression-integrity §W4).
//
// One promise, asserted identically on every entry point: whatever the model is
// handed, plus whatever the advertised recovery surface can hand back, together
// still contain everything the tool produced. Nothing may be silently gone.
//
// The recovery surface is deliberately exercised the way the footer advertises
// it — `mega output chunk "<id>" "<i>"` for i = 0.. — not by reaching into the
// content store. A chunk the published interface cannot reach is not recovered,
// however faithfully it sits on disk.
//
// SHIPS RED. Track B (Kimi) writes B6/B8 against this contract, so it exists
// before the fixes do; Track A's A2 is what makes the failing paths pass.

const MODES: readonly TokenSaverMode[] = ["aggressive", "balanced", "safe"];
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-28T00:00:00.000Z";
const ROOT_PID = String(process.pid);

// Distinct, individually-identifiable lines: every one that goes missing is a
// nameable loss, and none can be reconstructed from its neighbours. Sized well
// past the largest mode budget (32 KB) so all three modes actually compress.
function corpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 1400; i += 1) {
    lines.push(`payload-${i} module-${i} loaded from /repo/src/pkg-${i}/entry-${i}.ts ok`);
  }
  return lines.join("\n");
}

// Walks the advertised recovery interface until it reports exhaustion, so the
// test measures what an agent can actually retrieve.
async function recoverAll(storeRoot: string, chunkSetId: string): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; ; i += 1) {
    const res = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!res.ok) break;
    parts.push(res.chunk.text);
  }
  return parts.join("\n");
}

// The contract. Redaction is applied to the expectation, not asserted away:
// a secret that policy stripped is intentionally absent and must not count as
// a loss. Blank lines carry no evidence.
function assertNothingLost(raw: string, delivered: string, recovered: string): void {
  const universe = `${delivered}\n${recovered}`;
  const missing = redact(raw)
    .redacted.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !universe.includes(l));
  expect(
    missing.slice(0, 5),
    `${missing.length} line(s) exist in neither the delivered text nor any recoverable chunk`,
  ).toEqual([]);
}

let store: string;
let cwd: string;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-integrity-store-"));
  cwd = await mkdtemp(join(tmpdir(), "cg-integrity-cwd-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("save integrity — hook path (recordAndFilterOverlayOutput)", () => {
  for (const mode of MODES) {
    it(`loses nothing in ${mode} mode`, async () => {
      const raw = corpus();
      const result = await recordAndFilterOverlayOutput({
        storeRoot: store,
        workspaceKey: WK,
        liveSessionId: LSID,
        raw,
        sourceKind: "file",
        label: "/repo/src/sample.ts",
        mode,
        storeRawOutput: true,
        includeFooter: true,
        newId: () => `cs-hook-${mode}`,
      });
      expect(result.decision).toBe("compressed");
      assertNothingLost(raw, result.returnedText, await recoverAll(store, `cs-hook-${mode}`));
    });
  }
});

describe("save integrity — read path (readAndFilter + persistChunkSet)", () => {
  for (const mode of MODES) {
    it(`loses nothing in ${mode} mode`, async () => {
      const raw = corpus();
      const abs = join(cwd, "sample.ts");
      await writeFile(abs, raw);

      const read = await readAndFilter({
        absolute: abs,
        path: "sample.ts",
        intent: "find the entry module",
        mode,
        maxReturnedBytes: undefined,
      });
      expect(read.ok).toBe(true);
      if (!read.ok) return;

      const chunkSetId = `cs-read-${mode}`;
      await persistChunkSet({
        storeRoot: store,
        chunkSetId,
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: CREATED_AT,
        path: "sample.ts",
        result: read.result,
      });

      const delivered = read.result.excerpts.map((e) => e.text).join("\n");
      assertNothingLost(raw, delivered, await recoverAll(store, chunkSetId));
    });
  }
});

describe("save integrity — overlay exec path (runOverlayOutputExecCommand)", () => {
  for (const mode of MODES) {
    it(`loses nothing in ${mode} mode`, async () => {
      const raw = corpus();
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
        killed: boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = vi.fn(() => true);
      const spawn = ((): unknown => child) as unknown as RunCommandSpawn;

      const pending = runOverlayOutputExecCommand({
        storeRoot: store,
        workspaceKey: WK,
        liveSessionId: LSID,
        cwd,
        command: "cat",
        args: ["build.log"],
        intent: "why did the build fail",
        originPid: ROOT_PID,
        mode,
        storeRawOutput: true,
        maxReturnedBytes: undefined,
        permissions: undefined,
        timeoutMs: 5000,
        maxBytes: 1_000_000,
        spawn,
        now: () => CREATED_AT,
        newId: () => `cs-exec-${mode}`,
      } as Parameters<typeof runOverlayOutputExecCommand>[0]);

      child.stdout.emit("data", Buffer.from(raw));
      child.emit("close", 0);
      const result = await pending;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const r = result as unknown as { chunkSetId?: string; excerpts?: { text: string }[] };
      const chunkSetId = r.chunkSetId ?? `cs-exec-${mode}`;
      const delivered = (r.excerpts ?? []).map((e) => e.text).join("\n");
      assertNothingLost(raw, delivered, await recoverAll(store, chunkSetId));
    });
  }
});
