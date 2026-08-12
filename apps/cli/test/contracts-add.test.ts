import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runContractsAdd } from "../src/commands/contracts/add.js";
import { ensureStoreReady } from "../src/store.js";

let storeRoot: string;
let projectRoot: string;
let contractsDir: string;
const PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const PROJECT_NAME = "contracts-add-demo";
const SESSION_ID = "88888888-8888-4888-8888-888888888888";
const NOW = "2026-08-06T00:00:00.000Z";

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "contracts-add-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "contracts-add-proj-"));
  contractsDir = join(projectRoot, "contracts");
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject({
    id: PROJECT_ID,
    name: PROJECT_NAME,
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createSession({
    id: SESSION_ID,
    projectId: PROJECT_ID,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "fix deploy",
    startedAt: NOW,
    endedAt: null,
  } as never);
  // Create a trace file with rankedByMemoryIds (valid ReplayTrace)
  const traceDir = join(storeRoot, "stats", PROJECT_ID, `${SESSION_ID}-traces`);
  mkdirSync(traceDir, { recursive: true });
  const traceLine = JSON.stringify({
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    toolName: "Read",
    createdAt: NOW,
    ranking: {
      classification: { category: "typescript", confidence: 0.7 },
      decision: "compressed",
      compressor: "typescript",
      engineRanking: true,
      rawTokens: 100,
      returnedTokens: 40,
      candidates: [],
      selected: [],
      omitted: [],
      rankedByMemoryIds: ["00000000-0000-4000-8000-0000000000aa"],
    },
  });
  writeFileSync(join(traceDir, "replay-traces.jsonl"), `${traceLine}\n`);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("mega contracts add", () => {
  it("preview prints schema-valid contract from session title and trace", async () => {
    const out: string[] = [];
    const code = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: false,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.intent).toBe("fix deploy");
    expect(parsed.requiredEvidence[0].value).toBe("00000000-0000-4000-8000-0000000000aa");
    expect(parsed.createdFrom).toBe(SESSION_ID);
    expect(existsSync(join(contractsDir, "fix-deploy.contract.json"))).toBe(false);
  });

  it("--write persists and second --write without --force fails, with --force overwrites", async () => {
    await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: true,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
    });
    expect(existsSync(join(contractsDir, "fix-deploy.contract.json"))).toBe(true);
    const err: string[] = [];
    const code2 = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: true,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code2).toBe(1);
    expect(err.join("\n")).toContain("exists");
    const code3 = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: true,
      forceFlag: true,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: () => {},
    });
    expect(code3).toBe(0);
  });

  it("explicit --evidence-keyword overrides trace", async () => {
    const out: string[] = [];
    await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: "custom intent",
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: "build,deploy",
      dirFlag: contractsDir,
      writeFlag: false,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    const parsed = JSON.parse(out.join(""));
    expect(parsed.requiredEvidence).toEqual([
      { kind: "keyword", value: "build" },
      { kind: "keyword", value: "deploy" },
    ]);
  });

  it("session without title and no --intent -> exit 1", async () => {
    const { registry } = await ensureStoreReady(storeRoot);
    const sid2 = "99999999-9999-4999-8999-999999999999";
    registry.createSession({
      id: sid2,
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
      title: null,
      startedAt: NOW,
      endedAt: null,
    } as never);
    const err: string[] = [];
    const code = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: sid2,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: false,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--intent");
  });

  it("no trace and no --evidence-* -> exit 1", async () => {
    rmSync(join(storeRoot, "stats", PROJECT_ID, `${SESSION_ID}-traces`), {
      recursive: true,
      force: true,
    });
    const err: string[] = [];
    const code = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: SESSION_ID,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: false,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("--evidence");
  });

  it("session belonging to different project -> exit 1", async () => {
    const otherPid = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const { registry } = await ensureStoreReady(storeRoot);
    registry.createProject({
      id: otherPid,
      name: "other",
      rootPath: `${projectRoot}-other`,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    const otherSid = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    registry.createSession({
      id: otherSid,
      projectId: otherPid,
      agentId: "claude-code",
      riskLevel: "medium",
      title: "other title",
      startedAt: NOW,
      endedAt: null,
    } as never);
    const err: string[] = [];
    const code = await runContractsAdd({
      projectName: PROJECT_NAME,
      sessionFlag: otherSid,
      nameFlag: undefined,
      intentFlag: undefined,
      budgetFlag: undefined,
      evidenceMemoryFlag: undefined,
      evidenceFileFlag: undefined,
      evidenceKeywordFlag: undefined,
      dirFlag: contractsDir,
      writeFlag: false,
      forceFlag: false,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
  });
});
