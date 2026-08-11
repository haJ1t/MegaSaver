import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordContractRun } from "../src/commands/contracts/record.js";

let storeRoot: string;
const PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-08-06T00:00:00.000Z";

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "contracts-record-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("recordContractRun", () => {
  it("first call creates file with one line per contract", () => {
    const ok = recordContractRun({
      storeRoot,
      projectId: PROJECT_ID,
      at: NOW,
      results: [
        {
          name: "a",
          pass: true,
          findings: [],
          cut: { size: 1, tokenEstimate: 10, rankedTotal: 1 },
        } as never,
        {
          name: "b",
          pass: false,
          findings: [{ status: "fail", reason: "entry-missing" } as never],
          cut: { size: 0, tokenEstimate: 0, rankedTotal: 0 },
        } as never,
      ],
    });
    expect(ok).toBe(true);
    const path = join(storeRoot, "contract-runs", `${PROJECT_ID}.jsonl`);
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).name).toBe("a");
    expect(JSON.parse(lines[1] as string).pass).toBe(false);
  });

  it("second call appends", () => {
    recordContractRun({
      storeRoot,
      projectId: PROJECT_ID,
      at: NOW,
      results: [
        {
          name: "a",
          pass: true,
          findings: [],
          cut: { size: 1, tokenEstimate: 10, rankedTotal: 1 },
        } as never,
      ],
    });
    recordContractRun({
      storeRoot,
      projectId: PROJECT_ID,
      at: NOW,
      results: [
        {
          name: "b",
          pass: true,
          findings: [],
          cut: { size: 1, tokenEstimate: 10, rankedTotal: 1 },
        } as never,
      ],
    });
    const lines = readFileSync(join(storeRoot, "contract-runs", `${PROJECT_ID}.jsonl`), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
  });

  it("with fresh lock returns false and file unchanged", () => {
    const lockPath = join(storeRoot, "contract-runs", `${PROJECT_ID}.jsonl.lock`);
    const filePath = join(storeRoot, "contract-runs", `${PROJECT_ID}.jsonl`);
    // create a fresh lock file to simulate contention
    mkdirSync(join(storeRoot, "contract-runs"), { recursive: true });
    writeFileSync(lockPath, "locked", "utf8");
    // Make lock appear fresh by not being stale (withFileLock checks staleMs 30s, deadline 50ms)
    // Our record should return false when lock is held
    const ok = recordContractRun({
      storeRoot,
      projectId: PROJECT_ID,
      at: NOW,
      results: [
        {
          name: "a",
          pass: true,
          findings: [],
          cut: { size: 1, tokenEstimate: 10, rankedTotal: 1 },
        } as never,
      ],
      deadlineMs: 50,
    });
    expect(ok).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });
});
