import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../src/memory-entry.js";
import { buildPrMemoryComment } from "../src/pr-memory-comment.js";

const MEMORY_ENTRY_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMORY_ENTRY_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const CREATED_AT = "2026-06-12T10:00:00.000Z";

function makeEntry(overrides: Omit<Partial<MemoryEntry>, "id"> & { id: string }): MemoryEntry {
  return {
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use JWT middleware for protected routes",
    content: "Decided to use JWT for all protected API routes.",
    keywords: ["jwt", "auth"],
    confidence: "high",
    source: "manual",
    approval: "approved",
    stale: false,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
    id: overrides.id as MemoryEntryId,
  };
}

describe("buildPrMemoryComment", () => {
  it("produces a stable markdown string for two entries", () => {
    const memories = [
      makeEntry({
        id: MEMORY_ENTRY_ID_1,
        type: "decision",
        confidence: "high",
        title: "Use JWT for auth",
        content: "All protected routes use JWT middleware.",
      }),
      makeEntry({
        id: MEMORY_ENTRY_ID_2,
        type: "architecture",
        confidence: "medium",
        title: "ESM modules throughout",
        content: "Repo uses strict ESM.",
      }),
    ];
    const result = buildPrMemoryComment(memories, { projectName: "MyProject" });
    expect(result).toContain("## Mega Saver — relevant project memory");
    expect(result).toContain("Project: `MyProject`");
    expect(result).toContain("**decision** (high): Use JWT for auth");
    expect(result).toContain("All protected routes use JWT middleware.");
    expect(result).toContain("**architecture** (medium): ESM modules throughout");
    expect(result).toContain("Repo uses strict ESM.");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("empty list produces the no-relevant-memory line", () => {
    const result = buildPrMemoryComment([], { projectName: "Empty" });
    expect(result).toContain("No relevant approved project memory.");
    expect(result).not.toContain("**");
  });

  it("escapes backticks and pipes in fields", () => {
    const entry = makeEntry({
      id: MEMORY_ENTRY_ID_1,
      title: "Use `pipe|trick`",
      content: "Content with `backtick` and |pipe|.",
    });
    const result = buildPrMemoryComment([entry], { projectName: "Proj" });
    expect(result).toContain("Use \\`pipe\\|trick\\`");
    expect(result).toContain("Content with \\`backtick\\` and \\|pipe\\|.");
  });

  it("collapses newlines so a field cannot inject a heading or list line", () => {
    const entry = makeEntry({
      id: MEMORY_ENTRY_ID_1,
      title: "Innocent",
      content: "line one\n## Injected\nline two",
    });
    const result = buildPrMemoryComment([entry], { projectName: "Proj" });
    // The injected text survives as inline content, never as its own line.
    expect(result).not.toContain("\n## Injected");
    expect(result).toContain("line one ## Injected line two");
    // Only the real heading line begins with `## `.
    const headingLines = result.split("\n").filter((l) => l.startsWith("## "));
    expect(headingLines).toEqual(["## Mega Saver — relevant project memory"]);
  });

  it("HTML-encodes script tags so raw HTML cannot be injected", () => {
    const entry = makeEntry({
      id: MEMORY_ENTRY_ID_1,
      title: "XSS attempt",
      content: "<script>alert(1)</script>",
    });
    const result = buildPrMemoryComment([entry], { projectName: "Proj" });
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
    expect(result).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("HTML-encodes ampersand and angle brackets, encoding & first", () => {
    const entry = makeEntry({
      id: MEMORY_ENTRY_ID_1,
      title: "Comparison",
      content: "a < b && c > d",
    });
    const result = buildPrMemoryComment([entry], { projectName: "Proj" });
    expect(result).toContain("a &lt; b &amp;&amp; c &gt; d");
    // No double-encoding: encoding & first must not turn &lt; into &amp;lt;.
    expect(result).not.toContain("&amp;lt;");
    expect(result).not.toContain("&amp;gt;");
  });

  it("sanitizes a heading override against structure injection", () => {
    const result = buildPrMemoryComment([], {
      projectName: "P",
      heading: "Pwned\n## Real Heading",
    });
    expect(result).not.toContain("\n## Real Heading");
    const headingLines = result.split("\n").filter((l) => l.startsWith("## "));
    expect(headingLines).toEqual(["## Pwned ## Real Heading"]);
  });

  it("includes task line when task is provided", () => {
    const result = buildPrMemoryComment([], { projectName: "P", task: "auth refactor" });
    expect(result).toContain("Task: auth refactor");
  });

  it("omits task line when task is empty string", () => {
    const result = buildPrMemoryComment([], { projectName: "P", task: "" });
    expect(result).not.toContain("Task:");
  });

  it("uses custom heading when provided", () => {
    const result = buildPrMemoryComment([], { projectName: "P", heading: "Custom Heading" });
    expect(result).toContain("## Custom Heading");
    expect(result).not.toContain("Mega Saver");
  });

  it("renders relatedFiles when present", () => {
    const entry = makeEntry({
      id: MEMORY_ENTRY_ID_1,
      relatedFiles: ["src/auth.ts", "src/middleware.ts"],
    });
    const result = buildPrMemoryComment([entry], { projectName: "P" });
    expect(result).toContain("`src/auth.ts`");
    expect(result).toContain("`src/middleware.ts`");
  });

  it("is deterministic — two calls with same input produce identical output", () => {
    const memories = [makeEntry({ id: MEMORY_ENTRY_ID_1 }), makeEntry({ id: MEMORY_ENTRY_ID_2 })];
    const opts = { projectName: "DeterministicProject", task: "some task" };
    expect(buildPrMemoryComment(memories, opts)).toBe(buildPrMemoryComment(memories, opts));
  });
});
