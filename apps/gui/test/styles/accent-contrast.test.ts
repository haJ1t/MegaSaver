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

// Extract a rule body by its exact selector. Selector-based, NOT ordinal: the
// theme structure has three palette blocks and two of them are dark, so an
// indexOf("@media") scan would silently read the wrong one.
function block(selector: string): string {
  const at = tokens.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`missing block: ${selector}`);
  const open = tokens.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i] === "{") depth++;
    else if (tokens[i] === "}") {
      depth--;
      if (depth === 0) return tokens.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block: ${selector}`);
}

function readVar(scope: string, name: string): string {
  const hex = scope.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (hex === undefined) throw new Error(`missing ${name}`);
  return hex;
}

const LIGHT = block(":root");
const DARK = block('[data-theme="dark"]');
const DARK_OS = block(':root:not([data-theme="light"])');

// Every role painted as text, and every surface it can be painted on.
const TEXT_ROLES = [
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-accent",
  "--color-ok",
  "--color-warn",
  "--color-danger",
] as const;

const SURFACES = ["--color-background", "--color-surface", "--color-surface-elevated"] as const;

// Tinted pill fills: [foreground, background].
const PILLS = [
  ["--color-accent", "--color-accent-soft"],
  ["--status-live-fg", "--status-live-bg"],
  ["--status-active-fg", "--status-active-bg"],
  ["--status-warn-fg", "--status-warn-bg"],
  ["--status-danger-fg", "--status-danger-bg"],
  ["--status-muted-fg", "--status-muted-bg"],
] as const;

const THEMES: ReadonlyArray<readonly [string, string]> = [
  ["light", LIGHT],
  ["dark", DARK],
  ["dark (OS preference)", DARK_OS],
];

describe("WCAG AA contrast (>= 4.5:1)", () => {
  // The imported console palette shipped --color-text-muted at 3.19:1 on the
  // warm canvas and the light accent at 4.49:1. Both carry normal-size text
  // (10-11px meta rows), so 4.5:1 applies, not the 3:1 large-text threshold.
  // Corrected per spec 2026-07-28-gui-console-redesign §3a; this test is what
  // stops PRs #85/#87 from regressing.
  for (const [themeName, scope] of THEMES) {
    for (const role of TEXT_ROLES) {
      for (const surface of SURFACES) {
        it(`${themeName}: ${role} on ${surface}`, () => {
          expect(contrast(readVar(scope, role), readVar(scope, surface))).toBeGreaterThanOrEqual(
            4.5,
          );
        });
      }
    }

    for (const [fg, bg] of PILLS) {
      it(`${themeName}: ${fg} on ${bg}`, () => {
        expect(contrast(readVar(scope, fg), readVar(scope, bg))).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`${themeName}: --color-accent-fg on the accent fill`, () => {
      expect(
        contrast(readVar(scope, "--color-accent-fg"), readVar(scope, "--color-accent")),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("accent is amber, not the old black", () => {
    expect(readVar(LIGHT, "--color-accent").toLowerCase()).not.toBe("#111111");
  });
});

describe("theme structure", () => {
  // The dark palette is declared twice (manual override + OS preference)
  // because a media query cannot join a selector list. This pins the copies
  // identical so they can never drift.
  it("the manual-override and OS-preference dark palettes are identical", () => {
    const normalize = (s: string): string =>
      s
        .split("\n")
        .map((l) => l.replace(/\/\*.*?\*\//g, "").trim())
        .filter((l) => l.startsWith("--"))
        .sort()
        .join("\n");
    expect(normalize(DARK).length).toBeGreaterThan(0);
    expect(normalize(DARK_OS)).toBe(normalize(DARK));
  });

  it("a manual light override wins over an OS dark preference", () => {
    expect(tokens).toContain(':root:not([data-theme="light"])');
    expect(tokens).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
  });
});
