import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectId, SessionId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChunk } from "../src/fetch-chunk.js";
import { recordAndFilterOverlayOutput } from "../src/record-output.js";
import type { OrchestratorRegistry } from "../src/registry-port.js";
import type { RunCommandSpawn } from "../src/run-command.js";
import { runOutputExecCommand, runOverlayOutputExecCommand } from "../src/run-command.js";
import { runOutputPipeline, runOverlayOutputPipeline } from "../src/run.js";

// SECOND, INDEPENDENT guards for three flagship defects that each had exactly
// one catcher. A single test file per defect means deleting or weakening that
// file silently reopens the defect; these assertions are deliberately shaped so
// that they break for DIFFERENT reasons than the incumbents do.
//
//   M1  recovery derived from the post-fit excerpts instead of the raw output.
//       Incumbent (read-pipeline-recovery.test.ts) plants a needle and asserts
//       it survives. Here: a RELATION — recovery must be a strict superset of
//       delivery. Excerpt-derived recovery makes the two sets equal, and equal
//       is not superset, so no needle has to be chosen correctly for the guard
//       to bite.
//
//   M7  recoverableChunks drops normalize(), so gap markers and stored chunks
//       end up in different coordinate systems. Incumbent
//       (coordinate-skew.test.ts) measures the skew against normalize() itself.
//       Here: no oracle outside the delivered text at all — the footer publishes
//       "~L lines each, i = 0..N-1", the gap markers publish where the next
//       excerpt line sits, and the two published facts must agree with the store.
//
//   M8  returnedTextOf fabricates a content-shaped line absent from the input.
//       Incumbent (save-integrity.property.test.ts) classifies every delivered
//       line against an allow-list of markers. Here: inverse containment against
//       the raw buffer as a STRING, walked with a monotone cursor, so a
//       fabricated line is caught wherever it is inserted and a reordered one is
//       reported as reordering rather than as fabrication.

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const SESSION_ID = "22222222-2222-4222-8222-222222222222" as SessionId;
const WK = "0123456789abcdef";
const LSID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-07-29T09:00:00.000Z";
const ROOT_PID = String(process.pid);

// Distinct, individually identifiable lines with no CR, no ANSI, no trailing
// whitespace and no secret-shaped substring, so normalize() and redact() are
// both the identity on it. That is what lets the assertions below use the
// literal buffer this function returns as their oracle instead of re-deriving
// one through the production code they are policing. Sized past the safe-mode
// budget so every mode actually drops content.
function distinctCorpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 1400; i += 1) {
    lines.push(`payload-${i} module-${i} loaded from /repo/src/pkg-${i}/entry-${i}.ts ok`);
  }
  return lines.join("\n");
}

// Bare-CR progress redraws — how npm, pip, curl, docker and cargo draw progress
// bars — interleaved with distinct log lines. normalize() turns each CR into a
// newline, so marker space is twice chunk space here unless the chunker
// normalizes too. The error-dense tail pulls the fit step's last kept excerpt
// deep into the file, which is what produces a gap marker naming a line far
// enough down that the skew cannot land on the correct chunk by accident.
function progressCorpus(): string {
  const lines: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    lines.push(`downloading pkg-${i} 40%\rdownloading pkg-${i} 80%\rdownloading pkg-${i} 100%`);
    lines.push(
      i >= 380
        ? `error: timeout while resolving pkg-${i} after 30s retry budget spent`
        : `resolved pkg-${i} from /repo/node_modules/pkg-${i}/entry-${i}.ts ok`,
    );
  }
  return lines.join("\n");
}

// Structural lines the renderer is entitled to insert. Kept to the exact forms
// this generic, line-oriented corpus can reach: the raw-coordinate gap marker,
// the unaddressable-remainder marker, and the two collapse markers normalize.ts
// folds runs into. The recovery footer is NOT listed — it is stripped
// positionally instead, so a fabricated line cannot hide by dressing itself as
// a footer.
const STRUCTURAL_LINE: readonly RegExp[] = [
  /^… \[lines \d+-\d+ omitted\]$/,
  /^… \[remainder omitted — recover any part with the chunk ids below\]$/,
  /^… \[repeated \d+ times\]$/,
  /^… \[\d+ similar: .*\]$/,
];

