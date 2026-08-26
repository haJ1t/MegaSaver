#!/usr/bin/env node
// Committed generator for site/harnesses/index.html — the "supported
// harnesses" page. Reads the detection catalog from the BUILT
// @megasaver/harness-detect package (single source of truth) plus the
// connector target paths from @megasaver/connector-generic-cli, and emits a
// visual, dependency-free static page (same design system as /specs).
//
//   pnpm --filter @megasaver/harness-detect build \
//     && pnpm --filter @megasaver/connector-generic-cli build \
//     && node scripts/gen-harnesses-page.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const { HARNESS_CATALOG } = await import(
  new URL("../packages/harness-detect/dist/index.js", import.meta.url).href
);
const { builtinTargets } = await import(
  new URL("../packages/connectors/generic-cli/dist/index.js", import.meta.url).href
);

// claude-code's target file lives in the claude-code connector package
// (CLI-owned); the rest come from the generic-cli registry.
const TARGET_PATHS = new Map([
  ["claude-code", "CLAUDE.md"],
  ...builtinTargets.map((t) => [t.id, t.relativePath]),
]);

const OUT = new URL("../site/harnesses/index.html", import.meta.url);
const SPEC_URL =
  "https://github.com/haJ1t/MegaSaver/blob/main/docs/superpowers/specs/2026-08-26-harness-autodetect-design.md";

