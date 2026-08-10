import { describe, expect, it } from "vitest";
import { parsePlannerCardMarkdown, serializePlannerCardMarkdown } from "../src/planner/parser.js";

describe("planner card schema and markdown parser", () => {
  it("parses valid frontmatter and markdown body correctly", () => {
    const raw = `---
id: "task-01"
title: "Build Kanban Board"
status: "todo"
priority: "high"
tags: ["gui"]
assignedAgent: "builder"
createdAt: "2026-08-07T10:00:00.000Z"
updatedAt: "2026-08-07T10:00:00.000Z"
---
## Description
- [x] Done item
- [ ] Pending item`;

    const parsed = parsePlannerCardMarkdown(raw, ".megasaver/planner/todo/task-01.md", "todo");
    expect(parsed.id).toBe("task-01");
    expect(parsed.title).toBe("Build Kanban Board");
    expect(parsed.status).toBe("todo");
    expect(parsed.priority).toBe("high");
    expect(parsed.tags).toEqual(["gui"]);
    expect(parsed.assignedAgent).toBe("builder");
    expect(parsed.checklist).toEqual({ total: 2, completed: 1 });
  });

  it("falls back gracefully on malformed frontmatter", () => {
    const raw = "Just raw text without frontmatter header";
    const parsed = parsePlannerCardMarkdown(
      raw,
      ".megasaver/planner/backlog/my-card.md",
      "backlog",
    );
    expect(parsed.id).toBe("my-card");
    expect(parsed.status).toBe("backlog");
    expect(parsed.priority).toBe("medium");
    expect(parsed.title).toBe("my-card");
  });

  it("serializes planner card back to markdown with frontmatter", () => {
    const card = {
      id: "task-02",
      title: "Test Task",
      status: "in-progress" as const,
      priority: "critical" as const,
      tags: ["test"],
      assignedAgent: null,
      createdAt: "2026-08-07T10:00:00.000Z",
      updatedAt: "2026-08-07T11:00:00.000Z",
      content: "## Notes\nSome text",
      filePath: ".megasaver/planner/in-progress/task-02.md",
      checklist: { total: 0, completed: 0 },
    };
    const serialized = serializePlannerCardMarkdown(card);
    expect(serialized).toContain('id: "task-02"');
    expect(serialized).toContain('status: "in-progress"');
    expect(serialized).toContain("## Notes");
  });
});