function isStructural(line: string): boolean {
  return STRUCTURAL_LINE.some((re) => re.test(line));
}

function trimmedLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function makeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild;
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.killed = false;
  c.kill = vi.fn(() => {
    c.killed = true;
    return true;
  });
  return c;
}

function spawnMock(child: FakeChild): RunCommandSpawn {
  return ((_c: string, _a: readonly string[], _o: Record<string, unknown>) =>
    child) as unknown as RunCommandSpawn;
}

function registry(projectRoot: string, storeRawOutput = true): OrchestratorRegistry {
  return {
    getSession: (id) =>
      id === SESSION_ID
        ? {
            projectId: PROJECT_ID,
            tokenSaver: { mode: "balanced", maxReturnedBytes: 12_000, storeRawOutput },
          }
        : null,
    getProject: (id) => (id === PROJECT_ID ? { rootPath: projectRoot } : null),
    createSessionFailure: (f) => f,
    listSessionFailures: () => [],
    listMemoryEntries: () => [],
    listProjectRules: () => [],
  };
}

// Everything the pipeline hands the model. The read and exec paths return a
// structured result and leave rendering to their callers, so their model-facing
// surface is assembled here; the hook path renders its own text.
type Delivery = { delivered: string; chunkSetId: string | undefined };

type EntryContext = { store: string; projectRoot: string; filePath: string; raw: string };
type EntryPoint = { name: string; pinnedId: string; run: (ctx: EntryContext) => Promise<Delivery> };