const CATEGORIES = [
  { id: "cli", name: "Terminal agents", blurb: "CLI harnesses you run in the terminal." },
  { id: "ide", name: "Editors & IDEs", blurb: "Editors with built-in agent surfaces." },
  {
    id: "extension",
    name: "Editor extensions",
    blurb: "Agent plugins inside your existing editor.",
  },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function signalChips(h) {
  const chips = [];
  for (const b of h.binaries) chips.push(`<span class="sig">bin <b>${esc(b)}</b></span>`);
  for (const d of h.configDirs) chips.push(`<span class="sig">dir <b>${esc(d)}</b></span>`);
  for (const e of h.extensionDirs)
    chips.push(`<span class="sig">ext <b>${esc(e.prefix)}*</b></span>`);
  for (const m of h.projectMarkers) chips.push(`<span class="sig">marker <b>${esc(m)}</b></span>`);
  return chips.join("");
}

function integrationChip(h) {
  if (h.connectorTargetId !== null) {
    const path = TARGET_PATHS.get(h.connectorTargetId) ?? h.connectorTargetId;
    return `<span class="chip own">auto-configured <b>${esc(path)}</b></span>`;
  }
  if (h.coveredByTargetId !== null) {
    const path = TARGET_PATHS.get(h.coveredByTargetId) ?? h.coveredByTargetId;
    return `<span class="chip shared">shared <b>${esc(path)}</b></span>`;
  }
  return `<span class="chip watch">detected only</span>`;
}

function harnessRow(h) {
  return `      <div class="row">
        <div class="h-name">${esc(h.name)}<span class="h-id">${esc(h.id)}</span></div>
        <div class="h-signals">${signalChips(h)}</div>
        <div class="h-target">${integrationChip(h)}</div>
      </div>`;
}

const sections = CATEGORIES.map((cat) => {
  const members = HARNESS_CATALOG.filter((h) => h.category === cat.id);
  return `    <section class="cat" id="${cat.id}">
      <div class="cat-head">
        <h3>${cat.name}</h3>
        <span class="cat-count tnum">${members.length}</span>
        <p class="cat-blurb">${cat.blurb}</p>
      </div>
${members.map(harnessRow).join("\n")}
    </section>`;
}).join("\n");

const total = HARNESS_CATALOG.length;
const ownCount = HARNESS_CATALOG.filter((h) => h.connectorTargetId !== null).length;
const sharedCount = HARNESS_CATALOG.filter(
  (h) => h.connectorTargetId === null && h.coveredByTargetId !== null,
).length;
const watchCount = HARNESS_CATALOG.filter(
  (h) => h.connectorTargetId === null && h.coveredByTargetId === null,
).length;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mega Saver — supported harnesses</title>
<meta name="description" content="Mega Saver detects ${total} agent harnesses on your machine — terminal agents, editors, and extensions — and auto-configures ${ownCount} of them during first-run setup. Claude Code, Codex, Cursor, Gemini, Aider, OpenCode, Copilot, Cline, Roo Code, and more.">
<link rel="canonical" href="https://megasaver.dev/harnesses">
<meta property="og:type" content="website">
<meta property="og:title" content="Mega Saver — supported harnesses">
<meta property="og:description" content="${total} agent harnesses detected from real footprints on your machine. ${ownCount} auto-configured at first run. Honest signals — no content reads, no spawns, no network.">
<meta property="og:url" content="https://megasaver.dev/harnesses">
<meta property="og:image" content="https://megasaver.dev/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230e7a54'/%3E%3C/svg%3E">
<style>
  :root{
    --paper:#f1f2ef; --ink:#17181a; --muted:#5c5f5a; --hair:#dcdcd6;
    --accent:#0e7a54; --term-ink:#e8e9e4;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
    --maxw:1120px;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
    font-size:18px;line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .wrap{max-width:var(--maxw);margin:0 auto;padding:0 32px}
  a{color:inherit}
  .mono{font-family:var(--mono)}
  .tnum{font-variant-numeric:tabular-nums}
  .label{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .sq{display:inline-block;width:.72em;height:.72em;background:var(--ink);vertical-align:baseline;margin-right:.5em;border-radius:2px}
  .sq.acc{background:var(--accent)}

  nav{border-bottom:1px solid var(--hair)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  .brand{font-weight:700;font-size:16px;letter-spacing:-.01em;display:flex;align-items:center;text-decoration:none}
  .brand .sq{width:11px;height:11px;margin-right:9px}
  nav .links{display:flex;gap:26px;font-family:var(--mono);font-size:13px;color:var(--muted)}
  nav .links a{text-decoration:none}
  nav .links a:hover{color:var(--ink)}

  header{padding:88px 0 34px}
  header .eyebrow{margin:0 0 22px}
  h1{font-size:clamp(40px,6vw,68px);line-height:.98;letter-spacing:-.035em;font-weight:800;margin:0;text-wrap:balance;max-width:18ch}
  .sub{font-size:clamp(17px,2vw,20px);color:var(--muted);max-width:66ch;margin:22px 0 0;line-height:1.5}
  .sub b{color:var(--ink);font-weight:600}
  .sub code{font-family:var(--mono);font-size:.9em;background:#e9eae6;border:1px solid var(--hair);border-radius:6px;padding:1px 6px}

  .statband{display:flex;flex-wrap:wrap;gap:22px 48px;margin-top:40px;padding:22px 0;border-top:1px solid var(--hair)}
  .stat .n{font-size:clamp(30px,4vw,44px);font-weight:800;letter-spacing:-.03em;line-height:.95}
  .stat .k{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:9px}
  .stat.big .n{color:var(--accent)}

  .howband{padding:34px 0 8px}
  .howgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:20px}
  .how{border:1px solid var(--hair);border-radius:14px;padding:18px;background:#fff}
  .how .k{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .how .v{font-size:14.5px;color:var(--ink);margin-top:8px;line-height:1.45}
  .how code{font-family:var(--mono);font-size:.88em}
  .honest{margin-top:18px;font-size:14.5px;color:var(--muted);max-width:72ch}
  .honest b{color:var(--ink)}

  main{padding:26px 0 60px}
  .cat{border-top:1px solid var(--hair);padding:34px 0 6px}
  .cat-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
  .cat-head h3{font-size:clamp(22px,3vw,30px);letter-spacing:-.02em;font-weight:800;margin:0}
  .cat-count{font-family:var(--mono);font-size:12.5px;color:var(--muted)}
  .cat-blurb{color:var(--muted);margin:0;font-size:15px}

  .row{display:grid;grid-template-columns:minmax(170px,220px) 1fr minmax(210px,260px);gap:18px;
    align-items:baseline;padding:13px 0;border-bottom:1px dashed var(--hair)}
  .row:last-child{border-bottom:0}
  .h-name{font-weight:700;font-size:16.5px;letter-spacing:-.01em}
  .h-id{font-family:var(--mono);font-size:12px;color:var(--muted);margin-left:10px;font-weight:400}
  .h-signals{display:flex;flex-wrap:wrap;gap:6px}
  .sig{font-family:var(--mono);font-size:11px;color:var(--muted);border:1px solid var(--hair);
    border-radius:6px;padding:2.5px 7px;background:var(--paper);white-space:nowrap}
  .sig b{color:var(--ink);font-weight:600}
  .chip{font-family:var(--mono);font-size:11.5px;border-radius:7px;padding:3.5px 9px;white-space:nowrap}
  .chip b{font-weight:600}
  .chip.own{color:var(--accent);border:1px solid #bfe0d2;background:#e8f4ee}
  .chip.shared{color:#8a6d0b;border:1px solid #e0d3a8;background:#f7f2e0}
  .chip.watch{color:var(--muted);border:1px solid var(--hair);background:#ecede9}

  .legend{display:flex;flex-wrap:wrap;gap:8px 22px;margin:22px 0 0;font-size:13px;color:var(--muted)}
  .legend .chip{font-size:11px}

  footer{border-top:1px solid var(--hair);padding:40px 0 64px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between;align-items:baseline}
  footer .mono{font-size:12.5px;color:var(--muted);line-height:1.7;max-width:64ch}
  footer .brand{font-size:14px}

  @media (max-width:860px){
    .howgrid{grid-template-columns:1fr 1fr}
    .row{grid-template-columns:1fr;gap:8px;padding:16px 0}
  }
  @media (max-width:520px){.howgrid{grid-template-columns:1fr}}
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq"></span>Mega Saver</a>
    <div class="links">
      <a href="/#how">how it works</a>
      <a href="/specs">specs</a>
      <a href="/pro">pricing</a>
      <a href="https://github.com/haJ1t/MegaSaver">github &#8599;</a>
    </div>
  </div>
</nav>

<header>
  <div class="wrap">
    <div class="label eyebrow">supported harnesses</div>
    <h1>Your agents are already installed. Mega Saver meets them there.</h1>
    <p class="sub">On first run, <code>mega init</code> scans your machine for <b>${total} known agent harnesses</b> — terminal agents, editors, and extensions — and writes the Mega Saver context block into the ones that are actually installed. <b>${ownCount}</b> get their own config file, <b>${sharedCount}</b> share the AGENTS.md convention, and <b>${watchCount}</b> are honestly reported as detected-only. Check yours any time with <code>mega detect</code>.</p>
    <div class="statband">
      <div class="stat big"><div class="n tnum">${total}</div><div class="k">harnesses detected</div></div>
      <div class="stat"><div class="n tnum">${ownCount}</div><div class="k">auto-configured targets</div></div>
      <div class="stat"><div class="n tnum">${sharedCount}</div><div class="k">share AGENTS.md</div></div>
      <div class="stat"><div class="n tnum">${watchCount}</div><div class="k">detected only</div></div>
    </div>
  </div>
</header>

<div class="howband wrap">
  <div class="label">how detection works</div>
  <div class="howgrid">
    <div class="how"><div class="k">1 · binary on PATH</div><div class="v">Executable files like <code>claude</code>, <code>codex</code>, <code>opencode</code>. POSIX checks the execute bit; Windows matches PATHEXT.</div></div>
    <div class="how"><div class="k">2 · config dir</div><div class="v">Home footprints like <code>~/.claude</code>, <code>~/.cursor</code>, <code>~/.gemini</code>. Never outside your home directory.</div></div>
    <div class="how"><div class="k">3 · extension dir</div><div class="v">Versioned extension folders by publisher prefix, e.g. <code>saoudrizwan.claude-dev-*</code> under <code>~/.vscode/extensions</code>.</div></div>
    <div class="how"><div class="k">4 · project marker</div><div class="v">Per-harness unique footprints like <code>.cursor/rules</code> or <code>.opencode</code>. Shared files like AGENTS.md never prove an install.</div></div>
  </div>
  <p class="honest"><b>Honest by construction:</b> detection stats and lists paths only — it never reads file contents, never spawns a harness binary, and never touches the network. A harness counts as detected only when a real footprint matched, and the report shows exactly which one.</p>
</div>

<main class="wrap">
  <div class="legend">
    <span><span class="chip own">auto-configured <b>path</b></span> &nbsp;gets its own Mega Saver block at first run</span>
    <span><span class="chip shared">shared <b>AGENTS.md</b></span> &nbsp;reads the AGENTS.md convention (codex target)</span>
    <span><span class="chip watch">detected only</span> &nbsp;reported honestly; no config file convention yet</span>
  </div>
${sections}
</main>

<footer>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq acc"></span>Mega Saver</a>
    <div class="mono">Harness catalog generated from <span class="mono">@megasaver/harness-detect</span> in the Mega Saver repository &middot; <a href="${SPEC_URL}">design spec</a> &middot; MIT &middot; All product names belong to their owners; no affiliation.</div>
  </div>
</footer>

</body>
</html>
`;

writeFileSync(fileURLToPath(OUT), html);
console.log(
  `Wrote ${fileURLToPath(OUT)} (${html.length} bytes): ${total} harnesses (${ownCount} own / ${sharedCount} shared / ${watchCount} detected-only).`,
);
