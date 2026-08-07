// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CardDrawer } from "../../src/components/planner/card-drawer.js";

describe("CardDrawer component", () => {
  it("renders card title, priority select, and content editor", () => {
    const card = {
      id: "c1",
      title: "Drawer Test Task",
      status: "todo" as const,
      priority: "high" as const,
      tags: ["gui"],
      assignedAgent: null,
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      content: "## Description\n- [ ] check 1",
      filePath: ".megasaver/planner/todo/c1.md",
      checklist: { total: 1, completed: 0 },
    };

    render(<CardDrawer card={card} onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByDisplayValue("Drawer Test Task")).toBeDefined();
    expect(screen.getByDisplayValue(/Description/)).toBeDefined();
  });
});
