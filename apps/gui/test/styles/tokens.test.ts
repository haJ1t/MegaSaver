import { describe, expect, it } from "vitest";
// @vitest-environment jsdom
import tokens from "../../src/styles/tokens.css?raw";

describe("design tokens v3 (console)", () => {
  it("uses the warm paper canvas and white surface", () => {
    expect(tokens).toContain("--color-background: #f4f2ee");
    expect(tokens).toContain("--color-surface: #ffffff");
  });

  it("uses the Instrument Sans UI font stack", () => {
    expect(tokens).toMatch(/font-family:\s*"Instrument Sans"/);
  });

  it("keeps monospace for code elements", () => {
    expect(tokens).toMatch(/code,\s*kbd,\s*pre,\s*samp/);
    expect(tokens).toContain("DM Mono");
  });

  it("defines spot-pastel status badge variables", () => {
    expect(tokens).toContain("--status-live-bg:");
    expect(tokens).toContain("--status-active-bg:");
    expect(tokens).toContain("--status-warn-bg:");
    expect(tokens).toContain("--status-danger-bg:");
  });

  it("defines the roles the console layout adds", () => {
    // Hairline row rule, tinted accent fill, and two-layer elevation.
    expect(tokens).toContain("--color-line-soft:");
    expect(tokens).toContain("--color-accent-soft:");
    expect(tokens).toContain("--color-shadow:");
  });
});
