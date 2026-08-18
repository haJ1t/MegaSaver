import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTokenBudgets, tokenBudgetsStatus, writeTokenBudgets } from "@megasaver/core";
import { appendProxyUsage } from "@megasaver/llm-proxy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBudgetClear, runBudgetSet, runBudgetStatus } from "../../src/commands/budget.js";

const CWD = "/test/workspace/repo";
const WK = encodeWorkspaceKey(CWD);
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-budget-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function collectIo(): {
  stdoutLines: string[];
  stderrLines: string[];
  stdout: (s: string) => void;
  stderr: (s: string) => void;
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    stdoutLines,
    stderrLines,
    stdout: (s: string) => stdoutLines.push(s),
    stderr: (s: string) => stderrLines.push(s),
  };
}

function seedOverlayEvent(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
  returnedTokens?: number,
): void {
  const dir = join(storeRoot, "stats", workspaceKey);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${liveSessionId}.events.jsonl`);
  const full = {
    id: `ove-${Math.random()}`,
    liveSessionId,
    workspaceKey,
    createdAt: "2026-08-06T10:00:00.000+00:00",
    sourceKind: "command",
    label: "test",
    rawBytes: 1000,
    returnedBytes: 100,
    bytesSaved: 900,
    savingRatio: 0.9,
    summary: "s",
    ...(returnedTokens !== undefined ? { returnedTokens } : {}),
  };
  appendFileSync(p, `${JSON.stringify(full)}\n`);
}

describe("mega budget CLI handlers", () => {
  describe("runBudgetSet", () => {
    it("sets sessionDefault on bare invocation", () => {
      const io = collectIo();
      const code = runBudgetSet({
        storeRoot: root,
        cwd: CWD,
        tokens: "500000",
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const b = readTokenBudgets(root, WK);
      expect(b?.sessionDefault).toBe(500000);
      expect(io.stdoutLines.join("\n")).toContain("500000");
    });

    it("sets session limit with --session", () => {
      const io = collectIo();
      const code = runBudgetSet({
        storeRoot: root,
        cwd: CWD,
        tokens: "100000",
        session: "live-1",
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const b = readTokenBudgets(root, WK);
      expect(b?.sessions["live-1"]).toBe(100000);
    });

    it("sets task limit with --task", () => {
      const io = collectIo();
      const code = runBudgetSet({
        storeRoot: root,
        cwd: CWD,
        tokens: "200000",
        task: "refactor-auth",
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const b = readTokenBudgets(root, WK);
      expect(b?.tasks["refactor-auth"]).toBe(200000);
    });

    it("sets task limit AND attaches label with --task + --session", () => {
      const io = collectIo();
      const code = runBudgetSet({
        storeRoot: root,
        cwd: CWD,
        tokens: "200000",
        task: "refactor-auth",
        session: "live-1",
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const b = readTokenBudgets(root, WK);
      expect(b?.tasks["refactor-auth"]).toBe(200000);
      expect(b?.labels["live-1"]).toBe("refactor-auth");
    });

    it("rejects non-positive and dollar amounts", () => {
      for (const val of ["0", "-5", "abc", "$20"]) {
        const io = collectIo();
        const code = runBudgetSet({
          storeRoot: root,
          cwd: CWD,
          tokens: val,
          stdout: io.stdout,
          stderr: io.stderr,
        });
        expect(code).toBe(1);
        if (val === "$20") {
          expect(io.stderrLines.join("\n")).toContain("mega savings budget");
        }
      }
    });

    it("fails when budgets.json is corrupt and hints mega budget clear", () => {
      mkdirSync(join(root, "stats", WK, "budget"), { recursive: true });
      writeFileSync(join(root, "stats", WK, "budget", "budgets.json"), "invalid");
      const io = collectIo();
      const code = runBudgetSet({
        storeRoot: root,
        cwd: CWD,
        tokens: "500000",
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(1);
      expect(io.stderrLines.join("\n")).toContain("mega budget clear");
    });
  });

  describe("runBudgetStatus", () => {
    it("shows helpful guidance when empty", async () => {
      const io = collectIo();
      const code = await runBudgetStatus({
        storeRoot: root,
        cwd: CWD,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      expect(io.stdoutLines.join("\n")).toContain("mega budget set");
    });

    it("renders session progress, coverage, and variance", async () => {
      writeTokenBudgets(root, WK, {
        version: 1,
        sessions: {},
        tasks: { auth: 1000 },
        labels: {
          "live-1": "auth",
          "live-2": "auth",
          "live-3": "auth",
          "live-4": "auth",
        },
      });
      seedOverlayEvent(root, WK, "live-2", 40);
      seedOverlayEvent(root, WK, "live-3", 50);
      seedOverlayEvent(root, WK, "live-4", 48);
      // live-1: 3 measured events (850 tokens) + 1 unmeasured event
      seedOverlayEvent(root, WK, "live-1", 500);
      seedOverlayEvent(root, WK, "live-1", 350);
      seedOverlayEvent(root, WK, "live-1", undefined);

      const io = collectIo();
      const code = await runBudgetStatus({
        storeRoot: root,
        cwd: CWD,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const out = io.stdoutLines.join("\n");
      expect(out).toContain("850/1000");
      expect(out).toContain("85%");
      expect(out).toContain("coverage 2/3");
    });

    it("includes proxy receipt block when usage.jsonl exists", async () => {
      await appendProxyUsage({
        storeRoot: root,
        event: {
          id: "px-1",
          ts: "2026-08-06T10:00:00.000Z",
          model: "claude-3-5-sonnet",
          inputTokens: 100,
          outputTokens: 200,
          cacheReadTokens: 50,
          cacheCreationTokens: 10,
          messageCount: 1,
          stream: true,
        },
      });
      const io = collectIo();
      const code = await runBudgetStatus({
        storeRoot: root,
        cwd: CWD,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const out = io.stdoutLines.join("\n");
      expect(out).toContain("store-wide, not session-scoped (F33)");
    });

    it("--json emits structured payload", async () => {
      writeTokenBudgets(root, WK, {
        version: 1,
        sessionDefault: 1000,
        sessions: {},
        tasks: {},
        labels: {},
      });
      const io = collectIo();
      const code = await runBudgetStatus({
        storeRoot: root,
        cwd: CWD,
        json: true,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      const parsed = JSON.parse(io.stdoutLines[0] ?? "{}");
      expect(parsed.budgets.sessionDefault).toBe(1000);
      expect(Array.isArray(parsed.sessions)).toBe(true);
    });
  });

  describe("runBudgetClear", () => {
    it("clears budgets and reports absent", () => {
      writeTokenBudgets(root, WK, {
        version: 1,
        sessionDefault: 1000,
        sessions: {},
        tasks: {},
        labels: {},
      });
      const io = collectIo();
      const code = runBudgetClear({
        storeRoot: root,
        cwd: CWD,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      expect(code).toBe(0);
      expect(tokenBudgetsStatus(root, WK)).toBe("absent");
    });
  });
});
