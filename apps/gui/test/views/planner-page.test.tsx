// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerPage } from "../../src/views/planner-page.js";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/api/planner")) {
        return new Response(
          JSON.stringify({
            board: {
              workspaceKey: "ws-test",
              projectRoot: "/synthetic/path",
              columns: [
                { key: "backlog", title: "Backlog", cards: [], count: 0 },
                { key: "todo", title: "To Do", cards: [], count: 0 },
                { key: "in-progress", title: "In Progress", cards: [], count: 0 },
                { key: "review", title: "Review", cards: [], count: 0 },
                { key: "done", title: "Done", cards: [], count: 0 },
              ],
              totalCards: 0,
              tags: [],
              updatedAt: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PlannerPage view component", () => {
  it("renders header and 5 Kanban status columns", async () => {
    render(
      <PlannerPage
        activeKey="ws-test"
        options={[
          { key: "ws-test", cwd: "/synthetic/path", label: "demo", rep: { dir: "d", id: "1" } },
        ]}
      />,
    );
    expect(await screen.findByText("Project planner")).toBeDefined();
    expect(await screen.findByText("Backlog")).toBeDefined();
    expect(await screen.findByText("To Do")).toBeDefined();
    expect(await screen.findByText("In Progress")).toBeDefined();
    expect(await screen.findByText("Review")).toBeDefined();
    expect(await screen.findByText("Done")).toBeDefined();
  });
});
