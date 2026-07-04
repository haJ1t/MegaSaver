// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "../../src/components/workspace-picker.js";
import type { WorkspaceOption } from "../../src/lib/workspace-context.js";

afterEach(cleanup);

const OPTS: WorkspaceOption[] = [
  { key: "k1", cwd: "/ws/a", label: "a", rep: { dir: "d1", id: "s1" } },
  { key: "k2", cwd: "/ws/b", label: "b", rep: { dir: "d2", id: "s2" } },
];

describe("WorkspacePicker", () => {
  it("renders options and reports the selected key on change", () => {
    const onChange = vi.fn();
    render(<WorkspacePicker options={OPTS} activeKey="k1" onChange={onChange} />);
    const select = screen.getByLabelText("Active workspace") as HTMLSelectElement;
    expect(select.value).toBe("k1");
    fireEvent.change(select, { target: { value: "k2" } });
    expect(onChange).toHaveBeenCalledWith("k2");
  });

  it("renders nothing useful when empty (no crash)", () => {
    render(<WorkspacePicker options={[]} activeKey={null} onChange={() => {}} />);
    expect(screen.getByText(/no workspaces/i)).toBeTruthy();
  });
});
