// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPanel } from "../../src/views/cockpit/tasks-panel.js";

const DIR = "ws-dir";
const ID = "wssess01";
const WK = "0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TasksPanel", () => {
  const taskPlan = {
    plan: {
      id: "00000000-0000-4000-8000-000000000b01",
      workspaceKey: WK,
      liveSessionId: ID,
      task: "ship it",
      status: "planned",
      steps: [
        { id: "s1", type: "scan", title: "scan", dependsOn: [], status: "pending" },
        { id: "s2", type: "edit", title: "edit", dependsOn: ["s1"], status: "pending" },
      ],
      createdAt: "2026-06-14T00:00:00.000Z",
      updatedAt: "2026-06-14T00:00:00.000Z",
    },
    ready: ["s1"],
  };

  it("renders plans with ready badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [taskPlan] })),
    );
    render(<TasksPanel dir={DIR} id={ID} />);
    await waitFor(() => expect(screen.getByText("ship it")).toBeDefined());
    expect(screen.getByText(/1 ready/i)).toBeDefined();
  });

  it("ignores a stale load after dir/id changes", async () => {
    let firstResolve: (value: unknown) => void = () => {};
    let secondResolve: (value: unknown) => void = () => {};
    let calls = 0;

    const fetchMock = vi.fn(async (_url: string, opts?: { method?: string }) => {
      if (opts?.method && opts.method !== "GET")
        return { ok: true, status: 200, json: async () => [] };
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          firstResolve = resolve;
        });
      return new Promise((resolve) => {
        secondResolve = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<TasksPanel dir="dir1" id="id1" />);
    await waitFor(() => expect(calls).toBe(1));

    rerender(<TasksPanel dir="dir2" id="id2" />);
    await waitFor(() => expect(calls).toBe(2));

    await act(async () =>
      secondResolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            ...taskPlan,
            plan: { ...taskPlan.plan, id: "new", task: "new plan" },
          },
        ],
      }),
    );
    expect(screen.getByText("new plan")).toBeDefined();

    await act(async () =>
      firstResolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            ...taskPlan,
            plan: { ...taskPlan.plan, id: "old", task: "old plan" },
          },
        ],
      }),
    );
    expect(screen.queryByText("old plan")).toBeNull();
  });
});
