import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "@megasaver/policy";
import type { ProjectId, SessionId, TokenSaverMode } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { persistChunkSet, readAndFilter } from "../src/read.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOverlayOutputExecCommand } from "../src/run-command.js";

// A1 — THE SAVE-INTEGRITY CONTRACT (spec 2026-07-28-saver-compression-integrity §W4).
//
// One promise, asserted identically on every entry point: whatever the model is
// handed, plus whatever the advertised recovery surface can hand back, together
// still contain everything the tool produced. Nothing may be silently gone.
//
// The `plus` is load-bearing in BOTH directions, so the contract is two
// assertions, not one. A union check alone is satisfied by the recoverable half
// on its own — the stored chunks are the whole redacted raw — and would pass a
// pipeline that hands the model a bare summary with zero evidence. So the
// delivered half is asserted separately, on its own terms.
//
// The recovery surface is deliberately exercised the way the footer advertises
// it — `mega output chunk "<id>" "<i>"` for i = 0.. — not by reaching into the
// content store. A chunk the published interface cannot reach is not recovered,
// however faithfully it sits on disk.

const MODES: readonly TokenSaverMode[] = ["aggressive", "balanced", "safe"];
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-28T00:00:00.000Z";
const ROOT_PID = String(process.pid);

// Per-mode floor on the evidence the model itself receives, in whole raw lines.
//
// A single uniform floor could not see partial degradation: the modes deliver
// very different amounts, so a floor low enough for the tightest mode was slack
// the widest mode could lose 90% of its evidence inside. Each mode is now
// pinned near its own measured delivery.
//
// MEASURED on this corpus (all three entry points agree exactly, so the table
// is keyed on mode alone): aggressive 40 distinct raw lines, balanced 160,
// safe 440. The floors are 0.75x of that. The margin is deliberate and sized
// from both sides: 25% of drift is ranking and budget-tuning room, while
// anything that halves a mode's delivery lands at 0.5x and trips the floor.
//
// Aggressive's 40 is worth reading twice, because the number is a coincidence
// with teeth: it equals output-filter's no-blind fallback, which hands back one
// GENERIC_FALLBACK_LINES_PER_CHUNK-sized chunk whenever the fit step keeps
// nothing. Aggressive's 4 KB budget admits exactly one 40-line chunk, so
// squeezing the fit budget moves aggressive from "one chunk that fit" to "one
// chunk from the fallback" and the delivered line count does not move at all.
// A future reader tightening aggressive toward 40 would be pinning the floor to
// the fallback rather than to real ranked delivery.
const MEASURED_DELIVERED_LINES: Record<TokenSaverMode, number> = {
  aggressive: 40,
  balanced: 160,
  safe: 440,
};
const MIN_DELIVERED_EVIDENCE_LINES: Record<TokenSaverMode, number> = {
  aggressive: 30,
  balanced: 120,
  safe: 330,
};

// The lines the pipeline is entitled to add that are NOT in the tool output.
//
// Enumerated by exact form, with the numeric fields spelled out. A generic
// `^… \[` prefix would be a hole of its own — it accepts any fabricated line
// dressed as a marker, which is precisely the failure this guard exists to
// catch, so the list is kept as narrow as the corpus allows.
//
// THAT NARROWNESS IS A PRECONDITION, not full coverage of the pipeline. This
// corpus is generic line-oriented text, so it reaches only generic chunking:
// the sole markers reachable are the raw-coordinate gap marker, the collapse
// markers normalize.ts folds runs into, and the recovery footer. The
// specialized compressors synthesize further forms — `… [N paragraphs]`,
// `… [N more items]`, `… [N unchanged]`, `… [N passing collapsed]` (indented,
// which is why matching happens after trim), and tsc's `Top files by error
// count: …`, which does not begin with `… [` at all. None can fire here.
// A corpus or classification change must revisit this list before widening it,
// or a legitimate marker will be reported as fabricated.
const STRUCTURAL_LINE: readonly RegExp[] = [
  /^… \[lines \d+-\d+ omitted\]$/,
  /^… \[remainder omitted — recover any part with the chunk ids below\]$/,
  /^… \[repeated \d+ times\]$/,
  /^… \[\d+ similar: .*\]$/,
  /^\[Mega Saver: compressed \d+→\d+ B .*\]$/,
];

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

