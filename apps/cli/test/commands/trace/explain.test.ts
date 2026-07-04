import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTraceExplain } from "../../../src/commands/trace/explain.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const EMPTY_SESSION = "55555555-5555-4555-8555-555555555555";
const MEM_A = "33333333-3333-4333-8333-333333333333";
const DIGEST = "a".repeat(64);
const TS = "2026-07-04T00:00:00.000Z";

// The reader keys evidence by workspaceKey = FNV-1a(cwd). The CLI has no cwd for
// the session, so the test passes it explicitly via --workspace, exactly as an
// operator would. WK is derived from the store root we seed evidence under.
let root: string;
let WK: string;
const lines: string[] = [];
const stdout = (l: string) => lines.push(l);
const stderr = (l: string) => lines.push(l);

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cli-trace-"));
  WK = encodeWorkspaceKey(root);
  lines.length = 0;
  await initStore(root);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: root,
    createdAt: TS,
    updatedAt: TS,
  } as never);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function env() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined as string | undefined,
    platform: process.platform as NodeJS.Platform,
    localAppData: undefined as string | undefined,
  };
}

function traceLine(chunkSetId: string, memoryBoost: number): string {
  return JSON.stringify({
    sessionId: SESSION,
    projectId: PROJECT_ID,
    toolName: "Read",
    createdAt: TS,
    chunkSetId,
    ranking: {
      classification: { category: "typescript", confidence: 0.7 },
      decision: "compressed",
      compressor: "typescript",
      engineRanking: true,
      rawTokens: 100,
      returnedTokens: 40,
      candidates: [],
      selected: [
        {
          startLine: 1,
          endLine: 10,
          score: 0.9,
          engine: {
            baseRelevance: 0.7,
            memoryBoost,
            failureHistoryBoost: 0,
            finalScore: 0.9,
          },
        },
      ],
      omitted: [
        {
          startLine: 20,
          endLine: 25,
          score: 0.1,
          engine: {
            baseRelevance: 0.1,
            memoryBoost: 0,
            failureHistoryBoost: 0,
            finalScore: 0.1,
          },
        },
      ],
    },
  });
}

function evidenceRecord(
  chunkSetId: string,
  pinnedByMemoryIds: string[],
  highRiskFindings: number,
): Record<string, unknown> {
  return {
    evidenceId: MEM_A,
    workspaceKey: WK,
    sessionRef: { kind: "live", id: SESSION },
    sourceKind: "file",
    sourceRef: { label: "src" },
    classification: "typescript",
    redactionReport: {
      redacted: highRiskFindings > 0,
      highRiskFindings,
      unresolvedHighRisk: false,
    },
    rawDigest: DIGEST,
    returnedDigest: DIGEST,
    redactedRawChunkSetId: chunkSetId,
    returnedChunkRefs: [{ chunkSetId, chunkId: "0" }],
    createdAt: TS,
    expiresAt: null,
    retentionClass: pinnedByMemoryIds.length > 0 ? "pinned" : "session",
    pinnedByMemoryIds,
    status: "available",
    revokedAt: null,
    revocationReason: null,
    policyVersion: "1",
    pipelineVersion: "1",
    transitions: [{ at: TS, kind: "created", actor: "system" }],
  };
}

function seedTrace(): void {
  const traceDir = join(root, "stats", PROJECT_ID, `${SESSION}-traces`);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${traceLine("cs1", 0.2)}\n`);
  const evDir = join(root, "evidence", WK);
  mkdirSync(evDir, { recursive: true });
  writeFileSync(join(evDir, `${MEM_A}.json`), JSON.stringify(evidenceRecord("cs1", [MEM_A], 1)));
}

// A real (post-join-real-pivot) trace: memory ids and redaction are stamped
// INLINE on the trace line, independent of --workspace. No evidence dir is
// written — this is what real writes produce.
function inlineTraceLine(): string {
  const parsed = JSON.parse(traceLine("cs1", 0.2));
  parsed.ranking.rankedByMemoryIds = [MEM_A];
  parsed.redaction = { redacted: true, secretsRedacted: 2 };
  return JSON.stringify(parsed);
}

function seedInlineTrace(): void {
  const traceDir = join(root, "stats", PROJECT_ID, `${SESSION}-traces`);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${inlineTraceLine()}\n`);
}

describe("mega trace explain", () => {
  it("renders the causal chain for a session", async () => {
    seedTrace();
    const code = await runTraceExplain({
      sessionId: SESSION,
      projectName: "demo",
      workspaceFlag: WK,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toMatch(/Read/); // tool name
    expect(out).toMatch(/compressed/); // decision
    expect(out).toMatch(/0\.9/); // selected chunk finalScore
    expect(out).toMatch(/0\.2/); // memoryBoost
    expect(out).toMatch(new RegExp(MEM_A)); // pinned memory id
    expect(out).toMatch(/1 high-risk/); // redaction rendering (real fields)
  });

  it("emits SessionDecisionTrace under --json", async () => {
    seedTrace();
    const code = await runTraceExplain({
      sessionId: SESSION,
      projectName: "demo",
      workspaceFlag: WK,
      ...env(),
      stdout,
      stderr,
      json: true,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.outputs[0].decision).toBe("compressed");
    expect(parsed.outputs[0].memory.rankedByMemoryIds).toEqual([MEM_A]);
  });

  it("prints an honest message and exits 0 when the session has no traces", async () => {
    const code = await runTraceExplain({
      sessionId: EMPTY_SESSION,
      projectName: "demo",
      workspaceFlag: WK,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toMatch(/no decision traces/i);
  });

  it("notes that evidence was not resolved when --workspace is absent", async () => {
    seedTrace();
    const code = await runTraceExplain({
      sessionId: SESSION,
      projectName: "demo",
      workspaceFlag: undefined,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toMatch(/Read/);
    // Honest: without a resolved workspace, evidence is not looked up — never
    // render memory/redaction as "none" when the truth is "not resolved".
    expect(out).toMatch(/evidence workspace not resolved/i);
    expect(out).not.toMatch(new RegExp(MEM_A));
  });

  it("renders inline memory/redaction and omits the note when --workspace is absent", async () => {
    // Real traces carry memory ids + redaction INLINE, independent of --workspace.
    // The note would contradict the rendered data, so it must not appear.
    seedInlineTrace();
    const code = await runTraceExplain({
      sessionId: SESSION,
      projectName: "demo",
      workspaceFlag: undefined,
      ...env(),
      stdout,
      stderr,
    });
    expect(code).toBe(0);
    const out = lines.join("\n");
    expect(out).toMatch(new RegExp(MEM_A)); // inline memory id rendered
    expect(out).toMatch(/redaction: yes \(2 high-risk\)/); // inline redaction rendered
    expect(out).not.toMatch(/evidence workspace not resolved/i); // no contradiction
  });
});
