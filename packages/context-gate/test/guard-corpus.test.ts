// packages/context-gate/test/guard-corpus.test.ts
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GUARD_CORPUS_MAX,
  appendGuardCorpusRow,
  captureGuardCorpusRow,
  readGuardCorpus,
} from "../src/guard-corpus.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-guardcorpus-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: crypto.randomUUID(),
    command: "pnpm vitest --shard 2",
    errorOutput: "Error: unknown option '--shard'",
    wastedTokens: 4200,
    createdAt: NOW,
    ...over,
  } as never;
}

describe("guard corpus", () => {
  it("returns [] when nothing recorded", () => {
    expect(readGuardCorpus(root, PROJECT_ID)).toEqual([]);
  });

  it("round-trips an appended row", () => {
    appendGuardCorpusRow(root, PROJECT_ID, row({ id: "11111111-1111-4111-8111-000000000001" }));
    const rows = readGuardCorpus(root, PROJECT_ID);
    expect(rows.length).toBe(1);
    expect(rows[0]?.command).toBe("pnpm vitest --shard 2");
    expect(rows[0]?.wastedTokens).toBe(4200);
  });

  it("keeps only the newest GUARD_CORPUS_MAX rows", () => {
    for (let i = 0; i < GUARD_CORPUS_MAX + 1; i += 1) {
      appendGuardCorpusRow(root, PROJECT_ID, row({ command: `cmd-${i}` }));
    }
    const rows = readGuardCorpus(root, PROJECT_ID);
    expect(rows.length).toBe(GUARD_CORPUS_MAX);
    expect(rows[0]?.command).toBe("cmd-1"); // cmd-0 evicted
  });

  it("skips torn/garbage lines instead of crashing", () => {
    appendGuardCorpusRow(root, PROJECT_ID, row());
    appendFileSync(join(root, "guard", `${PROJECT_ID}.failures.jsonl`), "{torn\n");
    expect(readGuardCorpus(root, PROJECT_ID).length).toBe(1);
  });

  it("rejects a schema-invalid row (negative wastedTokens)", () => {
    expect(() => appendGuardCorpusRow(root, PROJECT_ID, row({ wastedTokens: -1 }))).toThrow();
  });

  it("captureGuardCorpusRow computes wastedTokens from the raw output", () => {
    captureGuardCorpusRow({
      storeRoot: root,
      projectId: PROJECT_ID,
      command: "tsc -b",
      errorOutput: "error TS2322",
      raw: "x".repeat(400), // estimateTokens = ceil(400/4) = 100
      now: NOW,
    });
    expect(readGuardCorpus(root, PROJECT_ID)[0]?.wastedTokens).toBe(100);
  });
});