const ENTRY_POINTS: readonly EntryPoint[] = [
  {
    name: "runOutputPipeline (registry read)",
    pinnedId: "cs-inv-read",
    run: async (ctx) => {
      const outcome = await runOutputPipeline({
        registry: registry(ctx.projectRoot),
        storeRoot: ctx.store,
        sessionId: SESSION_ID,
        path: ctx.filePath,
        intent: "which module failed to load",
        now: () => NOW,
        newId: () => "cs-inv-read",
        loadPermissions: () => null,
      });
      if (!outcome.ok) throw new Error(`read pipeline failed: ${outcome.reason}`);
      const { result } = outcome;
      return {
        delivered: [result.summary, ...result.excerpts.map((e) => e.text)].join("\n"),
        chunkSetId: result.chunkSetId,
      };
    },
  },
  {
    name: "runOverlayOutputPipeline (overlay read)",
    pinnedId: "cs-inv-ovread",
    run: async (ctx) => {
      const outcome = await runOverlayOutputPipeline({
        storeRoot: ctx.store,
        workspaceKey: WK,
        liveSessionId: LSID,
        cwd: ctx.projectRoot,
        path: ctx.filePath,
        intent: "which module failed to load",
        mode: "balanced",
        maxReturnedBytes: 12_000,
        storeRawOutput: true,
        permissions: null,
        now: () => NOW,
        newId: () => "cs-inv-ovread",
      });
      if (!outcome.ok) throw new Error(`overlay read pipeline failed: ${outcome.reason}`);
      const { result } = outcome;
      return {
        delivered: [result.summary, ...result.excerpts.map((e) => e.text)].join("\n"),
        chunkSetId: result.chunkSetId,
      };
    },
  },
  {
    name: "runOutputExecCommand (registry exec)",
    pinnedId: "cs-inv-exec",
    run: async (ctx) => {
      const child = makeChild();
      const pending = runOutputExecCommand({
        registry: registry(ctx.projectRoot),
        storeRoot: ctx.store,
        sessionId: SESSION_ID,
        command: "grep",
        args: ["payload"],
        intent: "which module failed to load",
        originPid: ROOT_PID,
        timeoutMs: 300_000,
        maxBytes: 20_000_000,
        now: () => NOW,
        newId: () => "cs-inv-exec",
        loadPermissions: () => null,
        spawn: spawnMock(child),
      });
      child.stdout.emit("data", Buffer.from(ctx.raw));
      child.emit("close", 0);
      const outcome = await pending;
      if (!outcome.ok) throw new Error(`exec pipeline failed: ${outcome.reason}`);
      const { result } = outcome;
      return {
        delivered: [result.summary, ...result.excerpts.map((e) => e.text)].join("\n"),
        chunkSetId: result.chunkSetId,
      };
    },
  },
  {
    name: "runOverlayOutputExecCommand (overlay exec)",
    pinnedId: "cs-inv-ovexec",
    run: async (ctx) => {
      const child = makeChild();
      const pending = runOverlayOutputExecCommand({
        storeRoot: ctx.store,
        workspaceKey: WK,
        liveSessionId: LSID,
        cwd: ctx.projectRoot,
        command: "cat",
        args: ["build.log"],
        intent: "which module failed to load",
        originPid: ROOT_PID,
        timeoutMs: 300_000,
        maxBytes: 20_000_000,
        mode: "balanced",
        maxReturnedBytes: 12_000,
        storeRawOutput: true,
        permissions: null,
        now: () => NOW,
        newId: () => "cs-inv-ovexec",
        spawn: spawnMock(child),
      });
      child.stdout.emit("data", Buffer.from(ctx.raw));
      child.emit("close", 0);
      const outcome = await pending;
      if (!outcome.ok) throw new Error(`overlay exec pipeline failed: ${outcome.reason}`);
      const { result } = outcome;
      return {
        delivered: [result.summary, ...result.excerpts.map((e) => e.text)].join("\n"),
        chunkSetId: result.chunkSetId,
      };
    },
  },
  {
    name: "recordAndFilterOverlayOutput (hook)",
    pinnedId: "cs-inv-hook",
    run: async (ctx) => {
      const result = await recordAndFilterOverlayOutput({
        storeRoot: ctx.store,
        workspaceKey: WK,
        liveSessionId: LSID,
        raw: ctx.raw,
        sourceKind: "file",
        label: "/repo/src/sample.ts",
        mode: "balanced",
        storeRawOutput: true,
        includeFooter: true,
        intent: "which module failed to load",
        newId: () => "cs-inv-hook",
      });
      return { delivered: result.returnedText, chunkSetId: result.chunkSetId };
    },
  },
];

// Walks the recovery surface the way the footer tells an agent to: ids 0, 1, 2 …
// until the store reports exhaustion.
//
// The id is taken from the result when the pipeline published one and falls back
// to the pinned generator value otherwise. Both halves matter. Falling back means
// a settings gate that silently skipped persistence is reported by the RECOVERY
// assertion below rather than by an incidental `chunkSetId` equality that would
// fire first and hide it. Preferring the published id when there is one means a
// pipeline that stored evidence under an id it never advertised does not get
// credit for it.
async function recoverAll(storeRoot: string, chunkSetId: string): Promise<string> {
  const parts: string[] = [];
  // Bounded: an unbounded walk would turn an always-resolving fetch into a hang
  // instead of a failure.
  for (let i = 0; i < 2000; i += 1) {
    const res = await fetchChunk({ storeRoot, chunkSetId, chunkId: String(i) });
    if (!res.ok) break;
    parts.push(res.chunk.text);
  }
  return parts.join("\n");
}

let store: string;
let projectRoot: string;

beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "cg-recinv-store-"));
  projectRoot = await mkdtemp(join(tmpdir(), "cg-recinv-root-"));
});
afterEach(async () => {
  await rm(store, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
});

// M1 — the recovery surface must hold MORE than the model was handed.
//
// The incumbent guard names a specific line and checks it survives. This one
// never names a line: it compares two sets derived from the same output. A sink
// that chunks `filtered.excerpts` stores exactly what the fit step kept, so
// recovery and delivery become the same set — a relation that is trivially
// satisfied by containment alone and fails only on strictness. That is why both
// directions are asserted, and why the strict half carries the M1 message.
describe("recovery strictly exceeds delivery on every entry point", () => {
  for (const entry of ENTRY_POINTS) {
    it(`${entry.name}: recoverable content is a proper superset of delivered content`, async () => {
      const raw = distinctCorpus();
      const filePath = join(projectRoot, "build.log");
      await writeFile(filePath, raw);

      const { delivered, chunkSetId } = await entry.run({
        store,
        projectRoot,
        filePath,
        raw,
      });
      const recovered = await recoverAll(store, chunkSetId ?? entry.pinnedId);

      const outputLines = trimmedLines(raw);
      const deliveredSet = new Set(trimmedLines(delivered));
      const recoveredSet = new Set(trimmedLines(recovered));
      const inDelivered = outputLines.filter((l) => deliveredSet.has(l));
      const inRecovered = outputLines.filter((l) => recoveredSet.has(l));

      // Guards against a vacuous pass from both ends: the relation says nothing
      // if the pipeline delivered no evidence, and nothing if it dropped none.
      expect(inDelivered.length, "the model was handed no verbatim output line").toBeGreaterThan(0);
      expect(
        inDelivered.length,
        "the pipeline delivered the whole output, so there is no loss for recovery to cover",
      ).toBeLessThan(outputLines.length);

      const unrecoverable = inDelivered.filter((l) => !recoveredSet.has(l));
      expect(
        unrecoverable.slice(0, 5),
        `${unrecoverable.length} line(s) the model was shown cannot be fetched back, so the recovery surface is not a superset of the delivered view`,
      ).toEqual([]);

      const beyondDelivered = inRecovered.filter((l) => !deliveredSet.has(l));
      expect(
        beyondDelivered.length,
        `the recovery surface holds ${inRecovered.length} output line(s) and the model was already handed ${inDelivered.length} of them — recovery adds NOTHING the model does not already have, which is what storing the post-fit excerpts instead of the raw output looks like`,
      ).toBeGreaterThan(0);
    });
  }
});

// The exec paths are the two persistence sites with no opt-out coverage at all
// (`run-command.ts` storeRawOutput gates). Opting out is lossy AND permanent, so
// the assertion is about the store, not about a field: nothing may sit on disk
// under the id the pipeline would have used.
describe("storeRawOutput=false persists no recovery surface on the exec paths", () => {
  it("runOutputExecCommand stores nothing under the id it would have published", async () => {
    const raw = distinctCorpus();
    const child = makeChild();
    const pending = runOutputExecCommand({
      registry: registry(projectRoot, false),
      storeRoot: store,
      sessionId: SESSION_ID,
      command: "grep",
      args: ["payload"],
      intent: "which module failed to load",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      now: () => NOW,
      newId: () => "cs-inv-exec-off",
      loadPermissions: () => null,
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(raw));
    child.emit("close", 0);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Guards against a vacuous pass: a passthrough persists nothing for reasons
    // that have nothing to do with the storage gate.
    expect(outcome.result.decision).toBe("compressed");

    // The store is asserted BEFORE the published id, deliberately. An absent
    // `chunkSetId` only says the pipeline stayed quiet about a chunk set; the
    // operator opted out of the bytes, not out of the announcement, so what has
    // to hold is that no bytes are there. `newId` is pinned, so a gate that
    // persisted anyway wrote the set under exactly this id.
    const recovered = await recoverAll(store, "cs-inv-exec-off");
    expect(
      recovered,
      "the session opted out of raw storage, yet the exec path left recoverable content on disk",
    ).toBe("");
    expect(outcome.result.chunkSetId).toBeUndefined();
  });

  it("runOverlayOutputExecCommand stores nothing under the id it would have published", async () => {
    const raw = distinctCorpus();
    const child = makeChild();
    const pending = runOverlayOutputExecCommand({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      cwd: projectRoot,
      command: "cat",
      args: ["build.log"],
      intent: "which module failed to load",
      originPid: ROOT_PID,
      timeoutMs: 300_000,
      maxBytes: 20_000_000,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: false,
      permissions: null,
      now: () => NOW,
      newId: () => "cs-inv-ovexec-off",
      spawn: spawnMock(child),
    });
    child.stdout.emit("data", Buffer.from(raw));
    child.emit("close", 0);
    const outcome = await pending;

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.decision).toBe("compressed");

    const recovered = await recoverAll(store, "cs-inv-ovexec-off");
    expect(
      recovered,
      "the workspace opted out of raw storage, yet the overlay exec path left recoverable content on disk",
    ).toBe("");
    expect(outcome.result.chunkSetId).toBeUndefined();
  });
});

// M7 — follow the footer's own published rule.
//
// Everything below is read out of the delivered text. The footer states the
// chunk size ("~L lines each") and the id range; the gap markers state where the
// next excerpt line sits, because `… [lines A-B omitted]` means the line
// IMMEDIATELY after the marker is raw line B+1. Feed that line number through the
// footer's rule, fetch the chunk it names, and the line must be in there.
//
// No production helper is consulted for the coordinate space — not normalize(),
// not OVERLAY_CHUNK_LINES — so the incumbent skew test could be deleted whole
// and this would still fail: it is the agent's own arithmetic, done with the
// agent's own inputs.
type FooterRule = { chunkSetId: string; linesPerChunk: number; lastIndex: number };

function footerRule(delivered: string): FooterRule {
  const sized = /stored in (\d+) chunks of ~(\d+) lines each/.exec(delivered);
  const cmd = /mega output chunk "([^"]+)" "<i>" \(i = 0\.\.(\d+)\)/.exec(delivered);
  if (sized === null || cmd === null) {
    throw new Error("delivered text published no multi-chunk recovery rule");
  }
  const linesPerChunk = Number(sized[2]);
  const chunkSetId = cmd[1];
  const lastIndex = Number(cmd[2]);
  if (chunkSetId === undefined) throw new Error("recovery instruction named no chunk set");
  return { chunkSetId, linesPerChunk, lastIndex };
}

