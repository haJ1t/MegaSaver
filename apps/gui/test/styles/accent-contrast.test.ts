import { describe, expect, it } from "vitest";
import tokens from "../../src/styles/tokens.css?raw";

// Minimal WCAG 2.1 relative-luminance + contrast, no dependency.
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const channel = (i: number): number => Number.parseInt(n.slice(i, i + 2), 16) / 255;
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(channel(0)) + 0.7152 * lin(channel(2)) + 0.0722 * lin(channel(4));
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
// Pull a hex value out of the CSS for a given variable, scoped to a block.
function readVar(block: string, name: string): string {
  const hex = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (hex === undefined) throw new Error(`missing ${name}`);
  return hex;
}

const light = tokens.slice(tokens.indexOf(":root"), tokens.indexOf("@media"));
const dark = tokens.slice(tokens.indexOf("@media"));

describe("amber accent contrast (WCAG AA ≥ 4.5:1)", () => {
  it("accent is amber, not the old black", () => {
    expect(readVar(light, "--color-accent").toLowerCase()).not.toBe("#111111");
  });

  it("light: accent text on background and surface", () => {
    const accent = readVar(light, "--color-accent");
    expect(contrast(accent, readVar(light, "--color-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(accent, readVar(light, "--color-surface"))).toBeGreaterThanOrEqual(4.5);
  });
  it("light: accent-fg on the accent fill", () => {
    expect(
      contrast(readVar(light, "--color-accent-fg"), readVar(light, "--color-accent")),
    ).toBeGreaterThanOrEqual(4.5);
  });
  it("dark: accent text on background, and accent-fg on the accent fill", () => {
    const accent = readVar(dark, "--color-accent");
    expect(contrast(accent, readVar(dark, "--color-background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(readVar(dark, "--color-accent-fg"), accent)).toBeGreaterThanOrEqual(4.5);
  });
});
