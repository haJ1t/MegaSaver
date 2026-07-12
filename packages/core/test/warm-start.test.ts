import { estimateTokens } from "@megasaver/output-filter";
import { describe, expect, it } from "vitest";
import { failedAttemptSchema } from "../src/failed-attempt.js";
import { type MemoryEntry, memoryEntrySchema } from "../src/memory-entry.js";
import { projectRuleSchema } from "../src/project-rule.js";
import {
  type WarmStartInput,
  assembleWarmStartBrief,
  selectWarmStartMode,
} from "../src/warm-start.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-07-12T10:00:00.000Z";
const RECENT = "2026-07-11T10:00:00.000Z";

let seq = 0;
function uuid(): string {
  seq += 1;
  const h = String(seq).padStart(4, "0");
  return `33333333-3333-4333-8333-33333333${h.slice(0, 4)}`;
}

function mem(over: Partial<Record<string, unknown>> = {}): MemoryEntry {
  return memoryEntrySchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use JWT middleware",
    content: "Repo uses strict ESM. Second sentence should be clamped away.",
    keywords: ["auth"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: RECENT,
    updatedAt: RECENT,
    ...over,
  });
}

function rule(over: Partial<Record<string, unknown>> = {}) {
  return projectRuleSchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    title: "No default exports",
    rule: "Always use named exports.",
    appliesTo: [],
    evidence: [],
    severity: "warning",
    confidence: "high",
    createdFrom: "manual",
    createdAt: RECENT,
    updatedAt: RECENT,
    ...over,
  });
}

function attempt(over: Partial<Record<string, unknown>> = {}) {
  return failedAttemptSchema.parse({
    id: uuid(),
    projectId: PROJECT_ID,
    sessionId: null,
    task: "parse PDF",
    failedStep: "pdfjs import",
    errorOutput: "ERR_MODULE_NOT_FOUND",
    relatedFiles: ["src/pdf.ts"],
    convertedToRule: false,
    createdAt: RECENT,
    ...over,
  });
}

function baseInput(over: Partial<WarmStartInput> = {}): WarmStartInput {
  return {
    projectName: "demo",
    branch: "main",
    now: NOW,
    lastSeenAt: "2026-07-11T09:00:00.000Z",
    reonboardUnlocked: true,
    timeless: false,
    memories: [],
    rules: [],
    failedAttempts: [],
    gitDelta: null,
    ...over,
  };
}

describe("content filter", () => {
  it("excludes unapproved, archival, stale, and non-current memories", () => {
    const input = baseInput({
      memories: [
        mem({ title: "keep me" }),
        mem({ title: "suggested", approval: "suggested" }),
        mem({ title: "archived", tier: "archival" }),
        mem({ title: "stale one", stale: true }),
        mem({ title: "closed", validTo: "2026-07-01T00:00:00.000Z" }),
      ],
    });
    const brief = assembleWarmStartBrief(input);
    expect(brief.text).toContain("keep me");
    for (const gone of ["suggested", "archived", "stale one", "closed"]) {
      expect(brief.text).not.toContain(gone);
    }
  });
});

describe("budget invariant", () => {
  it("final text never exceeds the budget, even with adversarial inputs", () => {
    const big = "x".repeat(4000);
    const input = baseInput({
      budgetTokens: 500,
      memories: Array.from({ length: 40 }, (_, i) => mem({ title: `huge ${i}`, content: big })),
      rules: Array.from({ length: 20 }, (_, i) => rule({ title: `rule ${i}`, rule: big })),
    });
    const brief = assembleWarmStartBrief(input);
    expect(estimateTokens(brief.text)).toBeLessThanOrEqual(500);
    expect(brief.tokenEstimate).toBe(estimateTokens(brief.text));
  });
});

describe("section priority", () => {
  it("orders header, rules, decisions, todos", () => {
    const input = baseInput({
      memories: [mem({ type: "decision", title: "DEC-A" }), mem({ type: "todo", title: "TODO-A" })],
      rules: [rule({ title: "RULE-A" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t.indexOf("RULE-A")).toBeGreaterThan(t.indexOf("demo"));
    expect(t.indexOf("DEC-A")).toBeGreaterThan(t.indexOf("RULE-A"));
    expect(t.indexOf("TODO-A")).toBeGreaterThan(t.indexOf("DEC-A"));
  });
});

describe("failed attempts vs git delta", () => {
  it("filters to relatedFiles ∩ changedFiles when gitDelta present", () => {
    const input = baseInput({
      failedAttempts: [
        attempt({ task: "touches-changed", relatedFiles: ["src/pdf.ts"] }),
        attempt({ task: "untouched", relatedFiles: ["src/other.ts"] }),
      ],
      gitDelta: { commits: [], changedFiles: [{ path: "src/pdf.ts", churn: 10 }] },
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("touches-changed");
    expect(t).not.toContain("untouched");
  });

  it("falls back to recent attempts when gitDelta is null", () => {
    const input = baseInput({
      failedAttempts: [attempt({ task: "recent-fail" })],
      gitDelta: null,
    });
    expect(assembleWarmStartBrief(input).text).toContain("recent-fail");
  });
});

describe("entity digest", () => {
  it("surfaces top entities by relatedFiles/relatedSymbols frequency", () => {
    const input = baseInput({
      memories: [
        mem({ title: "a", relatedFiles: ["src/auth.ts"] }),
        mem({ title: "b", relatedFiles: ["src/auth.ts"] }),
        mem({ title: "c", relatedSymbols: ["verifyToken"] }),
      ],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("src/auth.ts");
  });
});

describe("determinism", () => {
  it("identical input produces identical output", () => {
    const input = baseInput({ memories: [mem()], rules: [rule()] });
    expect(assembleWarmStartBrief(input)).toEqual(assembleWarmStartBrief(input));
  });
});
