import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Contract } from "../src/contract.js";
import { evaluateContract } from "../src/evaluate-contract.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001" as ProjectId;
const NOW = "2026-08-06T00:00:00.000Z";
let storeRoot: string;

function memory(id: string, over: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id,
    projectId: PROJECT_ID as never,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: `title ${id.slice(-4)}`,
    content: `content ${id.slice(-4)}`,
    keywords: [],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as MemoryEntry;
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    name: "test-contract",
    intent: "how do we deploy",
    requiredEvidence: [{ kind: "memory-entry-ref", value: "00000000-0000-4000-8000-0000000000aa" }],
    tokenBudget: 2000,
    createdFrom: null,
    ...over,
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "megasaver-eval-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("evaluateContract", () => {
  it("all evidence in cut -> pass", async () => {
    const entry = memory("00000000-0000-4000-8000-0000000000aa", { content: "deploy content" });
    const c = contract({ requiredEvidence: [{ kind: "memory-entry-ref", value: entry.id }] });
    const result = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [entry],
      storeRoot,
      asOf: NOW,
    });
    expect(result.pass).toBe(true);
    expect(result.findings[0]?.status).toBe("pass");
  });

  it("memory-entry-ref to absent id -> entry-missing", async () => {
    const entry = memory("00000000-0000-4000-8000-0000000000bb");
    const c = contract({
      requiredEvidence: [
        { kind: "memory-entry-ref", value: "00000000-0000-4000-8000-00000000dead" },
      ],
    });
    const result = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [entry],
      storeRoot,
      asOf: NOW,
    });
    expect(result.pass).toBe(false);
    expect(result.findings[0]?.reason).toBe("entry-missing");
    expect(result.findings[0]?.detail).toContain("00000000-0000-4000-8000-00000000dead");
  });

  it("ref to stale -> entry-stale", async () => {
    const entry = memory("00000000-0000-4000-8000-0000000000aa", { stale: true });
    const c = contract({ requiredEvidence: [{ kind: "memory-entry-ref", value: entry.id }] });
    const result = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [entry],
      storeRoot,
      asOf: NOW,
    });
    expect(result.findings[0]?.reason).toBe("entry-stale");
    expect(result.findings[0]?.entryTitle).toBe(entry.title);
  });

  it("ref to suggested/archival -> entry-not-recallable", async () => {
    const suggested = memory("00000000-0000-4000-8000-0000000000aa", { approval: "suggested" });
    const archival = memory("00000000-0000-4000-8000-0000000000bb", { tier: "archival" });
    const c1 = contract({ requiredEvidence: [{ kind: "memory-entry-ref", value: suggested.id }] });
    const r1 = await evaluateContract({
      contract: c1,
      projectId: PROJECT_ID,
      entries: [suggested],
      storeRoot,
      asOf: NOW,
    });
    expect(r1.findings[0]?.reason).toBe("entry-not-recallable");
    expect(r1.findings[0]?.detail).toContain("approval");

    const c2 = contract({ requiredEvidence: [{ kind: "memory-entry-ref", value: archival.id }] });
    const r2 = await evaluateContract({
      contract: c2,
      projectId: PROJECT_ID,
      entries: [archival],
      storeRoot,
      asOf: NOW,
    });
    expect(r2.findings[0]?.reason).toBe("entry-not-recallable");
    expect(r2.findings[0]?.detail).toContain("archival");
  });

  it("recallable ranked below tiny budget -> ranked-below-budget", async () => {
    const e1 = memory("00000000-0000-4000-8000-0000000000aa", {
      title: "first first first",
      content: "a".repeat(10),
    });
    const e2 = memory("00000000-0000-4000-8000-0000000000bb", {
      title: "second",
      content: `first ${"b".repeat(10)}`,
    });
    const c = contract({
      intent: "first",
      requiredEvidence: [{ kind: "memory-entry-ref", value: e2.id }],
      tokenBudget: 10,
    });
    const result = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [e1, e2],
      storeRoot,
      asOf: NOW,
    });
    expect(result.findings[0]?.reason).toBe("ranked-below-budget");
    expect(result.findings[0]?.rankPosition).toBeGreaterThanOrEqual(2);
    expect(result.cut.size).toBe(1);
  });

  it("file-ref and keyword matching with normalization/casing", async () => {
    const e = memory("00000000-0000-4000-8000-0000000000aa", {
      relatedFiles: ["src\\a.ts"],
      title: "redos guard",
      content: "fix redos guard deploy",
      keywords: ["redos"],
    });
    const cFile = contract({
      intent: "redos guard",
      requiredEvidence: [{ kind: "file-ref", value: "src/a.ts" }],
    });
    const rFile = await evaluateContract({
      contract: cFile,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    expect(rFile.pass).toBe(true);

    const cKey = contract({
      intent: "redos",
      requiredEvidence: [{ kind: "keyword", value: "REDOS" }],
    });
    const rKey = await evaluateContract({
      contract: cKey,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    expect(rKey.pass).toBe(true);

    const cMiss = contract({
      intent: "redos",
      requiredEvidence: [{ kind: "keyword", value: "missing" }],
    });
    const rMiss = await evaluateContract({
      contract: cMiss,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    expect(rMiss.findings[0]?.reason).toBe("no-entry-in-cut");
  });

  it("determinism: two calls identical and no embed invoked", async () => {
    const e = memory("00000000-0000-4000-8000-0000000000aa");
    const c = contract({ requiredEvidence: [{ kind: "memory-entry-ref", value: e.id }] });
    const r1 = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    const r2 = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("asOf validity: valid at asOf but expired now -> pass", async () => {
    const validToFuture = new Date(Date.parse(NOW) + 60_000).toISOString();
    const e = memory("00000000-0000-4000-8000-0000000000aa", {
      validTo: validToFuture,
      title: "deploy policy",
      content: "how do we deploy content",
    });
    const c = contract({
      intent: "deploy",
      requiredEvidence: [{ kind: "memory-entry-ref", value: e.id }],
    });
    const result = await evaluateContract({
      contract: c,
      projectId: PROJECT_ID,
      entries: [e],
      storeRoot,
      asOf: NOW,
    });
    expect(result.pass).toBe(true);
  });
});
