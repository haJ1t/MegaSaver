import type { SavingsHeadline } from "./savings-headline.js";

// Direction B — minimal editorial. Light ground, dark ink, one big $ number.
const GROUND = "#f6f5f2";
const INK = "#17181a";
const MUTED = "#6b6c70";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Text crosses into an XML attribute/text position, so escape the five markup
// characters. A workspace-derived window label is untrusted input at this
// boundary; without escaping a name like `<script>` would break the SVG.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Compact token count: 4_100_000 -> "4.1M", 4_100 -> "4.1k", 900 -> "900".
function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function renderSavingsCardSvg(
  headline: SavingsHeadline,
  opts: { windowLabel: string },
): string {
  const dollars = headline.dollarsSaved.toFixed(2);
  const tokens = compactTokens(headline.tokensSaved);
  const reductionPct = Math.round(headline.savingRatio * 100);
  // toFixed(1): the reclaim metric under-counts on purpose, so mirror the
  // headline strip and never round the sessions' worth up.
  const reclaimed = headline.contextWindowsReclaimed.toFixed(1);
  const windowLabel = esc(opts.windowLabel);

  const subStats = [
    `${esc(tokens)} tokens saved`,
    `${reductionPct}% reduction`,
    `≈${reclaimed} sessions' worth reclaimed`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="Mega Saver savings card">
  <rect width="1200" height="630" fill="${GROUND}"/>
  <g font-family="${FONT}" fill="${INK}">
    <g transform="translate(96 92)">
      <rect x="0" y="-18" width="22" height="22" fill="${INK}"/>
      <text x="38" y="0" font-size="30" font-weight="600" letter-spacing="0.2">Mega Saver</text>
    </g>
    <text x="96" y="300" font-size="164" font-weight="800" letter-spacing="-6">$${dollars}</text>
    <text x="100" y="360" font-size="26" font-weight="500" fill="${MUTED}">saved ${windowLabel} <tspan font-style="italic">(est.)</tspan></text>
    <g transform="translate(96 434)" font-size="24" font-weight="500">
      <text x="0" y="0">${subStats[0]}</text>
      <text x="0" y="40" fill="${MUTED}">${subStats[1]}</text>
      <text x="0" y="80" fill="${MUTED}">${subStats[2]}</text>
    </g>
    <text x="96" y="586" font-size="24" font-weight="600" letter-spacing="0.2">Less tokens. More signal.</text>
  </g>
</svg>`;
}