// Redaction is applied to the expectation, not asserted away: a secret that
// policy stripped is intentionally absent and must not count as a loss. Blank
// lines carry no evidence.
function evidenceLines(raw: string): string[] {
  return redact(raw)
    .redacted.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Half one: the model is handed real evidence, not a verdict about evidence.
// Counted in verbatim raw lines because that is what the agent can act on — a
// summary sentence and a gap marker are navigation, not content.
function assertDeliveredCarriesEvidence(
  raw: string,
  delivered: string,
  mode: TokenSaverMode,
): void {
  const deliveredLines = new Set(trimmedLines(delivered));
  const present = evidenceLines(raw).filter((l) => deliveredLines.has(l));
  expect(
    present.length,
    `${mode} delivered ${present.length} verbatim output line(s) against a measured ${MEASURED_DELIVERED_LINES[mode]}; this mode has lost a large share of its evidence, even though other modes may still be intact`,
  ).toBeGreaterThanOrEqual(MIN_DELIVERED_EVIDENCE_LINES[mode]);
}

function trimmedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Half three: the delivered text is a SUBSET of the output plus explicit
// markers. Containment (halves one and two) only ever asks whether real lines
// are present; on its own it is fully satisfied by a pipeline that hands the
// model genuine evidence AND invented lines side by side. An agent cannot tell
// the two apart, which makes fabrication worse than omission — an omission at
// least announces itself with a gap marker.
//
// The summary is stripped POSITIONALLY, not by string membership: the pipeline
// is entitled to state a verdict, but only in the one place the renderer puts
// it. Membership would let a fabricated line hide by copying the summary text.
function assertNoFabrication(raw: string, delivered: string, summary: string): void {
  expect(
    delivered.startsWith(summary),
    "the delivered text must open with the pipeline's own summary",
  ).toBe(true);

  // Both spellings count as genuine: the delivered text is rendered from the
  // unredacted output while the stored chunks hold the redacted one, so a
  // secret-bearing line is authentic in whichever form it survived as.
  const authentic = new Set([...trimmedLines(raw), ...evidenceLines(raw)]);
  const invented = trimmedLines(delivered.slice(summary.length)).filter(
    (l) => !authentic.has(l) && !STRUCTURAL_LINE.some((re) => re.test(l)),
  );
  expect(
    invented.slice(0, 5),
    `${invented.length} delivered line(s) appear nowhere in the tool output and are not recognised markers — the model is being handed synthesized content it has no way to distinguish from evidence`,
  ).toEqual([]);
}

// Half two: nothing is anywhere unreachable.
function assertNothingLost(raw: string, delivered: string, recovered: string): void {
  const universe = `${delivered}\n${recovered}`;
  const missing = evidenceLines(raw).filter((l) => !universe.includes(l));
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
      expect(result.chunkSetId).toBe(`cs-hook-${mode}`);
      assertDeliveredCarriesEvidence(raw, result.returnedText, mode);
      // The only path that exercises returnedTextOf: the read and exec paths
      // hand back excerpts and leave rendering to their own callers.
      assertNoFabrication(raw, result.returnedText, result.summary);
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
      expect(read.result.decision).toBe("compressed");

      const chunkSetId = `cs-read-${mode}`;
      await persistChunkSet({
        storeRoot: store,
        chunkSetId,
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        createdAt: CREATED_AT,
        path: "sample.ts",
        raw,
        result: read.result,
      });

      const delivered = read.result.excerpts.map((e) => e.text).join("\n");
      assertDeliveredCarriesEvidence(raw, delivered, mode);
      // Summary + excerpt text is the whole model-facing surface this path
      // produces; assembling it here keeps the fabrication guard on the
      // compression layer even where no renderer runs.
      assertNoFabrication(raw, `${read.result.summary}\n${delivered}`, read.result.summary);
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
        permissions: null,
        timeoutMs: 5000,
        maxBytes: 1_000_000,
        spawn,
        now: () => CREATED_AT,
        newId: () => `cs-exec-${mode}`,
      });

      child.stdout.emit("data", Buffer.from(raw));
      child.emit("close", 0);
      const result = await pending;

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The success arm is `{ ok, result }` — the excerpts and the chunk-set id
      // live one level down. Read through the declared shape so tsc, not a
      // cast, is what certifies the field names.
      const exec = result.result;
      expect(exec.decision).toBe("compressed");

      const chunkSetId = exec.chunkSetId;
      expect(chunkSetId).toBe(`cs-exec-${mode}`);
      if (chunkSetId === undefined) return;

      const delivered = exec.excerpts.map((e) => e.text).join("\n");
      assertDeliveredCarriesEvidence(raw, delivered, mode);
      assertNoFabrication(raw, `${exec.summary}\n${delivered}`, exec.summary);
      assertNothingLost(raw, delivered, await recoverAll(store, chunkSetId));
    });
  }
});
