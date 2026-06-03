// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionControls } from "../../src/components/retention-controls.js";

const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Summary = { chunkSets: number; totalBytes: number; oldestAt: string | null };

const POPULATED: Summary = {
  chunkSets: 3,
  totalBytes: 4096,
  oldestAt: "2026-05-10T12:00:00.000Z",
};
const EMPTY: Summary = { chunkSets: 0, totalBytes: 0, oldestAt: null };

// Stub fetch: GET /retention returns `get`, POST /retention/clear returns `cleared`.
function stub(get: Summary, cleared: Summary = EMPTY): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith("/retention/clear") && init?.method === "POST") {
      return { ok: true, status: 200, json: async () => cleared };
    }
    if (url.endsWith("/retention")) {
      return { ok: true, status: 200, json: async () => get };
    }
    return { ok: true, status: 200, json: async () => null };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  stub(POPULATED);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RetentionControls — display", () => {
  it("renders the chunk-set count once loaded", async () => {
    const { container } = render(<RetentionControls sessionId={SESSION_ID} />);
    await waitFor(() => expect(container.textContent).toMatch(/3 chunk sets/i));
  });

  it("renders the stored byte size", async () => {
    const { container } = render(<RetentionControls sessionId={SESSION_ID} />);
    // 4096 bytes → "4 KB" (humanised) or the raw count; assert the number is present.
    await waitFor(() => expect(container.textContent).toMatch(/4(\.0)?\s?KB|4096/i));
  });

  it("shows an empty hint and hides the clear button when nothing is stored", async () => {
    stub(EMPTY);
    render(<RetentionControls sessionId={SESSION_ID} />);
    await waitFor(() => expect(screen.getByText(/no stored raw output/i)).toBeDefined());
    expect(screen.queryByRole("button", { name: /clear stored raw output/i })).toBeNull();
  });
});

describe("RetentionControls — destructive clear flow", () => {
  it("requires an explicit confirm step before clearing (two-click, not native confirm)", async () => {
    const fn = stub(POPULATED);
    render(<RetentionControls sessionId={SESSION_ID} />);

    const clearBtn = await screen.findByRole("button", { name: /clear stored raw output/i });
    fireEvent.click(clearBtn);

    // First click reveals a confirm affordance; it must NOT have cleared yet.
    expect(screen.getByRole("button", { name: /confirm clear/i })).toBeDefined();
    expect(fn.mock.calls.some(([, init]) => (init as { method?: string })?.method === "POST")).toBe(
      false,
    );
  });

  it("clears on confirm, re-fetches, and shows the post-clear empty state", async () => {
    stub(POPULATED, EMPTY);
    render(<RetentionControls sessionId={SESSION_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /clear stored raw output/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm clear/i }));

    await waitFor(() => expect(screen.getByText(/no stored raw output/i)).toBeDefined());
  });

  it("can cancel the confirm step without clearing", async () => {
    const fn = stub(POPULATED);
    render(<RetentionControls sessionId={SESSION_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /clear stored raw output/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Back to the primary action; no POST fired.
    expect(screen.getByRole("button", { name: /clear stored raw output/i })).toBeDefined();
    expect(fn.mock.calls.some(([, init]) => (init as { method?: string })?.method === "POST")).toBe(
      false,
    );
  });

  it("announces the result through a polite live region", async () => {
    const { container } = render(<RetentionControls sessionId={SESSION_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /clear stored raw output/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm clear/i }));

    const live = container.querySelector("output");
    expect(live).not.toBeNull();
    await waitFor(() => expect(live?.textContent ?? "").toMatch(/cleared/i));
  });
});
