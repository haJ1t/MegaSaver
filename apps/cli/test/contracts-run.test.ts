import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runContractsRun } from "../src/commands/contracts/run.js";
import { ensureStoreReady } from "../src/store.js";

let storeRoot: string;
let projectRoot: string;
let contractsDir: string;
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const PROJECT_NAME = "contracts-demo";
const NOW = "2026-08-06T00:00:00.000Z";

function makeProject() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    rootPath: projectRoot,
    createdAt: NOW,
    updatedAt: NOW,
  } as never;
}

beforeEach(async () => {
  storeRoot = mkdtempSync(join(tmpdir(), "contracts-run-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "contracts-run-proj-"));
  contractsDir = join(projectRoot, "contracts");
  mkdirSync(contractsDir, { recursive: true });
  const { registry } = await ensureStoreReady(storeRoot);
  registry.createProject(makeProject());
  registry.createMemoryEntry({
    id: "00000000-0000-4000-8000-0000000000aa",
    projectId: PROJECT_ID as never,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "deploy policy",
    content: "use blue-green deploys",
    keywords: ["deploy"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("mega contracts run", () => {
  it("passing contract -> PASS and exit 0", async () => {
    writeFileSync(
      join(contractsDir, "deploy.contract.json"),
      JSON.stringify({
        name: "deploy",
        intent: "how do we deploy",
        requiredEvidence: [
          { kind: "memory-entry-ref", value: "00000000-0000-4000-8000-0000000000aa" },
        ],
        tokenBudget: 2000,
        createdFrom: null,
      }),
    );
    const out: string[] = [];
    const code = await runContractsRun({
      projectName: PROJECT_NAME,
      dirFlag: contractsDir,
      contractFlag: undefined,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => NOW,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("PASS deploy");
  });

  it("failing stale -> FAIL with reason and repair hint, exit 1", async () => {
    const { registry } = await ensureStoreReady(storeRoot);
    const staleId = "00000000-0000-4000-8000-0000000000bb";
    registry.createMemoryEntry({
      id: staleId as never,
      projectId: PROJECT_ID as never,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "stale entry",
      content: "stale content deploy",
      keywords: [],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    writeFileSync(
      join(contractsDir, "stale.contract.json"),
      JSON.stringify({
        name: "stale",
        intent: "stale content",
        requiredEvidence: [{ kind: "memory-entry-ref", value: staleId }],
        tokenBudget: 2000,
        createdFrom: null,
      }),
    );
    const out: string[] = [];
    const code = await runContractsRun({
      projectName: PROJECT_NAME,
      dirFlag: contractsDir,
      contractFlag: undefined,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => NOW,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(1);
    const txt = out.join("\n");
    expect(txt).toContain("FAIL stale");
    expect(txt).toContain("entry-stale");
    expect(txt).toContain("repair:");
    expect(txt).toContain("mega memory update");
  });

  it("--json emits single line and byte-identical across two runs", async () => {
    writeFileSync(
      join(contractsDir, "deploy.contract.json"),
      JSON.stringify({
        name: "deploy",
        intent: "how do we deploy",
        requiredEvidence: [
          { kind: "memory-entry-ref", value: "00000000-0000-4000-8000-0000000000aa" },
        ],
        tokenBudget: 2000,
        createdFrom: null,
      }),
    );
    const runOnce = async () => {
      const out: string[] = [];
      await runContractsRun({
        projectName: PROJECT_NAME,
        dirFlag: contractsDir,
        contractFlag: undefined,
        jsonFlag: true,
        storeFlag: storeRoot,
        cwd: projectRoot,
        home: tmpdir(),
        xdgDataHome: undefined,
        platform: "linux" as NodeJS.Platform,
        localAppData: undefined,
        now: () => NOW,
        stdout: (l) => out.push(l),
        stderr: () => {},
      });
      return out.join("");
    };
    const a = await runOnce();
    const b = await runOnce();
    expect(a).toBe(b);
    const parsed = JSON.parse(a);
    expect(parsed.pass).toBe(true);
    expect(parsed.contracts[0].name).toBe("deploy");
  });

  it("malformed contract -> exit 1 naming file", async () => {
    writeFileSync(join(contractsDir, "bad.contract.json"), "{ not json");
    const err: string[] = [];
    const code = await runContractsRun({
      projectName: PROJECT_NAME,
      dirFlag: contractsDir,
      contractFlag: undefined,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => NOW,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("bad.contract.json");
  });

  it("empty/missing dir -> no contracts found exit 0", async () => {
    rmSync(contractsDir, { recursive: true, force: true });
    const out: string[] = [];
    const code = await runContractsRun({
      projectName: PROJECT_NAME,
      dirFlag: contractsDir,
      contractFlag: undefined,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => NOW,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no contracts found");
  });

  it("unknown project -> exit 1", async () => {
    writeFileSync(
      join(contractsDir, "x.contract.json"),
      JSON.stringify({
        name: "x",
        intent: "hi",
        requiredEvidence: [{ kind: "keyword", value: "hi" }],
        tokenBudget: 2000,
        createdFrom: null,
      }),
    );
    const err: string[] = [];
    const code = await runContractsRun({
      projectName: "nope",
      dirFlag: contractsDir,
      contractFlag: undefined,
      jsonFlag: false,
      storeFlag: storeRoot,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined,
      now: () => NOW,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("nope");
  });
});
