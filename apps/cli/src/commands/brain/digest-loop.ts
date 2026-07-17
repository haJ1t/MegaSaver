import type { MemoryEntry } from "@megasaver/core";
import type { MemoryEntryId } from "@megasaver/shared";
import { formatMemorySearchLine } from "../memory/shared.js";

export type DigestItem = {
  entry: MemoryEntry;
  sessionLabel: string;
  occurrencesNote?: string;
};

export type DigestAction =
  | { kind: "approve"; id: MemoryEntryId }
  | { kind: "reject"; id: MemoryEntryId }
  | { kind: "edit"; id: MemoryEntryId }
  | { kind: "skip"; id: MemoryEntryId }
  | { kind: "undo" }
  | { kind: "expandAuto" }
  | { kind: "quit" };

export type DigestActionResult = {
  lines: readonly string[];
  // approve/reject/edit actually flipped a row — it becomes the single-level
  // undo target. Absent/false (skip, no-op, edit-abort) leaves undo untouched.
  decided?: boolean;
  // expandAuto: spot-review rows spliced in ahead of the remaining queue.
  insertItems?: readonly DigestItem[];
};

const KEY_HELP = "keys: y approve · n reject · e edit · s skip · u undo · a auto-approved · q quit";
// Raw mode suppresses signal generation: Ctrl-C arrives as this byte and must
// abort exactly like SIGINT (architect M5 — never leave the shell in raw mode).
const CTRL_C = "\u0003";

type RawModeStream = NodeJS.ReadableStream & {
  setRawMode?: (mode: boolean) => void;
};

function renderItem(item: DigestItem): string {
  const note = item.occurrencesNote === undefined ? "" : `  ·  ${item.occurrencesNote}`;
  return `${item.sessionLabel}  ${formatMemorySearchLine({
    id: item.entry.id,
    type: item.entry.type,
    confidence: item.entry.confidence,
    title: item.entry.title,
  })}${note}`;
}

// The isolated keystroke machine (spec §6.2, architect M5). A dumb sequencer:
// all store I/O lives in the injected onAction handler. Emits `quit` exactly
// once — on `q` or queue exhaustion — and never on abort (SIGINT/SIGTERM/
// Ctrl-C byte/EOF), so the caller's digest-state write is skipped on abort.
export async function runDigestLoop(opts: {
  input: NodeJS.ReadableStream;
  output: (line: string) => void;
  isTTY: boolean;
  queue: readonly DigestItem[];
  onAction: (action: DigestAction) => Promise<DigestActionResult>;
}): Promise<void> {
  const { input, output, isTTY, onAction } = opts;
  const queue = [...opts.queue];
  const stream = input as RawModeStream;
  const setRaw = (mode: boolean): void => {
    if (isTTY && typeof stream.setRawMode === "function") stream.setRawMode(mode);
  };

  const buffered: string[] = [];
  let pending: ((key: string | null) => void) | null = null;
  let closed = false;
  const deliver = (key: string | null): void => {
    if (pending === null) {
      if (key !== null) buffered.push(key);
      return;
    }
    const resolve = pending;
    pending = null;
    resolve(key);
  };
  const onData = (chunk: Buffer | string): void => {
    for (const key of chunk.toString()) deliver(key);
  };
  const onEnd = (): void => {
    closed = true;
    deliver(null);
  };
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    setRaw(false);
    input.off("data", onData);
    input.off("end", onEnd);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = (): void => {
    closed = true;
    cleanup();
    deliver(null);
  };
  const nextKey = (): Promise<string | null> => {
    const key = buffered.shift();
    if (key !== undefined) return Promise.resolve(key);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      pending = resolve;
    });
  };
  const emit = async (action: DigestAction): Promise<DigestActionResult> => {
    const result = await onAction(action);
    for (const line of result.lines) output(line);
    return result;
  };

  input.on("data", onData);
  input.on("end", onEnd);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  setRaw(true);

  let index = 0;
  let lastDecisionIndex: number | null = null;
  try {
    while (index < queue.length) {
      const item = queue[index];
      if (item === undefined) break;
      output(renderItem(item));
      const key = await nextKey();
      // These two aborts are the ONLY thing that can stop the loop once input
      // is gone. If a regression lets `nextKey` resolve without ever yielding
      // to the timer queue, this spins on microtasks and starves timers — so
      // vitest's testTimeout never fires and CI hangs unkillably rather than
      // failing. Any change here must keep an abort reachable on EOF/signal.
      if (key === null || key === CTRL_C) return; // abort: no quit action
      if (key === "y" || key === "n" || key === "s") {
        const kind = key === "y" ? "approve" : key === "n" ? "reject" : "skip";
        const result = await emit({ kind, id: item.entry.id });
        if (result.decided === true) lastDecisionIndex = index;
        index += 1;
      } else if (key === "e") {
        // The editor child owns the TTY: cooked mode, loop detached and
        // paused until the handler (which spawns the editor) returns.
        setRaw(false);
        input.off("data", onData);
        input.pause();
        const result = await emit({ kind: "edit", id: item.entry.id });
        input.on("data", onData);
        input.resume();
        setRaw(true);
        if (result.decided === true) lastDecisionIndex = index;
        index += 1;
      } else if (key === "u") {
        if (lastDecisionIndex === null) {
          output("nothing to undo");
        } else {
          await emit({ kind: "undo" });
          index = lastDecisionIndex;
          lastDecisionIndex = null;
        }
      } else if (key === "a") {
        const result = await emit({ kind: "expandAuto" });
        if (result.insertItems !== undefined && result.insertItems.length > 0) {
          queue.splice(index, 0, ...result.insertItems);
        }
      } else if (key === "q") {
        await emit({ kind: "quit" });
        return;
      } else {
        output(KEY_HELP);
      }
    }
    await emit({ kind: "quit" });
  } finally {
    cleanup();
  }
}
