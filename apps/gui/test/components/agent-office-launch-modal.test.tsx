// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentOfficeLaunchModal } from "../../src/components/planner/agent-office-launch-modal.js";

describe("AgentOfficeLaunchModal component", () => {
  it("renders modal header and task title", () => {
    const card = {
      id: "c1",
      title: "Task for Agent",
      status: "in-progress" as const,
      priority: "high" as const,
      tags: ["core"],
      assignedAgent: "builder",
      createdAt: "2026-08-07T00:00:00Z",
      updatedAt: "2026-08-07T00:00:00Z",
      content: "## Goals\nImplement feature",
      filePath: ".megasaver/planner/in-progress/c1.md",
      checklist: { total: 0, completed: 0 },
    };

    render(
      <AgentOfficeLaunchModal
        card={card}
        cwd="/synthetic/path"
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />,
    );

    expect(screen.getByText("Launch Agent Office Task")).toBeDefined();
    expect(screen.getByText("Task for Agent")).toBeDefined();
  });
});
