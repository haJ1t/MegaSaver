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

describe("mode selection", () => {
  it("null lastSeenAt -> standard", () => {
    expect(selectWarmStartMode(NOW, null)).toBe("standard");
  });
  it("boundaries: <4h micro, 4h-14d standard, >14d reonboard", () => {
    expect(selectWarmStartMode(NOW, "2026-07-12T07:00:00.000Z")).toBe("micro"); // 3h
    expect(selectWarmStartMode(NOW, "2026-07-12T06:00:00.000Z")).toBe("standard"); // exactly 4h
    expect(selectWarmStartMode(NOW, "2026-07-01T10:00:00.000Z")).toBe("standard"); // 11d
    expect(selectWarmStartMode(NOW, "2026-06-28T10:00:00.000Z")).toBe("standard"); // exactly 14d
    expect(selectWarmStartMode(NOW, "2026-06-28T09:59:59.000Z")).toBe("reonboard"); // 14d + 1s
  });
});

describe("micro mode", () => {
  it("hard 300 budget overrides a larger --budget", () => {
    const input = baseInput({
      lastSeenAt: "2026-07-12T09:00:00.000Z", // 1h -> micro
      budgetTokens: 8000,
      rules: Array.from({ length: 20 }, (_, i) =>
        rule({ title: `rule ${i}`, rule: "y".repeat(500) }),
      ),
    });
    const brief = assembleWarmStartBrief(input);
    expect(brief.mode).toBe("micro");
    expect(estimateTokens(brief.text)).toBeLessThanOrEqual(300);
  });

  it("explicit mode override escapes the micro clamp", () => {
    const input = baseInput({ lastSeenAt: "2026-07-12T09:00:00.000Z", mode: "standard" });
    expect(assembleWarmStartBrief(input).mode).toBe("standard");
  });

  it("micro carries no decisions/failures/git sections", () => {
    const input = baseInput({
      lastSeenAt: "2026-07-12T09:00:00.000Z",
      memories: [mem({ type: "decision", title: "DEC-HIDDEN" })],
      gitDelta: { commits: [{ sha: "abc1234", subject: "wip", date: NOW }], changedFiles: [] },
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).not.toContain("DEC-HIDDEN");
    expect(t).not.toContain("abc1234");
  });
});

describe("reonboard mode", () => {
  const AWAY_SINCE = "2026-06-01T00:00:00.000Z"; // 41d -> reonboard

  it("surfaces a memory whose validTo fell inside the absence window", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      memories: [mem({ title: "npm decision", validTo: "2026-06-15T00:00:00.000Z" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("Changed while you were away");
    expect(t).toContain("npm decision");
  });

  it("surfaces rules added since (createdAt in window)", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      rules: [rule({ title: "fresh rule", createdAt: "2026-06-20T00:00:00.000Z" })],
    });
    expect(assembleWarmStartBrief(input).text).toContain("new rule: fresh rule");
  });

  it("free tier gets the full standard body plus one upsell line", () => {
    const input = baseInput({
      lastSeenAt: AWAY_SINCE,
      reonboardUnlocked: false,
      memories: [mem({ type: "decision", title: "DEC-VISIBLE" })],
    });
    const t = assembleWarmStartBrief(input).text;
    expect(t).toContain("DEC-VISIBLE"); // standard body intact
    expect(t).toContain("Pro: expanded absence diff");
    expect(t).not.toContain("Changed while you were away");
  });
});

describe("timeless (sentinel-block) variant", () => {
  it("omits branch/visit header detail and git sections, keeps rules+decisions+todos+failures", () => {
    const input = baseInput({
      timeless: true,
      memories: [mem({ type: "decision", title: "DEC-T" })],
      rules: [rule({ title: "RULE-T" })],
      failedAttempts: [attempt({ task: "FAIL-T" })],
      gitDelta: { commits: [{ sha: "abc1234", subject: "wip", date: NOW }], changedFiles: [] },
    });
    const t = assembleWarmStartBrief(input).text;
    for (const want of ["DEC-T", "RULE-T", "FAIL-T"]) expect(t).toContain(want);
    expect(t).not.toContain("abc1234");
    expect(t).not.toContain("last visit");
  });
});

describe("changedFrom suffix", () => {
  it("successor line carries (was: ...) when its predecessor is closed", () => {
    const predecessor = mem({
      title: "use npm",
      content: "Use npm for installs.",
      validTo: "2026-07-01T00:00:00.000Z",
    });
    const successor = mem({
      title: "use pnpm",
      content: "Use pnpm for installs.",
      supersedesId: predecessor.id,
    });
    const brief = assembleWarmStartBrief(baseInput({ memories: [predecessor, successor] }));
    expect(brief.text).toContain('(was: "use npm" until 2026-07-01)');
    // The closed predecessor's OWN line must not render (its title still
    // appears inside the successor's suffix, so match the line prefix).
    expect(brief.text).not.toContain("- [decision] use npm —");
  });

  it("suppresses the suffix when the predecessor is reopened (validTo null)", () => {
    const predecessor = mem({ title: "use npm", validTo: null });
    const successor = mem({ title: "use pnpm", supersedesId: predecessor.id });
    const brief = assembleWarmStartBrief(baseInput({ memories: [predecessor, successor] }));
    expect(brief.text).not.toContain("(was:");
  });

  it("budget invariant holds with the longer suffixed lines", () => {
    const big = "x".repeat(4000);
    const memories: MemoryEntry[] = [];
    for (let i = 0; i < 20; i += 1) {
      const predecessor = mem({
        title: `old title ${i} ${"y".repeat(200)}`,
        validTo: "2026-07-01T00:00:00.000Z",
      });
      const successor = mem({ title: `new ${i}`, content: big, supersedesId: predecessor.id });
      memories.push(predecessor, successor);
    }
    const brief = assembleWarmStartBrief(baseInput({ budgetTokens: 500, memories }));
    expect(estimateTokens(brief.text)).toBeLessThanOrEqual(500);
    expect(brief.tokenEstimate).toBe(estimateTokens(brief.text));
  });
});
