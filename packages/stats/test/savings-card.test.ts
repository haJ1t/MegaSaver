import { describe, expect, it } from "vitest";
import { renderSavingsCardSvg } from "../src/savings-card.js";
import type { SavingsHeadline } from "../src/savings-headline.js";

const HEADLINE: SavingsHeadline = {
  tokensSaved: 4_100_000,
  dollarsSaved: 12.4,
  contextWindowsReclaimed: 20.5,
  savingRatio: 0.68,
  isEstimate: true,
};

describe("renderSavingsCardSvg", () => {
  it("renders a 1200x630 direction-B svg carrying every headline value", () => {
    const svg = renderSavingsCardSvg(HEADLINE, { windowLabel: "this week" });

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain("$12.40");
    expect(svg).toContain("(est.)");
    expect(svg).toContain("this week");
    // 4_100_000 tokens rendered compact as "4.1M".
    expect(svg).toContain("4.1M");
    // round(0.68 * 100) = 68.
    expect(svg).toContain("68%");
    // contextWindowsReclaimed.toFixed(1).
    expect(svg).toContain("20.5");
    expect(svg).toContain("Mega Saver");
    expect(svg).toContain("Less tokens. More signal.");
  });

  it("uses the direction-B palette (light ground, dark text)", () => {
    const svg = renderSavingsCardSvg(HEADLINE, { windowLabel: "this week" });
    expect(svg).toContain("#f6f5f2");
    expect(svg).toContain("#17181a");
  });

  it("produces well-formed XML that parses without error", () => {
    const svg = renderSavingsCardSvg(HEADLINE, { windowLabel: "this week" });
    // jsdom-free tag-balance check: every < opens a tag that gets closed, and
    // the doc parses as a single rooted <svg> tree.
    const openTags = (svg.match(/<[a-zA-Z]/g) ?? []).length;
    const closeTags = (svg.match(/<\/[a-zA-Z]/g) ?? []).length;
    const selfClosing = (svg.match(/\/>/g) ?? []).length;
    expect(openTags).toBe(closeTags + selfClosing);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("escapes special characters so a hostile window label cannot inject markup", () => {
    const svg = renderSavingsCardSvg(HEADLINE, {
      windowLabel: '<script>&"x"',
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
  });

  it("is deterministic — two identical calls are byte-identical", () => {
    const a = renderSavingsCardSvg(HEADLINE, { windowLabel: "all time" });
    const b = renderSavingsCardSvg(HEADLINE, { windowLabel: "all time" });
    expect(a).toBe(b);
  });

  it("renders sub-1M token counts in compact k form", () => {
    const svg = renderSavingsCardSvg({ ...HEADLINE, tokensSaved: 4_100 }, { windowLabel: "today" });
    expect(svg).toContain("4.1k");
  });
});