// A marker and the line it hands the next coordinate to. The successor must be
// the IMMEDIATELY following line: skipping forward past a collapse marker would
// silently move the line off B+1 and make the oracle wrong, so such a pair is
// discarded rather than repaired.
type AddressedLine = { line: number; text: string };

function addressedLines(delivered: string): AddressedLine[] {
  const lines = delivered.split("\n");
  const out: AddressedLine[] = [];
  for (const [i, current] of lines.entries()) {
    const marker = /^… \[lines (\d+)-(\d+) omitted\]$/.exec(current.trim());
    if (marker === null) continue;
    const end = marker[2];
    const successor = lines[i + 1];
    if (end === undefined || successor === undefined) continue;
    const text = successor.trim();
    if (text.length === 0 || isStructural(text) || text.startsWith("[Mega Saver:")) continue;
    out.push({ line: Number(end) + 1, text });
  }
  return out;
}

describe("the footer's own published rule resolves the lines the markers name", () => {
  it("every line a gap marker hands off is inside the chunk the footer points at", async () => {
    const raw = progressCorpus();
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "command",
      label: "npm install",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      intent: "which package timed out",
      newId: () => "cs-inv-rule",
    });

    expect(result.decision).toBe("compressed");
    const rule = footerRule(result.returnedText);
    const addressed = addressedLines(result.returnedText);

    // Guards against a vacuous pass, in the one way that matters here. A pair
    // near the top of the output cannot discriminate: a coordinate skew is
    // proportional to depth, so at shallow line numbers the wrong space still
    // resolves to the right chunk. At least one pair must therefore name a line
    // deep enough that a skewed chunk index cannot coincide with the true one.
    const deepest = addressed.reduce((max, a) => Math.max(max, a.line), 0);
    expect(
      deepest,
      `delivered text handed off no line deeper than ${deepest}; a shallow hand-off cannot tell a skewed coordinate space from a sound one`,
    ).toBeGreaterThan(10 * rule.linesPerChunk);

    for (const { line, text } of addressed) {
      const index = Math.floor((line - 1) / rule.linesPerChunk);
      expect(
        index,
        `a gap marker hands line ${line} to chunk ${index}, but the footer only advertises i = 0..${rule.lastIndex}`,
      ).toBeLessThanOrEqual(rule.lastIndex);

      const fetched = await fetchChunk({
        storeRoot: store,
        chunkSetId: rule.chunkSetId,
        chunkId: String(index),
      });
      expect(
        fetched.ok,
        `the footer's rule sends line ${line} to chunk ${index}, which does not resolve`,
      ).toBe(true);
      if (!fetched.ok) continue;
      expect(
        fetched.chunk.text,
        `the footer's rule sends line ${line} to chunk ${index} (lines ${fetched.chunk.startLine}-${fetched.chunk.endLine}), which does not contain the line the delivered text says lives there`,
      ).toContain(text);
    }
  });
});

