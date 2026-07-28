// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeStatusEntry } from "../../../src/lib/office-client.js";
import { OfficeFloor } from "../../../src/views/office/office-floor.js";

afterEach(cleanup);

function entry(
  id: string,
  name: string,
  status: OfficeStatusEntry["agent"]["status"],
  instruction?: string,
): OfficeStatusEntry {
  return {
    agent: { id, name, roleId: "r1", status, createdAt: "2026-07-28T00:00:00.000Z" },
    currentTask: instruction
      ? {
          id: `t-${id}`,
          agentId: id,
          instruction,
          status: "running",
          createdAt: "2026-07-28T00:00:00.000Z",
        }
      : null,
    lastEvent: null,
  };
}

describe("OfficeFloor", () => {
  it("seats one desk per agent plus a single free desk", () => {
    render(
      <OfficeFloor
        entries={[entry("a1", "reviewer-1", "working"), entry("a2", "tests-1", "idle")]}
        selectedId={null}
        onSelect={() => {}}
        onHire={() => {}}
      />,
    );
    expect(screen.getByText("reviewer-1")).toBeTruthy();
    expect(screen.getByText("tests-1")).toBeTruthy();
    expect(screen.getByText("free desk")).toBeTruthy();
    expect(screen.getByText("2 of 10 desks taken")).toBeTruthy();
  });

  it("counts working and paused agents", () => {
    render(
      <OfficeFloor
        entries={[
          entry("a1", "one", "working"),
          entry("a2", "two", "working"),
          entry("a3", "three", "paused"),
        ]}
        selectedId={null}
        onSelect={() => {}}
        onHire={() => {}}
      />,
    );
    expect(screen.getByText("2 working")).toBeTruthy();
    expect(screen.getByText("1 paused")).toBeTruthy();
  });

  it("shows the current task in the desk bubble, truncated", () => {
    render(
      <OfficeFloor
        entries={[entry("a1", "reviewer-1", "working", "Reviewing PR #221 for the saver totals")]}
        selectedId={null}
        onSelect={() => {}}
        onHire={() => {}}
      />,
    );
    expect(screen.getByText("Reviewing PR #221 for t…")).toBeTruthy();
  });

  it("labels an idle agent as waiting and a paused one as paused", () => {
    render(
      <OfficeFloor
        entries={[entry("a1", "one", "idle"), entry("a2", "two", "paused")]}
        selectedId={null}
        onSelect={() => {}}
        onHire={() => {}}
      />,
    );
    expect(screen.getByText("Waiting for work")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("reports the clicked agent, and hiring from the free desk", () => {
    const onSelect = vi.fn();
    const onHire = vi.fn();
    render(
      <OfficeFloor
        entries={[entry("a1", "reviewer-1", "working")]}
        selectedId={null}
        onSelect={onSelect}
        onHire={onHire}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reviewer-1, working/ }));
    expect(onSelect).toHaveBeenCalledWith("a1");

    fireEvent.click(screen.getByRole("button", { name: /Free desk 2/ }));
    expect(onHire).toHaveBeenCalledTimes(1);
  });

  it("marks the selected desk pressed", () => {
    render(
      <OfficeFloor
        entries={[entry("a1", "one", "working"), entry("a2", "two", "idle")]}
        selectedId="a2"
        onSelect={() => {}}
        onHire={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /two, idle/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /one, working/ }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("caps the floor at ten desks and drops the free desk when full", () => {
    const full = Array.from({ length: 12 }, (_, i) => entry(`a${i}`, `agent-${i}`, "idle"));
    render(<OfficeFloor entries={full} selectedId={null} onSelect={() => {}} onHire={() => {}} />);
    expect(screen.queryByText("free desk")).toBeNull();
    expect(screen.getByText("10 of 10 desks taken")).toBeTruthy();
    // The 11th and 12th agents are not seated on this floor.
    expect(screen.queryByText("agent-10")).toBeNull();
    // …and that overflow is stated, never silent.
    expect(screen.getByText(/2 more agents not shown/)).toBeTruthy();
  });
});
