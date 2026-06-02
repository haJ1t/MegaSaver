// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TokenSaverModal } from "../../src/components/token-saver-modal.js";

afterEach(cleanup);

function renderModal() {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<TokenSaverModal open onClose={onClose} onConfirm={onConfirm} />);
  return { onClose, onConfirm };
}

describe("TokenSaverModal focus trap", () => {
  it("focuses the dialog on open", () => {
    renderModal();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("Tab on the last focusable cycles to the first", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const last = screen.getByRole("button", { name: "Enable" });
    const first = screen.getByRole("combobox");
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab on the first focusable cycles to the last", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("combobox");
    const last = screen.getByRole("button", { name: "Enable" });
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Tab in the middle does not move focus to a boundary", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByRole("combobox");
    const last = screen.getByRole("button", { name: "Enable" });
    const middle = screen.getByRole("spinbutton");
    middle.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).not.toBe(first);
    expect(document.activeElement).not.toBe(last);
    expect(document.activeElement).toBe(middle);
  });

  it("Escape closes the dialog", () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
