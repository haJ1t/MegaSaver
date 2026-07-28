// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type Command,
  CommandPalette,
  filterCommands,
} from "../../src/components/command-palette.js";

afterEach(cleanup);

function cmd(id: string, label: string, hint = "view"): Command {
  return { id, label, hint, icon: "›", run: vi.fn() };
}

describe("filterCommands", () => {
  const all = [
    cmd("a", "Overview"),
    cmd("b", "Token saver"),
    cmd("c", "Refactor the store", "mega-saver"),
  ];

  it("returns everything when the query is blank", () => {
    expect(filterCommands(all, "  ").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("matches on label, case-insensitively", () => {
    expect(filterCommands(all, "TOKEN").map((c) => c.id)).toEqual(["b"]);
  });

  it("matches on hint too, so a session is findable by its workspace", () => {
    expect(filterCommands(all, "mega-saver").map((c) => c.id)).toEqual(["c"]);
  });

  it("returns nothing when there is no match", () => {
    expect(filterCommands(all, "zzz")).toEqual([]);
  });

  it("caps results at 8", () => {
    const many = Array.from({ length: 20 }, (_, i) => cmd(`x${i}`, `Item ${i}`));
    expect(filterCommands(many, "Item").length).toBe(8);
  });
});

describe("CommandPalette", () => {
  const commands = [cmd("a", "Overview"), cmd("b", "Token saver"), cmd("c", "Memory")];

  it("focuses the input on open", () => {
    render(<CommandPalette commands={commands} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Search commands"));
  });

  it("restores focus to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<CommandPalette commands={commands} onClose={() => {}} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("filters as you type and resets the highlight to the top", () => {
    render(<CommandPalette commands={commands} onClose={() => {}} />);
    const input = screen.getByLabelText("Search commands");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "mem" } });
    const rows = screen.getAllByRole("button");
    expect(rows.length).toBe(1);
    expect(rows[0]?.textContent).toContain("Memory");
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");
  });

  it("runs the highlighted command on Enter and closes", () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(commands[1]?.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not run past the end of the list", () => {
    render(<CommandPalette commands={commands} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 10; i++) fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(commands[2]?.run).toHaveBeenCalledTimes(1);
  });

  it("closes when the scrim is clicked but not the dialog", () => {
    const onClose = vi.fn();
    render(<CommandPalette commands={commands} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an honest empty state rather than a blank list", () => {
    render(<CommandPalette commands={commands} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search commands"), { target: { value: "zzz" } });
    expect(screen.getByText("No matches.")).toBeTruthy();
  });

  it("traps Tab inside the dialog, since aria-modal claims the rest is inert", () => {
    render(<CommandPalette commands={commands} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const focusables = dialog.querySelectorAll<HTMLElement>("input, button");
    const last = focusables[focusables.length - 1];
    last?.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);

    focusables[0]?.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
