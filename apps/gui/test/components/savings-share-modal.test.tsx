// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllWorkspaceTokenSaverTotals } from "../../src/lib/claude-sessions-client.js";
import { SavingsShareModal } from "../../src/views/savings-share-modal.js";

// 4_000_000 bytes -> 1_000_000 tokens -> $3.00 (est.) at the input price.
const TOTALS: AllWorkspaceTokenSaverTotals = {
  bytesSavedTotal: 4_000_000,
  sessionsCount: 10,
  savingRatio: 0.4,
  workspaceCount: 2,
};

afterEach(cleanup);

describe("SavingsShareModal", () => {
  it("renders the direction-B card svg inline from the real totals", () => {
    const { container } = render(
      <SavingsShareModal totals={TOTALS} windowLabel="all time" onClose={() => {}} />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("1200");
    expect(container.innerHTML).toContain("$3.00");
    expect(container.innerHTML).toContain("Mega Saver");
  });

  it("opens an honest, (est.)-carrying X intent via the injected openUrl", () => {
    const openUrl = vi.fn();
    render(
      <SavingsShareModal
        totals={TOTALS}
        windowLabel="all time"
        onClose={() => {}}
        openUrl={openUrl}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /share on x/i }));
    expect(openUrl).toHaveBeenCalledTimes(1);
    const url = openUrl.mock.calls[0]?.[0] as string;
    expect(url).toContain("https://twitter.com/intent/tweet?text=");
    const text = decodeURIComponent(url.split("text=")[1] ?? "");
    expect(text).toContain("$");
    expect(text).toContain("(est.)");
  });

  it("notes that X cannot auto-attach the image", () => {
    render(<SavingsShareModal totals={TOTALS} windowLabel="all time" onClose={() => {}} />);
    expect(screen.getByText(/download the card/i)).toBeDefined();
  });

  it("calls onClose when the close control is clicked", () => {
    const onClose = vi.fn();
    render(<SavingsShareModal totals={TOTALS} windowLabel="all time" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
