// @vitest-environment jsdom
import type { Session } from "@megasaver/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenSaverPanel } from "../../src/components/token-saver-panel.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SESSION: Session = {
  id: SESSION_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "claude-code",
  riskLevel: "medium",
  title: "Alpha",
  startedAt: "2026-05-10T11:00:00.000Z",
  endedAt: null,
};

function stubStatusAndStats(status: unknown, stats: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/token-saver/status")) {
        return { ok: true, status: 200, json: async () => status };
      }
      if (url.includes("/token-saver/stats")) {
        return { ok: true, status: 200, json: async () => stats };
      }
      if (url.includes("/token-saver/events")) {
        return { ok: true, status: 200, json: async () => [] };
      }
      return { ok: true, status: 200, json: async () => null };
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => null })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TokenSaverPanel — not configured", () => {
  it("renders an 'Enable Mega Saver Mode' CTA when settings is null", async () => {
    stubStatusAndStats({ enabled: false, settings: null }, null);
    render(<TokenSaverPanel session={SESSION} onSettingsChanged={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Enable Mega Saver Mode/i })).toBeDefined(),
    );
  });

  it("exposes the panel as a labelled section", async () => {
    stubStatusAndStats({ enabled: false, settings: null }, null);
    render(<TokenSaverPanel session={SESSION} onSettingsChanged={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("Mega Saver Mode")).toBeDefined());
  });
});

describe("TokenSaverPanel — enabled", () => {
  const enabledStatus = {
    enabled: true,
    settings: {
      enabled: true,
      mode: "balanced",
      maxReturnedBytes: 12_000,
      storeRawOutput: true,
      redactSecrets: true,
      autoRepair: true,
      createdAt: "2026-05-10T11:00:00.000Z",
      updatedAt: "2026-05-10T11:00:00.000Z",
    },
  };

  it("renders a Disable button when enabled", async () => {
    stubStatusAndStats(enabledStatus, null);
    render(<TokenSaverPanel session={SESSION} onSettingsChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Disable/i })).toBeDefined());
  });

  it("shows the active mode", async () => {
    stubStatusAndStats(enabledStatus, null);
    const { container } = render(
      <TokenSaverPanel session={SESSION} onSettingsChanged={() => {}} />,
    );
    await waitFor(() => expect(container.textContent).toContain("balanced"));
  });
});
