// @vitest-environment jsdom
import type { TokenSaverSettings } from "@megasaver/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SavingsBadge } from "../../src/components/savings-badge.js";

const ENABLED: TokenSaverSettings = {
  enabled: true,
  mode: "balanced",
  maxReturnedBytes: 12_000,
  storeRawOutput: true,
  redactSecrets: true,
  autoRepair: true,
  createdAt: "2026-05-10T11:00:00.000Z",
  updatedAt: "2026-05-10T11:00:00.000Z",
};

const DISABLED: TokenSaverSettings = { ...ENABLED, enabled: false };

afterEach(() => {
  cleanup();
});

describe("SavingsBadge", () => {
  it("renders nothing when tokenSaver is absent", () => {
    const { container } = render(<SavingsBadge />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when tokenSaver is disabled", () => {
    const { container } = render(<SavingsBadge tokenSaver={DISABLED} />);
    expect(container.textContent).toBe("");
  });

  it("renders 'on' when enabled but no ratio is known yet", () => {
    const { container } = render(<SavingsBadge tokenSaver={ENABLED} />);
    expect(container.textContent).toBe("on");
  });

  it("renders 'N% saved' when a savingRatio is provided", () => {
    const { container } = render(<SavingsBadge tokenSaver={ENABLED} savingRatio={0.42} />);
    expect(container.textContent).toBe("42% saved");
  });
});
