// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stub: {
  context: () => Promise<{ indexed: boolean; pack?: { blocks: { filePath: string }[] } }>;
} = {
  context: () => Promise.reject(new Error("not set")),
};

vi.mock("../../src/lib/workspaces-client.js", () => ({
  fetchWorkspaceContext: () => stub.context(),
}));

import { WorkspaceContextPanel } from "../../src/views/cockpit/workspace-context-panel.js";

afterEach(() => {
  cleanup();
  stub.context = () => Promise.reject(new Error("not set"));
});

describe("WorkspaceContextPanel", () => {
  it("ignores stale submit responses", async () => {
    let firstResolve: (value: unknown) => void = () => {};
    let secondResolve: (value: unknown) => void = () => {};
    let calls = 0;
    stub.context = () => {
      calls++;
      if (calls === 1)
        return new Promise((resolve) => {
          firstResolve = resolve as (value: unknown) => void;
        });
      return new Promise((resolve) => {
        secondResolve = resolve as (value: unknown) => void;
      });
    };
    render(<WorkspaceContextPanel workspaceKey="wk" />);
    const input = screen.getByLabelText(/context task/i);
    const button = screen.getByRole("button", { name: /preview/i });

    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.click(button);
    await waitFor(() => expect(calls).toBe(1));

    fireEvent.change(input, { target: { value: "second" } });
    fireEvent.click(button);
    await waitFor(() => expect(calls).toBe(2));

    await act(async () =>
      secondResolve({ indexed: true, pack: { blocks: [{ filePath: "new.ts" }] } }),
    );
    expect(screen.getByText("Pack built (1 block(s)).")).toBeDefined();

    await act(async () =>
      firstResolve({
        indexed: true,
        pack: { blocks: [{ filePath: "old.ts" }, { filePath: "old2.ts" }] },
      }),
    );
    expect(screen.queryByText("Pack built (2 block(s)).")).toBeNull();
  });
});
