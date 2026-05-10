// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoProjectState,
  NoSelectionState,
} from "../../src/components/states.js";

afterEach(() => {
  cleanup();
});

describe("LoadingState", () => {
  it("renders the provided label text", () => {
    render(<LoadingState label="Loading sessions…" />);
    expect(screen.getByText("Loading sessions…")).toBeDefined();
  });

  it("exposes aria-busy=true and the label as aria-label", () => {
    const { container } = render(<LoadingState label="Loading…" />);
    const region = container.firstChild as HTMLElement;
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("aria-label")).toBe("Loading…");
  });
});

describe("ErrorState", () => {
  it("renders role='alert' and aria-live='assertive' for screen readers", () => {
    const { container } = render(<ErrorState error="boom" />);
    const region = container.querySelector("[role='alert']");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("assertive");
  });

  it("renders the localized BRIDGE_ERROR_COPY entry for a known code", () => {
    render(
      <ErrorState
        error={{
          error: "raw bridge text",
          code: "session_already_ended",
        }}
      />,
    );
    expect(screen.getByText("This session has already ended.")).toBeDefined();
  });

  it("displays the machine-readable code beneath the message", () => {
    render(
      <ErrorState error={{ error: "x", code: "validation_failed", details: { field: "title" } }} />,
    );
    expect(screen.getByText("validation_failed")).toBeDefined();
  });

  it("renders a Retry button and invokes onRetry when clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState error="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("falls back to the raw bridge `error` string when code is unknown", () => {
    render(<ErrorState error="just a plain string" />);
    expect(screen.getByText("just a plain string")).toBeDefined();
  });
});

describe("EmptyState", () => {
  it("renders the title text", () => {
    render(<EmptyState title="No sessions yet." />);
    expect(screen.getByText("No sessions yet.")).toBeDefined();
  });

  it("renders the description when provided", () => {
    render(<EmptyState title="No entries" description="Add one above." />);
    expect(screen.getByText("Add one above.")).toBeDefined();
  });
});

describe("NoProjectState", () => {
  it("instructs the user to run `mega project create <name>`", () => {
    const { container } = render(<NoProjectState />);
    expect(container.textContent).toContain("mega project create");
    expect(container.textContent).toContain("No projects yet.");
  });
});

describe("NoSelectionState", () => {
  it("renders the entity-specific copy when entity=session", () => {
    render(<NoSelectionState entity="session" />);
    expect(screen.getByText("No session selected.")).toBeDefined();
  });

  it("renders the entity-specific copy when entity=memory entry", () => {
    render(<NoSelectionState entity="memory entry" />);
    expect(screen.getByText("No memory entry selected.")).toBeDefined();
  });
});
