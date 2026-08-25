#!/usr/bin/env node
// Committed generator for site/specs/index.html — the "spec library" page.
// Reads every spec in docs/superpowers/specs/, extracts frontmatter title +
// a one-paragraph purpose (Goal / Problem / TL;DR section), and writes a
// searchable, risk-filterable static page matching the marketing site's
// editorial style.
//
//   node scripts/gen-specs-page.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPECS_DIR = "docs/superpowers/specs";
const OUT = "site/specs/index.html";
const GH = "https://github.com/haJ1t/MegaSaver/blob/main/docs/superpowers/specs/";

function frontmatter(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (k) fm[k[1]] = k[2].trim();
  }
  return fm;
}
function firstHeading(txt) {
  const m = txt.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}
function clean(t) {
  return t
    .replace(/^>\s?/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}
function section(txt, headingRegex) {
  const body = txt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRegex.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#\s/.test(lines[i])) break;
    const t = clean(lines[i]);
    if (!t) { if (out.length) break; else continue; }
    out.push(t);
    if (out.join(" ").length > 380) break;
  }
  const s = out.join(" ");
  return s.length > 25 ? s.slice(0, 400) : null;
}
function purpose(txt) {
  for (const re of [
    /^##\s+Summary\b/i, /^##\s+TL;DR\b/i, /^##\s+§\d+\s+TL;DR\b/i,
    /^##\s+Goal\b/i, /^##\s+\d*\.?\s*Goal\b/i, /^##\s+Motivation\b/i,
    /^##\s+Why\b/i, /^##\s+Mission\b/i,
  ]) {
    const s = section(txt, re);
    if (s) return s;
  }
  for (const re of [
    /^##\s+Problem\b/i, /^##\s+\d+\.?\s+Problem\b/i,
    /^##\s+§\d+\s+The defect\b/i, /^##\s+§\d+\s+.*\b(defect|issue|problem|context)\b/i,
  ]) {
    const s = section(txt, re);
    if (s) return s;
  }
  const body = txt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const lines = body.split(/\r?\n/);
  let afterTitle = false;
  const out = [];
  for (const line of lines) {
    if (/^#\s/.test(line)) { afterTitle = true; continue; }
    if (!afterTitle) continue;
    if (/^##\s/.test(line)) break;
    const t = clean(line);
    if (!t) continue;
    out.push(t);
    if (out.join(" ").length > 380) break;
  }
  const s = out.join(" ");
  return s.length > 25 ? s.slice(0, 400) : null;
}

const OVERRIDES = {
  "2026-05-03-project-skeleton-design.md": "Define the repo skeleton (pnpm + Turborepo workspace, tsconfig.base, biome, turbo, changesets) that activates the aspirational stack commands from the bootstrap — package.json, config files, and workspace wiring.",
  "2026-05-07-generic-cli-connector-design.md": "Ship @megasaver/connector-generic-cli: a manifest-driven connector that syncs a Mega Saver managed block into a per-agent config file (v0.1 = Codex AGENTS.md), plus two co-changes to keep the Claude Code connector consistent.",
  "2026-05-08-core-hardening-m3-m4-design.md": "Two correctness fixes for @megasaver/core: M3 stale-lock detection (recover immediately from orphan .lock files via PID liveness) and M4 Unicode NFC normalization for Project.name and other identifiers.",
  "2026-05-10-bb5-output-filter-design.md": "Lock the @megasaver/output-filter package surface: filterOutput pipeline, resolveSafeReadPath, RankFeatureName, OutputSourceKind, closed enums, error codes, pipeline order, and the dependency allow-list.",
  "2026-05-10-bb7a-output-cli-design.md": "Ship three mega output subcommands — file (read+filter+persist), filter (filter an existing log), and chunk (return a stored chunk by id) — with locked output shapes and error codes.",
  "2026-05-10-bb7b-output-exec-design.md": "Ship mega output exec: the first user-visible child-process spawn in Mega Saver, mirroring the mega_run_command critical path from the CLI side with policy gating, exit-code mirroring, and re-entry detection.",
  "2026-05-10-nn-polish-bundle-design.md": "Bundle five small, independent stylistic/a11y polish items deferred from the GUI v1 review (heading semantics, npm warnings, focus styles) into one ship.",
  "2026-07-17-autopilot-policy-snapshot-design.md": "Fix a TOCTOU weakness in mega brain autopilot: it reads the autopilot policy twice with an await in between, so the fix reads one stable snapshot before the async boundary.",
  "2026-07-19-agent-continuity-platform-design.md": "Lock the long-horizon product direction: Mega Saver is developer-first now and an agent-agnostic continuity layer over time — a user-owned layer carrying trusted work state across agent, model, repo, and device boundaries, sequenced in four horizons.",
  "2026-07-19-long-memory-runtime-design.md": "Decide to build one evidence-backed long-memory runtime for both the developer product and LongMemEval-V2, with measured world-best claims gated on a reproducible official benchmark result.",
  "2026-07-20-long-memory-lm1-observations-design.md": "LM1 adds a product-ready, append-only observation store to @megasaver/long-memory that records cited state snapshots and transitions without changing MemoryEntry, Core, connectors, CLI, MCP, or the benchmark adapter.",
  "2026-07-20-long-memory-lm2-hybrid-recall-design.md": "LM2 adds a hybrid retrieval/selection engine combining deterministic lexical recall with an opt-in semantic lane, fusing only existing LM1 records; the Safe profile stays offline/deterministic, Adaptive degrades gracefully.",
  "2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md": "Add a canonical per-workspace quota ledger for LM2 vector sidecars, replacing whole-directory quota recomputation with a bounded allocation record to honor both the metadata-read cap and exact quotas.",
  "2026-05-10-mm-turbo-race-design.md": "Diagnose the intermittent pnpm exec turbo run test --force failure in the CLI vitest typecheck and lock a fix that keeps the typecheck deterministic under parallel turbo runs.",
  "2026-07-25-bench-replay-windows-spawn-design.md": "Fix the verify (windows-latest) CI failure on every PR and main by making the bench-replay harness spawn portable on Windows.",
};

function normRisk(r) {
  const s = (r || "").trim().toLowerCase();
  if (s.includes("critical")) return { key: "critical", label: "CRITICAL" };
  if (s.includes("high")) return { key: "high", label: "HIGH" };
  if (s.includes("medium") || s.includes("mixed")) return { key: "medium", label: "MEDIUM" };
  if (s.includes("low")) return { key: "low", label: "LOW" };
  if (s.includes("strategic") || s.includes("portfolio")) return { key: "mixed", label: "VARIED" };
  return { key: "na", label: "—" };
}

const esc = s => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const files = readdirSync(SPECS_DIR).filter(f => f.endsWith(".md")).sort();
const specs = [];
for (const f of files) {
  const txt = readFileSync(join(SPECS_DIR, f), "utf8");
  const fm = frontmatter(txt);
  let title = (fm.title || "").replace(/^['"]|['"]$/g, "");
  if (!title) title = firstHeading(txt) || "";
  if (!title) title = f.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-design\.md$/, "").replace(/\.md$/, "").replace(/-/g, " ");
  const date = fm.date || fm.created || (f.match(/^(\d{4}-\d{2}-\d{2})/) || [, ""])[1];
  const risk = normRisk(fm.risk);
  let p = purpose(txt);
  if ((!p || p.length < 60 || /:\s*$/.test(p)) && OVERRIDES[f]) p = OVERRIDES[f];
  if (p && /:\s*$/.test(p)) p = p.replace(/:\s*$/, "");
  specs.push({
    file: f,
    title,
    date,
    month: date.slice(0, 7),
    riskKey: risk.key,
    riskLabel: risk.label,
    purpose: p || "",
    url: GH + f,
  });
}
specs.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

const groups = new Map();
for (const s of specs) {
  if (!groups.has(s.month)) groups.set(s.month, []);
  groups.get(s.month).push(s);
}
const groupList = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
const riskCounts = {};
for (const s of specs) riskCounts[s.riskKey] = (riskCounts[s.riskKey] || 0) + 1;

let sections = "";
for (const [month, items] of groupList) {
  const rows = items.map(s => `
      <article class="spec" data-risk="${s.riskKey}" data-title="${esc(s.title.toLowerCase())}" data-purpose="${esc(s.purpose.toLowerCase())}">
        <div class="spec-head">
          <a class="spec-title" href="${s.url}">${esc(s.title)}</a>
          <div class="spec-meta">
            <span class="risk risk-${s.riskKey}">${esc(s.riskLabel)}</span>
            <span class="date tnum">${esc(s.date)}</span>
          </div>
        </div>
        <p class="spec-purpose">${esc(s.purpose)}</p>
      </article>`).join("");
  sections += `
  <section class="month" data-month="${month}">
    <div class="month-head">
      <h2 class="month-title">${esc(month)}</h2>
      <span class="month-count mono tnum">${items.length} spec${items.length === 1 ? "" : "s"}</span>
    </div>
    <div class="specs">${rows}</div>
  </section>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mega Saver — spec library</title>
<meta name="description" content="Every design spec in the Mega Saver repository — ${specs.length} specs spanning the bootstrap, the Context Gate epic, memory, the saver, and the stable v1.0.0 release. Evidence of the full superpowers chain.">
<link rel="canonical" href="https://megasaver.dev/specs">
<meta property="og:type" content="website">
<meta property="og:title" content="Mega Saver — spec library">
<meta property="og:description" content="${specs.length} design specs, each one brainstormed, planned, TDD'd, verified, and reviewed before a line shipped.">
<meta property="og:url" content="https://megasaver.dev/specs">
<meta property="og:image" content="https://megasaver.dev/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230e7a54'/%3E%3C/svg%3E">
<style>
  :root{
    --paper:#f1f2ef; --ink:#17181a; --muted:#5c5f5a; --hair:#dcdcd6;
    --accent:#0e7a54; --term:#17181a; --term-ink:#e8e9e4;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
    --maxw:1080px;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
    font-size:18px;line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .wrap{max-width:var(--maxw);margin:0 auto;padding:0 32px}
  a{color:inherit}
  .mono{font-family:var(--mono)}
  .tnum{font-variant-numeric:tabular-nums}
  .label{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
  .accent{color:var(--accent)}
  .sq{display:inline-block;width:.72em;height:.72em;background:var(--ink);vertical-align:baseline;margin-right:.5em;border-radius:2px}
  .sq.acc{background:var(--accent)}

  nav{border-bottom:1px solid var(--hair)}
  nav .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  .brand{font-weight:700;font-size:16px;letter-spacing:-.01em;display:flex;align-items:center;text-decoration:none}
  .brand .sq{width:11px;height:11px;margin-right:9px}
  nav .links{display:flex;gap:26px;font-family:var(--mono);font-size:13px;color:var(--muted)}
  nav .links a{text-decoration:none}
  nav .links a:hover{color:var(--ink)}

  header{padding:88px 0 40px}
  header .eyebrow{margin:0 0 22px}
  h1{font-size:clamp(40px,6.5vw,72px);line-height:.98;letter-spacing:-.035em;font-weight:800;margin:0;text-wrap:balance;max-width:16ch}
  .sub{font-size:clamp(17px,2vw,20px);color:var(--muted);max-width:62ch;margin:24px 0 0;line-height:1.5}
  .sub b{color:var(--ink);font-weight:600}

  .stats{display:flex;flex-wrap:wrap;gap:28px 56px;margin-top:40px}
  .stat .n{font-size:clamp(30px,4.5vw,46px);font-weight:800;letter-spacing:-.03em;line-height:.95}
  .stat .k{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:10px}
  .stat.big .n{color:var(--accent)}

  .controls{padding:28px 0 8px;position:sticky;top:0;background:var(--paper);z-index:5;border-bottom:1px solid var(--hair)}
  .controls .wrap{display:flex;flex-wrap:wrap;gap:14px;align-items:center}
  .search{flex:1 1 260px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--hair);
    border-radius:10px;padding:11px 14px;font-family:var(--mono);font-size:14px;color:var(--ink)}
  .search input{border:none;outline:none;background:transparent;font:inherit;color:inherit;width:100%;padding:0}
  .search input::placeholder{color:var(--muted)}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{font-family:var(--mono);font-size:12.5px;letter-spacing:.04em;color:var(--muted);
    border:1px solid var(--hair);background:transparent;padding:8px 13px;border-radius:999px;cursor:pointer;text-transform:uppercase}
  .chip:hover{color:var(--ink);border-color:var(--ink)}
  .chip.on{background:var(--ink);color:var(--term-ink);border-color:var(--ink)}
  .chip.on.c-critical{background:#b3261e;border-color:#b3261e}
  .chip.on.c-high{background:#c2410c;border-color:#c2410c}
  .chip.on.c-medium{background:#9a7b1c;border-color:#9a7b1c}
  .chip.on.c-low{background:#3c6e8f;border-color:#3c6e8f}
  .chip.on.c-mixed{background:#5c5f5a;border-color:#5c5f5a}
  .chip.on.c-na{background:#5c5f5a;border-color:#5c5f5a}
  .result-count{margin-left:auto;font-family:var(--mono);font-size:12.5px;color:var(--muted)}

  main{padding:8px 0 60px}
  .month{padding:40px 0 0}
  .month-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
    border-bottom:1px solid var(--hair);padding-bottom:12px;margin-bottom:2px}
  .month-title{font-family:var(--mono);font-size:15px;letter-spacing:.08em;font-weight:700;margin:0;text-transform:uppercase}
  .month-count{font-family:var(--mono);font-size:12.5px;color:var(--muted)}
  .spec{border-bottom:1px solid var(--hair);padding:22px 0}
  .spec-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 18px}
  .spec-title{font-weight:700;font-size:19px;letter-spacing:-.015em;text-decoration:none;line-height:1.3}
  .spec-title:hover{color:var(--accent)}
  .spec-meta{display:flex;align-items:center;gap:12px;margin-left:auto}
  .date{font-family:var(--mono);font-size:12px;color:var(--muted)}
  .risk{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;padding:3px 8px;border-radius:6px;border:1px solid var(--hair);color:var(--muted)}
  .risk-critical{color:#b3261e;border-color:#e0b4b0;background:#f7e9e7}
  .risk-high{color:#c2410c;border-color:#e6c3b0;background:#f8eee7}
  .risk-medium{color:#8a6d0b;border-color:#e0d3a8;background:#f7f2e0}
  .risk-low{color:#3c6e8f;border-color:#b9cedb;background:#eaf1f5}
  .risk-mixed,.risk-na{color:var(--muted);border-color:var(--hair);background:#ecede9}
  .spec-purpose{color:var(--muted);margin:9px 0 0;font-size:16px;line-height:1.55;max-width:80ch}
  .hidden{display:none!important}
  .empty{text-align:center;padding:72px 0;color:var(--muted);font-family:var(--mono);font-size:14px}

  footer{border-top:1px solid var(--hair);padding:40px 0 64px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between;align-items:baseline}
  footer .mono{font-size:12.5px;color:var(--muted);line-height:1.7;max-width:64ch}
  footer .brand{font-size:14px}

  @media(max-width:720px){
    body{font-size:17px}
    header{padding:60px 0 32px}
    .spec-head{flex-direction:column;align-items:flex-start;gap:8px}
    .spec-meta{margin-left:0}
    nav .links .hideable{display:none}
    .result-count{display:none}
  }
  @media(prefers-reduced-motion:no-preference){
    .reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.3,1) forwards}
    .reveal.d1{animation-delay:.06s}.reveal.d2{animation-delay:.14s}
    @keyframes rise{to{opacity:1;transform:none}}
  }
  a:focus-visible,.chip:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq"></span>Mega Saver</a>
    <div class="links">
      <a class="hideable" href="/#how">how it works</a>
      <a class="hideable" href="/pro">pricing</a>
      <a href="/">&#8592; back</a>
      <a href="https://github.com/haJ1t/MegaSaver">github &#8599;</a>
    </div>
  </div>
</nav>

<header>
  <div class="wrap">
    <div class="label eyebrow reveal">the spec library</div>
    <h1 class="reveal d1">Every feature was spec'd before it shipped.</h1>
    <p class="sub reveal d2">Mega Saver runs the full superpowers chain — brainstorm, plan, TDD, verify, external review — on every feature, no matter how small. This is the complete, searchable catalog of <b>${specs.length} design specs</b>, each linked to its source in the repository.</p>
    <div class="stats">
      <div class="stat big"><div class="n tnum">${specs.length}</div><div class="k">design specs</div></div>
      <div class="stat"><div class="n tnum">${riskCounts.critical || 0}</div><div class="k">critical risk</div></div>
      <div class="stat"><div class="n tnum">${riskCounts.high || 0}</div><div class="k">high risk</div></div>
      <div class="stat"><div class="n tnum">${groupList.length}</div><div class="k">months of work</div></div>
    </div>
  </div>
</header>

<div class="controls">
  <div class="wrap">
    <label class="search">
      <span aria-hidden="true">&#8981;</span>
      <input type="search" id="q" placeholder="search ${specs.length} specs&hellip;" aria-label="Search specs">
    </label>
    <div class="chips" id="chips" role="tablist" aria-label="Filter by risk">
      <button class="chip on" data-risk="all" role="tab" aria-selected="true">all</button>
      <button class="chip c-critical" data-risk="critical" role="tab" aria-selected="false">critical</button>
      <button class="chip c-high" data-risk="high" role="tab" aria-selected="false">high</button>
      <button class="chip c-medium" data-risk="medium" role="tab" aria-selected="false">medium</button>
      <button class="chip c-low" data-risk="low" role="tab" aria-selected="false">low</button>
    </div>
    <span class="result-count tnum" id="count">${specs.length} results</span>
  </div>
</div>

<main>
  <div class="wrap" id="list">
${sections}
  </div>
  <div class="empty hidden" id="empty">No specs match your search.</div>
</main>

<footer>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq acc"></span>Mega Saver</a>
    <div class="mono">Spec index generated from <span class="mono">docs/superpowers/specs/</span> in the Mega Saver repository &middot; risk levels follow the project's risk-modes convention &middot; MIT &middot; Not affiliated with Anthropic, Cursor, or OpenAI.</div>
  </div>
</footer>

<script>
(function(){
  var q = document.getElementById("q");
  var chips = Array.prototype.slice.call(document.querySelectorAll("#chips .chip"));
  var count = document.getElementById("count");
  var empty = document.getElementById("empty");
  var months = Array.prototype.slice.call(document.querySelectorAll(".month"));
  var specs = Array.prototype.slice.call(document.querySelectorAll(".spec"));
  var risk = "all";

  function apply(){
    var term = (q.value || "").trim().toLowerCase();
    var shown = 0;
    specs.forEach(function(s){
      var matchRisk = risk === "all" || s.getAttribute("data-risk") === risk;
      var hay = (s.getAttribute("data-title") + " " + s.getAttribute("data-purpose"));
      var matchTerm = !term || hay.indexOf(term) !== -1;
      var show = matchRisk && matchTerm;
      s.classList.toggle("hidden", !show);
      if (show) shown++;
    });
    months.forEach(function(m){
      var vis = m.querySelectorAll(".spec:not(.hidden)").length > 0;
      m.classList.toggle("hidden", !vis);
    });
    count.textContent = shown + " result" + (shown === 1 ? "" : "s");
    empty.classList.toggle("hidden", shown !== 0);
  }

  chips.forEach(function(c){
    c.addEventListener("click", function(){
      chips.forEach(function(x){ x.classList.remove("on"); x.setAttribute("aria-selected","false"); });
      c.classList.add("on"); c.setAttribute("aria-selected","true");
      risk = c.getAttribute("data-risk");
      apply();
    });
  });
  q.addEventListener("input", apply);
})();
</script>

</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${html.length} bytes): ${specs.length} specs across ${groupList.length} months.`);