// M8 — inverse containment, walked as a string.
//
// The incumbent guard classifies each delivered line against an allow-list of
// marker forms. This one asks the opposite question of the raw buffer directly:
// every non-structural delivered line must OCCUR in it, and occur at a
// non-decreasing offset. Two separate expectations, because the two failures are
// different bugs — a line that appears nowhere is fabrication, a line that
// appears only before the cursor is a reordering — and a future ranking change
// that reorders must not be reported as content being invented.
describe("the delivered text invents nothing", () => {
  it("every delivered line either occurs in the raw output or is a known marker", async () => {
    const raw = distinctCorpus();
    const result = await recordAndFilterOverlayOutput({
      storeRoot: store,
      workspaceKey: WK,
      liveSessionId: LSID,
      raw,
      sourceKind: "file",
      label: "/repo/src/sample.ts",
      mode: "balanced",
      storeRawOutput: true,
      includeFooter: true,
      intent: "which module failed to load",
      newId: () => "cs-inv-fab",
    });

    expect(result.decision).toBe("compressed");

    // Summary and footer are stripped POSITIONALLY — the renderer is entitled to
    // one of each, in one place each. Matching them by pattern anywhere in the
    // body would let a fabricated line hide by imitating them.
    const footerAt = result.returnedText.lastIndexOf("\n\n[Mega Saver: ");
    expect(footerAt, "the delivered text carried no recovery footer to strip").toBeGreaterThan(0);
    const body = result.returnedText.slice(0, footerAt);
    expect(
      body.startsWith(result.summary),
      "the delivered text must open with the pipeline's own summary",
    ).toBe(true);

    const fabricated: string[] = [];
    const reordered: string[] = [];
    let checked = 0;
    let cursor = 0;
    for (const line of trimmedLines(body.slice(result.summary.length))) {
      if (isStructural(line)) continue;
      checked += 1;
      if (!raw.includes(line)) {
        fabricated.push(line);
        continue;
      }
      const at = raw.indexOf(line, cursor);
      if (at < 0) {
        reordered.push(line);
        continue;
      }
      cursor = at + line.length;
    }

    // Guards against a vacuous pass: a delivery reduced to markers would satisfy
    // both lists with nothing examined.
    expect(checked, "no content line was examined").toBeGreaterThan(50);
    expect(
      fabricated.slice(0, 5),
      `${fabricated.length} delivered line(s) occur nowhere in the tool output and are not known markers — the model is holding synthesized text it cannot tell apart from evidence`,
    ).toEqual([]);
    expect(
      reordered.slice(0, 5),
      `${reordered.length} delivered line(s) occur in the tool output only BEFORE an earlier delivered line, so the delivered order contradicts the source order`,
    ).toEqual([]);
  });
});
