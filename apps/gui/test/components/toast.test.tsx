// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast, useToast } from "../../src/components/toast.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useToast", () => {
  it("holds the message, then auto-dismisses", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.message).toBe("");

    act(() => result.current.say("Switched to alpha."));
    expect(result.current.message).toBe("Switched to alpha.");

    act(() => void vi.advanceTimersByTime(2599));
    expect(result.current.message).toBe("Switched to alpha.");

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.message).toBe("");
  });

  it("a second message restarts the timer instead of inheriting the first's", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.say("first"));
    act(() => void vi.advanceTimersByTime(2000));
    act(() => result.current.say("second"));

    // Would already be cleared if the original timer had survived.
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.message).toBe("second");

    act(() => void vi.advanceTimersByTime(1600));
    expect(result.current.message).toBe("");
  });

  it("clears its timer on unmount", () => {
    const { result, unmount } = renderHook(() => useToast());
    act(() => result.current.say("x"));
    unmount();
    // No "update on unmounted component" warning and no throw.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});

describe("Toast", () => {
  it("keeps the live region mounted while empty so the message is announced", () => {
    const { container } = render(<Toast message="" />);
    const output = container.querySelector("output");
    // Present but silent — inserting region and text in one tick goes unread.
    expect(output).not.toBeNull();
    expect(output?.textContent).toBe("");
  });

  it("renders the message in a status role", () => {
    render(<Toast message="Saved." />);
    expect(screen.getByRole("status").textContent).toContain("Saved.");
  });
});
