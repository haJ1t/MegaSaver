// @vitest-environment jsdom
import tokens from "../../src/styles/tokens.css?raw";
import { describe, expect, it } from "vitest";

describe("design tokens v2", () => {
  it("uses warm monochrome background and surface colors", () => {
    expect(tokens).toContain("--color-background: #f7f6f3");
    expect(tokens).toContain("--color-surface: #ffffff");
  });

  it("uses a sans-serif UI font stack", () => {
    expect(tokens).toMatch(/font-family:\s*"SF Pro Display"/);
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
});
