#!/usr/bin/env node
// Committed generator for site/specs/index.html — the capability-first
// "what Mega Saver does" page. Reads every spec in docs/superpowers/specs/,
// classifies it into a user-facing capability area, and emits a visual,
// dependency-free static page (inline SVG charts, no runtime deps).
//
//   node scripts/gen-specs-page.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPECS_DIR = "docs/superpowers/specs";
const OUT = "site/specs/index.html";
const GH = "https://github.com/haJ1t/MegaSaver/blob/main/docs/superpowers/specs/";

// ---------------------------------------------------------------------------
// Capability taxonomy — the user-facing areas a developer actually touches.
// ---------------------------------------------------------------------------
const CAPS = [
  {
    id: "saver",
    name: "Token Saver",
    tagline: "Cut token spend on every tool call",
    blurb:
      "Big reads, command runs, and noisy logs are compressed to the lines that matter — with the full raw output one call away, never thrown away.",
    surface: "mega output · mega session saver · proxy_* tools · PostToolUse hook",
    accent: "#0e7a54",
    icon: "bolt",
    match: [
      /saver/,
      /output-filter/,
      /output-cli/,
      /output-exec/,
      /compress/,
      /filter-matrix/,
      /exec-rewrite/,
      /cache-aware/,
      /cache-write/,
      /cache-boundary/,
      /compression-integrity/,
      /token-count-bound/,
      /token-saver-when/,
      /prose-compressor/,
      /already-in-context/,
      /dedup/,
      /intent-aware/,
      /saver-/,
    ],
    headline: [
      {
        file: "2026-07-28-saver-compression-integrity-design.md",
        name: "Save integrity",
        benefit: "Compression is proven lossless — saved bytes are real, recoverable, and audited.",
      },
      {
        file: "2026-05-10-bb5-output-filter-design.md",
        name: "Compression pipeline",
        benefit: "classify → rank → dedupe → fit → summarize, in one deterministic pass.",
      },
      {
        file: "2026-08-06-exec-rewrite-saver-design.md",
        name: "Exec-rewrite saver",
        benefit: "Commands are rewritten so compressed output is the only version cached.",
      },
      {
        file: "2026-08-06-filter-matrix-expansion-design.md",
        name: "Filter matrix",
        benefit: "Structured compressors for git, docker, npm, pip, cargo, terraform.",
      },
      {
        file: "2026-07-19-cache-aware-saver-design.md",
        name: "Cache-aware saver",
        benefit: "Compression that does not invalidate the model's prompt cache.",
      },
      {
        file: "2026-07-09-saver-recovery-design.md",
        name: "Always recoverable",
        benefit: "Multi-chunk recovery and GC that never deletes a live session's output.",
      },
      {
        file: "2026-07-11-saver-metrics-honesty-design.md",
        name: "Honest metrics",
        benefit: "Token-weighted savings that refuse to double-count or inflate.",
      },
      {
        file: "2026-06-30-prose-compressor-design.md",
        name: "Prose compressor",
        benefit: "Reversible extractive compression for docs and memory files.",
      },
    ],
  },
  {
    id: "memory",
    name: "Memory & Brain",
    tagline: "Never re-explain your repo",
    blurb:
      "Durable, human-approved facts about your project that every agent inherits — plus a portable, syncable, self-healing brain.",
    surface: "mega memory · mega brain · mega warmup · mega adopt",
    accent: "#7c3aed",
    icon: "brain",
    match: [
      /memory/,
      /brain/,
      /long-memory/,
      /lm0/,
      /lm1/,
      /lm2/,
      /living-brain/,
      /warm-start/,
      /mistake-firewall/,
      /embeddings/,
      /semantic-retrieval/,
      /from-session/,
      /write-verify/,
      /adopt/,
    ],
    headline: [
      {
        file: "2026-06-11-phase1-structured-memory-engine-design.md",
        name: "Structured memory",
        benefit:
          "Typed, approved facts — decisions, bugs, gotchas, conventions — recalled across sessions.",
      },
      {
        file: "2026-06-12-phase10-team-cloud-design.md",
        name: "Approval gate",
        benefit: "Agents suggest, a human approves. Nothing enters recall unvetted.",
      },
      {
        file: "2026-06-30-semantic-retrieval-design.md",
        name: "Semantic recall",
        benefit: "Hybrid BM25 + embeddings find the right memory, not just keyword hits.",
      },
      {
        file: "2026-06-18-memory-graph-design.md",
        name: "Memory graph",
        benefit: "See how memories connect, conflict, and supersede each other.",
      },
      {
        file: "2026-07-11-brain-sync-design.md",
        name: "Brain sync",
        benefit: "Your brain follows you across machines, E2E-encrypted to your own S3.",
      },
      {
        file: "2026-08-06-brain-doctor-design.md",
        name: "Brain doctor",
        benefit: "One command explains your brain's health and points at the exact repair.",
      },
      {
        file: "2026-07-12-warm-start-design.md",
        name: "Warm start",
        benefit: "Every session boots with a budgeted brief assembled from the project brain.",
      },
      {
        file: "2026-08-06-memory-write-verify-design.md",
        name: "Write-verify",
        benefit: "Agent-written memories must resolve evidence before they persist.",
      },
      {
        file: "2026-07-20-long-memory-lm2-hybrid-recall-design.md",
        name: "Long memory (LM2)",
        benefit: "Evidence-backed hybrid recall — the benchmark runtime, now the product.",
      },
    ],
  },
  {
    id: "reads",
    name: "Smart Reads",
    tagline: "The model sees what matters",
    blurb:
      "Files and context reach the model on real boundaries, ranked by your task — not dumped as raw walls of text.",
    surface: "proxy_read_file · context packs · outline-first · intent hook",
    accent: "#2563eb",
    icon: "book",
    match: [
      /context-gate/,
      /contextgate/,
      /semantic-ast/,
      /outline-first/,
      /diff-on-reread/,
      /semantic-repo-index/,
      /indexer/,
      /callgraph/,
      /binding-resolution/,
      /context-pruner/,
      /context-pack/,
      /context-contract/,
      /context-yield/,
      /context-drop/,
      /live-context-seam/,
      /context-daemon/,
      /context-ledger/,
      /evidence-ledger/,
      /reliable-save-ledger/,
      /honest-90/,
      /cochange/,
      /edit-impact/,
      /phase2-semantic/,
      /phase3-context/,
    ],
    headline: [
      {
        file: "2026-06-26-semantic-ast-read-design.md",
        name: "AST reads",
        benefit:
          "Files split on function/class boundaries, so the model sees whole coherent units.",
      },
      {
        file: "2026-06-29-outline-first-read-design.md",
        name: "Outline-first",
        benefit: "Signatures first, bodies on demand — lossless and additive.",
      },
      {
        file: "2026-06-25-diff-on-reread-design.md",
        name: "Unchanged re-reads",
        benefit: "Re-reading an unchanged file returns a pointer, not the file again.",
      },
      {
        file: "2026-06-26-already-in-context-dedup-design.md",
        name: "In-context dedup",
        benefit: "Never re-send what's already in the context window.",
      },
      {
        file: "2026-06-25-intent-aware-hook-design.md",
        name: "Intent-aware ranking",
        benefit: "Compression keeps the lines about your current task, not generic ones.",
      },
      {
        file: "2026-08-11-context-yield-audit-design.md",
        name: "Context yield audit",
        benefit:
          "A freeloader table showing which injected memories and rules actually earn their place.",
      },
      {
        file: "2026-06-11-phase2-semantic-repo-index-design.md",
        name: "Repo index",
        benefit: "Typed code blocks so retrieval works on blocks, not files.",
      },
    ],
  },
  {
    id: "safety",
    name: "Safety & Redaction",
    tagline: "Secrets never leak",
    blurb:
      "Secrets and PII are stripped before anything is stored or sent, and the redaction itself is hardened against pathological input.",
    surface: "redaction pipeline · context firewall · permissions.yaml",
    accent: "#dc2626",
    icon: "shield",
    match: [
      /redaction/,
      /secret-path/,
      /deny-write/,
      /jwt-redos/,
      /glob-compile/,
      /redos/,
      /lookahead/,
      /permissions-yaml/,
      /policy/,
      /carrier-residual/,
      /inert-mcp/,
      /firewall/,
      /paste-airlock/,
    ],
    headline: [
      {
        file: "2026-07-19-redaction-baseline-extension-design.md",
        name: "Redaction baseline",
        benefit:
          "Secrets are stripped before anything is stored — the invariant the whole product rests on.",
      },
      {
        file: "2026-07-25-secret-path-home-credentials-design.md",
        name: "Secret-path denylist",
        benefit: "Home credential stores and private keys never reach the model.",
      },
      {
        file: "2026-07-08-context-firewall-design.md",
        name: "Context firewall",
        benefit: "Blocked secret reads and PII redactions, with an auditable leak ledger.",
      },
      {
        file: "2026-07-25-redaction-superlinear-patterns-design.md",
        name: "ReDoS-proof redaction",
        benefit:
          "Regexes that cannot hang on pathological input, proven by a growth-ratio harness.",
      },
      {
        file: "2026-07-25-glob-compile-redos-fix-design.md",
        name: "Safe glob matching",
        benefit: "Path-glob matching rebuilt on an NFA matcher — no regex injection.",
      },
      {
        file: "2026-06-03-permissions-yaml-design.md",
        name: "Permissions",
        benefit: "Tighten-only command and path allow-lists at the project boundary.",
      },
      {
        file: "2026-08-06-paste-airlock-design.md",
        name: "Paste airlock",
        benefit: "Pasted content is held and inspected before it can act on your repo.",
      },
    ],
  },
  {
    id: "trust",
    name: "Trust & Verification",
    tagline: "Prove it before you trust it",
    blurb:
      "Success claims are joined to receipts, packages are checked against reality, and reviews produce receipts that prove coverage.",
    surface: "mega verify · mega review · mega prove bite · firewall",
    accent: "#ea580c",
    icon: "seal",
    match: [
      /claim-verification/,
      /silent-failure/,
      /package-hallucination/,
      /review-attestation/,
      /code-truth/,
      /test-bite/,
      /undisclosed-change/,
      /flake-adjudicator/,
      /review-pack/,
      /probe-parity/,
      /redos-guard-determinism/,
      /mistake-airlock/,
    ],
    headline: [
      {
        file: "2026-08-06-claim-verification-gate-design.md",
        name: "Claim-verification gate",
        benefit: "“Done” is joined to the actual exec receipt — no unverified success claims.",
      },
      {
        file: "2026-08-06-package-hallucination-firewall-design.md",
        name: "Package firewall",
        benefit: "Blocks imports of packages that don't exist before they waste a session.",
      },
      {
        file: "2026-08-06-silent-failure-monitor-design.md",
        name: "Silent-failure monitor",
        benefit: "Surfaces failures that would otherwise vanish into the log.",
      },
      {
        file: "2026-08-08-review-attestation-design.md",
        name: "Review attestation",
        benefit: "Receipts prove a review covered the code that actually shipped.",
      },
      {
        file: "2026-07-13-code-truth-verify-design.md",
        name: "Code-truth verify",
        benefit: "Claims about code are checked against the code itself.",
      },
      {
        file: "2026-08-06-test-bite-proof-design.md",
        name: "Test-bite proof",
        benefit: "Proves a test actually catches the bug it claims to cover.",
      },
      {
        file: "2026-07-12-mistake-firewall-design.md",
        name: "Mistake firewall",
        benefit: "Past mistakes become rules that block repeats before they happen.",
      },
    ],
  },
  {
    id: "continuity",
    name: "Continuity & Handoff",
    tagline: "Pick up where you left off",
    blurb:
      "Live task state moves between agents, dead sessions are rebuilt, and every task starts with a bounded kickoff brief.",
    surface: "mega handoff · mega resume · mega warmup · mega fork",
    accent: "#0891b2",
    icon: "handoff",
    match: [
      /handoff/,
      /session-resurrection/,
      /compaction-guard/,
      /cross-agent-handoff/,
      /agent-continuity/,
      /mission-control/,
      /conversation-fork/,
      /resume/,
      /task-kickoff/,
      /session-residue/,
    ],
    headline: [
      {
        file: "2026-07-18-hot-handoff-design.md",
        name: "Hot handoff",
        benefit: "Pack live task state and hand it to another agent mid-session.",
      },
      {
        file: "2026-08-06-session-resurrection-design.md",
        name: "Session resurrection",
        benefit: "A dead session's working context is rebuilt into a bounded kickoff capsule.",
      },
      {
        file: "2026-08-06-compaction-guard-design.md",
        name: "Compaction guard",
        benefit: "After compaction, the agent is reconnected to what it still needs.",
      },
      {
        file: "2026-08-01-task-kickoff-final-hardening-design.md",
        name: "Task kickoff",
        benefit: "A bounded, safe kickoff brief for every task — nothing more, nothing less.",
      },
      {
        file: "2026-08-11-conversation-fork-time-travel-design.md",
        name: "Conversation fork",
        benefit: "Snapshot a conversation and resume from a pending capsule.",
      },
    ],
  },
  {
    id: "mesh",
    name: "Multi-Agent Mesh & Office",
    tagline: "Many agents, one team",
    blurb:
      "Parallel agents see each other, share a board, and hand work back and forth — files are the source of truth, pull-based.",
    surface: "mega mesh · mega office · mega board · mega task",
    accent: "#db2777",
    icon: "mesh",
    match: [
      /mesh/,
      /office/,
      /board/,
      /peer-qa/,
      /blackboard/,
      /task-engine/,
      /planner/,
      /agent-blame/,
      /agent-office/,
      /flow-governor/,
      /agent-session/,
      /tool-router/,
      /phase6-task/,
      /phase7-tool/,
    ],
    headline: [
      {
        file: "2026-08-12-session-mesh-family-design.md",
        name: "Session mesh",
        benefit: "Live presence, messaging, and claims across parallel agents in one repo.",
      },
      {
        file: "2026-06-22-agent-office-design.md",
        name: "Agent office",
        benefit: "Roster, roles, task queues, and a live board for many agents.",
      },
      {
        file: "2026-08-06-structured-blackboard-design.md",
        name: "Structured blackboard",
        benefit: "Post, resolve, and promote facts on a shared board.",
      },
      {
        file: "2026-08-06-peer-qa-routing-design.md",
        name: "Peer Q&A",
        benefit: "Agents ask each other — rate-limited and keyword-hinted.",
      },
      {
        file: "2026-08-06-flow-governor-design.md",
        name: "Flow governor",
        benefit: "Advisory nudges keep a session from running away.",
      },
      {
        file: "2026-06-12-phase6-task-engine-design.md",
        name: "Task engine",
        benefit: "Decompose a task into a tracked, retryable plan with selective retry.",
      },
    ],
  },
  {
    id: "observability",
    name: "Observability & Analytics",
    tagline: "Know what you saved",
    blurb:
      "Token savings, cost, decision traces, and anomaly alerts — honest numbers, labeled estimates, never inflated.",
    surface: "mega audit · mega cost · mega savings · mega alerts · mega why",
    accent: "#ca8a04",
    icon: "chart",
    match: [
      /audit/,
      /stats/,
      /cost-ledger/,
      /hotspot/,
      /decision-trace/,
      /mega-why/,
      /telemetry/,
      /savings/,
      /alerts/,
      /budget/,
      /roi/,
      /bench/,
      /teardown/,
      /discover/,
      /cache-doctor/,
      /cache-advice/,
      /cache-phases/,
      /cache-churn/,
      /insights/,
      /forecast/,
      /share-card/,
      /headline/,
      /entitlement/,
      /pricing/,
      /batch-read/,
      /phase8-audit/,
    ],
    headline: [
      {
        file: "2026-06-12-phase8-audit-dashboard-design.md",
        name: "Audit dashboard",
        benefit: "A windowed, persisted token-savings summary — your running receipt.",
      },
      {
        file: "2026-08-06-cost-ledger-design.md",
        name: "Cost ledger",
        benefit: "Spend and savings receipts by project, task, agent, and session.",
      },
      {
        file: "2026-07-04-decision-trace-viewer-design.md",
        name: "Decision-trace viewer",
        benefit: "See why each context happened — the causal chain behind every output.",
      },
      {
        file: "2026-08-11-token-hotspot-heatmap-design.md",
        name: "Token hotspot heatmap",
        benefit: "See which files and outputs burn the most tokens.",
      },
      {
        file: "2026-08-08-mega-why-forensics-design.md",
        name: "mega why",
        benefit: "One command explains the raw-vs-delivered gap for the last failure.",
      },
      {
        file: "2026-08-06-mega-discover-design.md",
        name: "Missed-savings finder",
        benefit: "Honest report of output that bypassed the saver, grouped by cause.",
      },
      {
        file: "2026-07-06-pro-entitlement-design.md",
        name: "Savings analytics (Pro)",
        benefit: "History, insights, forecast, and share cards — with CSV/JSON export.",
      },
      {
        file: "2026-07-09-anomaly-alerts-budgets-design.md",
        name: "Anomaly alerts & budgets",
        benefit: "Median+MAD spike detection and persistent savings goals.",
      },
      {
        file: "2026-08-06-budget-circuit-breaker-design.md",
        name: "Budget circuit breaker",
        benefit: "Per-session and per-task token limits with warn-only alarms.",
      },
    ],
  },
  {
    id: "proxy",
    name: "Proxy & Metering",
    tagline: "Count tokens, not conversations",
    blurb:
      "An opt-in transparent proxy records token counts only — never prompts, responses, or keys — and never compresses by default.",
    surface: "mega proxy · mega proxy start",
    accent: "#64748b",
    icon: "meter",
    match: [/proxy/, /llm-proxy/],
    headline: [
      {
        file: "2026-06-12-proxy-mode-v1.2-design.md",
        name: "Proxy mode",
        benefit: "Transparent token metering — counts only, on loopback, opt-in.",
      },
      {
        file: "2026-07-02-persistent-proxy-routing-design.md",
        name: "Persistent routing",
        benefit: "A dedicated supervisor keeps the proxy up without EADDRINUSE crash-loops.",
      },
      {
        file: "2026-07-14-proxy-first-party-cache-parity-design.md",
        name: "Cache parity",
        benefit: "Routing through the proxy no longer taxes the prompt cache.",
      },
    ],
  },
  {
    id: "gui",
    name: "Desktop Console",
    tagline: "See it in the browser",
    blurb:
      "A loopback-only dashboard with a one-time token — sessions, memory, the saver toggle, and the setup doctor, all keyboard-reachable and WCAG AA.",
    surface: "mega gui · /api routes · live session cockpit",
    accent: "#0f766e",
    icon: "screen",
    match: [
      /gui/,
      /live-first/,
      /redesign/,
      /console/,
      /electron/,
      /pro-analytics-live-wire/,
      /doctor-gui/,
      /minimalist/,
      /tokensaver/,
      /agent-setup/,
      /workspace-token/,
      /claude-code-live-sessions/,
      /session-cockpit/,
      /visualization-layout/,
    ],
    headline: [
      {
        file: "2026-05-10-ll-gui-v1-design.md",
        name: "Desktop console",
        benefit: "The localhost dashboard served by mega gui — no clone, no build.",
      },
      {
        file: "2026-06-14-live-first-phase2-session-cockpit.md",
        name: "Live session cockpit",
        benefit: "A live-first dashboard over running Claude Code sessions.",
      },
      {
        file: "2026-05-13-bb11-gui-doctor-design.md",
        name: "Setup doctor",
        benefit: "Install and repair the bridge and connector blocks in one click.",
      },
      {
        file: "2026-08-08-gui-pro-analytics-live-wire-design.md",
        name: "Live analytics",
        benefit: "Dashboard numbers wired to real ledgers — it stops lying.",
      },
      {
        file: "2026-07-03-gui-redesign-v3-design.md",
        name: "Editorial redesign",
        benefit: "Sidebar shell and amber editorial — a calmer, clearer console.",
      },
    ],
  },
  {
    id: "dx",
    name: "Setup & Connectors",
    tagline: "Works with your agent",
    blurb:
      "Thin connectors for Claude Code, Codex, Cursor, and Aider — plus one-command onboarding, hooks, the MCP bridge, and skill packs.",
    surface: "mega init · mega up · mega connector · mega mcp · mega hooks",
    accent: "#16a34a",
    icon: "plug",
    match: [
      /init/,
      /one-command-up/,
      /up-design/,
      /down/,
      /preflight/,
      /fence/,
      /doctor/,
      /mcp/,
      /connector/,
      /skill-pack/,
      /conventions-sync/,
      /project/,
      /session-crud/,
      /cli-package/,
      /citty/,
      /closed-enum/,
      /schema/,
      /title/,
      /aa2/,
      /aa3/,
      /aa4/,
      /y3/,
      /y5/,
      /t6/,
      /hook/,
      /agent-setup/,
      /warmup/,
      /launch/,
    ],
    headline: [
      {
        file: "2026-07-06-mega-init-design.md",
        name: "One-command init",
        benefit: "Hooks, MCP bridge, and the dashboard in a single mega init.",
      },
      {
        file: "2026-08-06-one-command-up-design.md",
        name: "mega up / down",
        benefit: "Activate everything idempotently, with manifest-backed reversal.",
      },
      {
        file: "2026-05-09-mega-connector-sync-design.md",
        name: "Connectors",
        benefit:
          "Instruction blocks for Claude Code, Codex, Cursor, and Aider — your content preserved.",
      },
      {
        file: "2026-06-15-realized-saver-hook-design.md",
        name: "Saver hook",
        benefit: "Native tool output compressed automatically via a PostToolUse hook.",
      },
      {
        file: "2026-05-13-bb8-mcp-bridge-design.md",
        name: "MCP bridge",
        benefit: "35+ tools over stdio, each publishing a real Zod input schema.",
      },
      {
        file: "2026-08-06-mcp-security-doctor-design.md",
        name: "MCP security doctor",
        benefit: "Audits your MCP config for clones, shadowing, and non-localhost URLs.",
      },
      {
        file: "2026-08-06-generated-file-fence-design.md",
        name: "Generated-file fence",
        benefit: "Protects generated files, lockfiles, and build output from agent edits.",
      },
      {
        file: "2026-06-10-skill-packs-real-design.md",
        name: "Skill packs",
        benefit: "Discover, install, and load agent skills — with path-escape guards.",
      },
    ],
  },
  {
    id: "platform",
    name: "Platform & Foundation",
    tagline: "The engine underneath",
    blurb:
      "The agent-agnostic core, the context-gate pipeline, Windows support, atomic writes, and the governance files — the bedrock every feature builds on.",
    surface: "@megasaver/core · context-gate · indexer · content-store",
    accent: "#52525b",
    icon: "cog",
    match: [
      /bootstrap/,
      /skeleton/,
      /core-package/,
      /shared-package/,
      /core-persistence/,
      /core-hardening/,
      /windows/,
      /atomic-write/,
      /json-store/,
      /turbo-race/,
      /file-split/,
      /on-demand-core/,
      /docs-cleanup/,
      /docs-drift/,
      /polish/,
      /electron/,
      /aa1-context-gate/,
      /bb12-context-gate/,
      /context-gate-extract/,
      /bb7/,
      /bb4/,
      /bb3/,
      /phase4-mcp-server/,
      /phase9-connectors/,
      /quantum-context/,
    ],
    headline: [
      {
        file: "2026-05-04-core-package-design.md",
        name: "Core engine",
        benefit: "The agent-agnostic engine — agents connect to it, never the reverse.",
      },
      {
        file: "2026-05-10-aa1-context-gate-epic.md",
        name: "Context gate",
        benefit: "The redact → chunk → rank → fit → summarize pipeline, as its own package.",
      },
      {
        file: "2026-06-11-windows-port-design.md",
        name: "Windows support",
        benefit: "Full win32 store path, CRLF-safe writes, and a Windows CI matrix.",
      },
      {
        file: "2026-06-22-atomic-write-fsync-edge-design.md",
        name: "Atomic writes",
        benefit: "A committed write never fails on a post-rename fsync error.",
      },
      {
        file: "2026-07-17-json-store-helper-design.md",
        name: "JSON store helper",
        benefit: "One durable atomic-JSON-store mechanic, shared by every package.",
      },
      {
        file: "2026-05-03-mega-saver-bootstrap-design.md",
        name: "Bootstrap & governance",
        benefit: "The repo skeleton and the agent governance files that dogfood the product.",
      },
      {
        file: "2026-08-11-on-demand-core-design.md",
        name: "On-demand core",
        benefit: "A daemonless lazy worker, so the standalone bundle stays lean.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Spec extraction
// ---------------------------------------------------------------------------
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
function normRisk(r) {
  const s = (r || "").trim().toLowerCase();
  if (s.includes("critical")) return "critical";
  if (s.includes("high")) return "high";
  if (s.includes("medium") || s.includes("mixed")) return "medium";
  if (s.includes("low")) return "low";
  if (s.includes("strategic") || s.includes("portfolio")) return "mixed";
  return "na";
}
function classify(file, title) {
  const hay = `${file} ${title}`.toLowerCase();
  for (const c of CAPS) if (c.match.some((re) => re.test(hay))) return c.id;
  return "platform";
}

const files = readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

// Headline specs are authoritative: force them into their declared capability
// so a headline never drifts into a different bucket than the curated list.
const headlineCap = new Map();
for (const c of CAPS) for (const h of c.headline) headlineCap.set(h.file, c.id);

const specs = [];
for (const f of files) {
  const txt = readFileSync(join(SPECS_DIR, f), "utf8");
  const fm = frontmatter(txt);
  let title = (fm.title || "").replace(/^['"]|['"]$/g, "");
  if (!title) title = firstHeading(txt) || "";
  if (!title)
    title = f
      .replace(/^\d{4}-\d{2}-\d{2}-/, "")
      .replace(/-design\.md$/, "")
      .replace(/\.md$/, "")
      .replace(/-/g, " ");
  const date = fm.date || fm.created || (f.match(/^(\d{4}-\d{2}-\d{2})/) || [undefined, ""])[1];
  specs.push({
    file: f,
    title,
    date,
    month: date.slice(0, 7),
    risk: normRisk(fm.risk),
    cap: headlineCap.get(f) || classify(f, title),
    url: GH + f,
  });
}

// ---------------------------------------------------------------------------
// Clean a raw title into something a person reads (strip internal codes).
// ---------------------------------------------------------------------------
function cleanTitle(t) {
  let s = t;
  s = s.replace(
    /^(BB\d+|AA\d+|CC\d*|DD\d*|GG|HH|II|JJ|LL|MM|NN|OO|PP|FF|S\d+|Z\d+|T\d+|I\d+|M\d+|C\d+|A\d+|B\d+|E\d+|P\d+-\d+|P\d+|WS\d+|LM\d+|L\d+)\s*[-—:]\s*/i,
    "",
  );
  s = s.replace(/^Phase\s*\d+\s*[-—:]\s*/i, "");
  s = s.replace(/^wave-\d+\s*(#\d+)?\s*[-—:]\s*/i, "");
  s = s.replace(/^Design Spec\s*[-—:]\s*/i, "");
  s = s.replace(/^Spec\s*[-—:]\s*/i, "");
  s = s.replace(
    /\s*[-—]\s*(design|design spec|exhaustive specification|spec|child spec|epic spec)\s*$/i,
    "",
  );
  s = s.replace(
    /\s*\((wave-\d+\s*#?\d*|roadmap [\d.]+|v\d[\d.]*|#[A-Z]\d+|idea [A-Z]\d+|child-spec #\d+|slice \d+|phase [A-Z0-9]+|[A-Z]\d+)\)\s*$/i,
    "",
  );
  s = s.replace(/\s*[-—]\s*design\s*$/i, "");
  s = s.trim().replace(/[:\s]+$/, "");
  if (!s) return t;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Assemble per-capability data
// ---------------------------------------------------------------------------
const capById = new Map(CAPS.map((c) => [c.id, c]));
for (const s of specs) {
  const c = capById.get(s.cap);
  if (!c.all) c.all = [];
  c.all.push(s);
}
for (const c of CAPS) {
  c.total = (c.all || []).length;
}

const RISK_COLORS = {
  critical: "#b3261e",
  high: "#c2410c",
  medium: "#9a7b1c",
  low: "#3c6e8f",
  mixed: "#8b8f88",
  na: "#dcdcd6",
};
const RISK_LABELS = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  mixed: "varied",
  na: "unrated",
};
const riskCounts = { critical: 0, high: 0, medium: 0, low: 0, mixed: 0, na: 0 };
for (const s of specs) riskCounts[s.risk]++;
const monthCounts = {};
for (const s of specs) monthCounts[s.month] = (monthCounts[s.month] || 0) + 1;
const monthList = Object.keys(monthCounts).sort();

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// --- SVG helpers (inline, no runtime deps) ---
function donutSVG() {
  const order = ["critical", "high", "medium", "low", "mixed", "na"];
  const total = specs.length;
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const segs = order
    .filter((k) => riskCounts[k] > 0)
    .map((k) => {
      const frac = riskCounts[k] / total;
      const seg = { k, frac, start: acc };
      acc += frac;
      return seg;
    });
  const circles = segs
    .map((s) => {
      const dash = s.frac * C;
      const offset = -s.start * C;
      return `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${RISK_COLORS[s.k]}" stroke-width="22" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 70 70)"/>`;
    })
    .join("");
  const legend = segs
    .map((s) => {
      const pct = Math.round(s.frac * 100);
      return `<div class="leg"><span class="dot" style="background:${RISK_COLORS[s.k]}"></span><span>${esc(RISK_LABELS[s.k])}</span><b class="tnum">${riskCounts[s.k]}</b><span class="pct tnum">${pct}%</span></div>`;
    })
    .join("");
  return `<div class="donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="Risk distribution across all specs">${circles}<text x="70" y="65" text-anchor="middle" class="donut-n">${total}</text><text x="70" y="82" text-anchor="middle" class="donut-k">specs</text></svg><div class="legend">${legend}</div></div>`;
}

function barsSVG() {
  const max = Math.max(...Object.values(monthCounts));
  const W = 260;
  const H = 120;
  const bw = 44;
  const gap = 18;
  const labels = { "2026-05": "May", "2026-06": "Jun", "2026-07": "Jul", "2026-08": "Aug" };
  const bars = monthList
    .map((m, i) => {
      const h = Math.round((monthCounts[m] / max) * (H - 26));
      const x = 8 + i * (bw + gap);
      const y = H - h;
      return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="4" class="bar"/><text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" class="bar-label">${labels[m] || m}</text><text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="bar-n">${monthCounts[m]}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Specs shipped per month">${bars}</svg>`;
}

function pipelineSVG() {
  const stages = [
    ["redact", "#dc2626"],
    ["chunk", "#2563eb"],
    ["rank", "#ca8a04"],
    ["fit", "#0891b2"],
    ["summarize", "#0e7a54"],
  ];
  const W = 760;
  const H = 96;
  const boxW = 112;
  const boxH = 44;
  const gap = 38;
  const startX = 30;
  let out = "";
  stages.forEach(([label, color], i) => {
    const x = startX + i * (boxW + gap);
    const y = (H - boxH) / 2;
    out += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="9" fill="${color}"/>`;
    out += `<text x="${x + boxW / 2}" y="${y + boxH / 2 + 5}" text-anchor="middle" class="pipe-label">${label}</text>`;
    if (i < stages.length - 1) {
      const ax = x + boxW + 6;
      const ay = y + boxH / 2;
      out += `<line x1="${ax}" y1="${ay}" x2="${ax + gap - 12}" y2="${ay}" class="pipe-arrow"/><path d="M ${ax + gap - 12} ${ay} l -6 -4 v 8 z" class="pipe-arrow"/>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The compression pipeline: redact, chunk, rank, fit, summarize">${out}</svg>`;
}

// --- Icons (24x24 stroke set, inline) ---
const ICONS = {
  bolt: '<path d="M13 2 L4 14 h6 l-1 8 L18 10 h-6 z"/>',
  brain:
    '<path d="M9 4a3 3 0 0 0-3 3c0 .6.2 1.2.5 1.7A3 3 0 0 0 4 12a3 3 0 0 0 1.5 2.6A3 3 0 0 0 9 18c.5 0 1-.1 1.4-.3V6.3C9.9 4.1 9 4 9 4z"/><path d="M15 4a3 3 0 0 1 3 3c0 .6-.2 1.2-.5 1.7A3 3 0 0 1 20 12a3 3 0 0 1-1.5 2.6A3 3 0 0 1 15 18c-.5 0-1-.1-1.4-.3V6.3C14.1 4.1 15 4 15 4z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2z"/><path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9.5 12l2 2 3.5-4"/>',
  seal: '<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5l2.2 2.2 4.8-5"/>',
  handoff:
    '<path d="M4 7h9a3 3 0 0 1 3 3v7"/><path d="M13 14l3 3 3-3"/><path d="M20 17h-9a3 3 0 0 1-3-3V7"/><path d="M11 10L8 7 5 10"/>',
  mesh: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.5 8l3 6M16.5 8l-3 6M8 6h8"/>',
  chart:
    '<path d="M4 20h16"/><rect x="6" y="12" width="3" height="6" rx="1"/><rect x="11" y="8" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="14" rx="1"/>',
  meter: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M5 15a7 7 0 0 1 12-2"/>',
  screen: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  plug: '<path d="M9 7V3M15 7V3"/><path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5z"/><path d="M12 16v5"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
};
function iconSvg(id) {
  const body = ICONS[id] || ICONS.cog;
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const cards = CAPS.map(
  (c) => `
      <a class="cap-card reveal" href="#cap-${c.id}" data-cap="${c.id}" style="--cap-accent:${c.accent}">
        <span class="cap-ic">${iconSvg(c.icon)}</span>
        <span class="cap-name">${esc(c.name)}</span>
        <span class="cap-tag">${esc(c.tagline)}</span>
        <span class="cap-count mono tnum">${c.total} spec${c.total === 1 ? "" : "s"}</span>
      </a>`,
).join("");

const sections = CAPS.map((c) => {
  const headline = c.headline
    .map((h) => {
      const s = specs.find((x) => x.file === h.file);
      const risk = s ? s.risk : "na";
      const url = s ? s.url : "#";
      return `
      <div class="feature">
        <div class="feature-head">
          <h3 class="feature-name"><a href="${url}">${esc(h.name)}</a></h3>
          <span class="risk risk-${risk}" title="risk level">${esc(RISK_LABELS[risk])}</span>
        </div>
        <p class="feature-benefit">${esc(h.benefit)}</p>
      </div>`;
    })
    .join("");
  const allSorted = (c.all || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const restRows = allSorted
    .map(
      (s) => `
      <li class="rest-item">
        <a href="${s.url}">${esc(cleanTitle(s.title))}</a>
        <span class="risk risk-${s.risk}">${esc(RISK_LABELS[s.risk])}</span>
        <span class="date tnum">${esc(s.date)}</span>
      </li>`,
    )
    .join("");
  const restBlock = `<details class="rest"><summary class="mono">all ${c.total} specs in this area</summary><ul class="rest-list">${restRows}</ul></details>`;
  return `
  <section class="cap" id="cap-${c.id}" data-cap="${c.id}">
    <div class="cap-head" style="--cap-accent:${c.accent}">
      <span class="cap-ic big">${iconSvg(c.icon)}</span>
      <div class="cap-head-text">
        <div class="cap-name-row">
          <h2>${esc(c.name)}</h2>
          <span class="cap-total mono tnum">${c.total} specs</span>
        </div>
        <p class="cap-tagline">${esc(c.tagline)}</p>
        <p class="cap-blurb">${esc(c.blurb)}</p>
        <p class="cap-surface mono">${esc(c.surface)}</p>
      </div>
    </div>
    <div class="features">${headline}</div>
    ${restBlock}
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mega Saver — what it does</title>
<meta name="description" content="What Mega Saver actually does, mapped by capability — Token Saver, Memory, Smart Reads, Safety, Trust, Continuity, Multi-Agent Mesh, Observability, Proxy, Console, Connectors, and the platform underneath. Each capability traces to its design specs.">
<link rel="canonical" href="https://megasaver.dev/specs">
<meta property="og:type" content="website">
<meta property="og:title" content="Mega Saver — what it does">
<meta property="og:description" content="Twelve capability areas, every one traced to its design specs. Token Saver, Memory, Smart Reads, Safety, Trust, Continuity, Multi-Agent Mesh, Observability, and more.">
<meta property="og:url" content="https://megasaver.dev/specs">
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

  header{padding:88px 0 28px}
  header .eyebrow{margin:0 0 22px}
  h1{font-size:clamp(40px,6vw,68px);line-height:.98;letter-spacing:-.035em;font-weight:800;margin:0;text-wrap:balance;max-width:18ch}
  .sub{font-size:clamp(17px,2vw,20px);color:var(--muted);max-width:66ch;margin:22px 0 0;line-height:1.5}
  .sub b{color:var(--ink);font-weight:600}

  .statband{display:flex;flex-wrap:wrap;gap:22px 48px;margin-top:40px;padding:22px 0;border-top:1px solid var(--hair)}
  .stat .n{font-size:clamp(30px,4vw,44px);font-weight:800;letter-spacing:-.03em;line-height:.95}
  .stat .k{font-family:var(--mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:9px}
  .stat.big .n{color:var(--accent)}

  .pipeline-band{padding:28px 0 8px}
  .pipeline-band .cap{text-align:center;font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:14px}
  .pipeline-band svg{width:100%;max-width:760px;height:auto;display:block;margin:0 auto}
  .pipe-label{fill:#fff;font-family:var(--mono);font-size:13px;font-weight:600}
  .pipe-arrow{stroke:var(--hair);stroke-width:2}

  .charts{padding:30px 0 20px;display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .chart-card{border:1px solid var(--hair);border-radius:16px;padding:26px 26px;background:#fff}
  .chart-card h2{font-size:14px;letter-spacing:.1em;text-transform:uppercase;font-family:var(--mono);margin:0 0 16px;color:var(--muted);font-weight:600}
  .donut-wrap{display:flex;align-items:center;gap:26px;flex-wrap:wrap}
  .donut-wrap svg{width:150px;height:150px;flex:0 0 auto}
  .donut-n{font-size:26px;font-weight:800;fill:var(--ink);font-family:var(--sans)}
  .donut-k{font-size:11px;fill:var(--muted);font-family:var(--mono)}
  .legend{display:flex;flex-direction:column;gap:9px;font-size:14px;min-width:150px}
  .leg{display:flex;align-items:center;gap:9px;color:var(--muted)}
  .leg .dot{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
  .leg b{color:var(--ink);margin-left:auto;font-weight:600}
  .leg .pct{color:var(--muted);width:42px;text-align:right;font-size:12.5px}
  .bars-svg{width:100%;height:auto;display:block}
  .bar{fill:var(--accent)}
  .bar-label{font-family:var(--mono);font-size:10.5px;fill:var(--muted)}
  .bar-n{font-family:var(--mono);font-size:11px;fill:var(--ink);font-weight:600}

  .capmap{padding:30px 0 12px}
  .capmap h2{font-size:clamp(26px,3.4vw,36px);letter-spacing:-.025em;font-weight:800;margin:0}
  .capmap .lede{color:var(--muted);max-width:60ch;margin:12px 0 0}
  .cap-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:28px}
  .cap-card{display:flex;flex-direction:column;gap:7px;text-decoration:none;border:1px solid var(--hair);
    border-radius:14px;padding:20px 20px 18px;background:var(--paper);transition:transform .15s ease,border-color .15s ease}
  .cap-card:hover{transform:translateY(-2px);border-color:var(--cap-accent)}
  .cap-ic{width:30px;height:30px;color:var(--cap-accent);display:flex}
  .cap-ic svg{width:100%;height:100%}
  .cap-name{font-weight:700;font-size:17px;letter-spacing:-.01em}
  .cap-tag{color:var(--muted);font-size:14.5px;line-height:1.4}
  .cap-count{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-top:auto;padding-top:8px}

  main{padding:14px 0 60px}
  .cap{border-top:1px solid var(--hair);padding:44px 0 10px;scroll-margin-top:24px}
  .cap-head{display:flex;gap:20px;align-items:flex-start}
  .cap-ic.big{width:40px;height:40px;flex:0 0 auto;color:var(--cap-accent);margin-top:4px}
  .cap-head-text{flex:1;min-width:0}
  .cap-name-row{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
  .cap-name-row h2{font-size:clamp(24px,3.4vw,34px);letter-spacing:-.025em;font-weight:800;margin:0}
  .cap-total{font-family:var(--mono);font-size:12.5px;color:var(--muted)}
  .cap-tagline{font-size:17.5px;font-weight:600;margin:8px 0 0}
  .cap-blurb{color:var(--muted);margin:8px 0 0;max-width:72ch;font-size:16.5px}
  .cap-surface{margin:12px 0 0;font-size:12.5px;color:var(--muted);background:#e9eae6;border:1px solid var(--hair);
    border-radius:8px;padding:7px 11px;display:inline-block}

  .features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:26px}
  .feature{border:1px solid var(--hair);border-radius:12px;padding:18px 18px 16px;background:#fff}
  .feature-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
  .feature-name{font-size:16.5px;letter-spacing:-.01em;margin:0;font-weight:700}
  .feature-name a{text-decoration:none}
  .feature-name a:hover{color:var(--cap-accent)}
  .feature-benefit{color:var(--muted);margin:8px 0 0;font-size:15px;line-height:1.5}

  .risk{font-family:var(--mono);font-size:10px;letter-spacing:.07em;padding:2.5px 7px;border-radius:6px;border:1px solid var(--hair);color:var(--muted);text-transform:uppercase;white-space:nowrap}
  .risk-critical{color:#b3261e;border-color:#e0b4b0;background:#f7e9e7}
  .risk-high{color:#c2410c;border-color:#e6c3b0;background:#f8eee7}
  .risk-medium{color:#8a6d0b;border-color:#e0d3a8;background:#f7f2e0}
  .risk-low{color:#3c6e8f;border-color:#b9cedb;background:#eaf1f5}
  .risk-mixed,.risk-na{color:var(--muted);border-color:var(--hair);background:#ecede9}

  .rest{margin-top:18px;border:1px solid var(--hair);border-radius:12px;background:var(--paper)}
  .rest summary{cursor:pointer;padding:13px 18px;font-size:13px;color:var(--muted);letter-spacing:.04em;user-select:none}
  .rest summary:hover{color:var(--ink)}
  .rest-list{list-style:none;margin:0;padding:0 18px 14px;border-top:1px solid var(--hair)}
  .rest-item{display:flex;align-items:baseline;gap:12px;padding:9px 0;border-bottom:1px solid var(--hair);font-size:14.5px}
  .rest-item:last-child{border-bottom:none}
  .rest-item a{text-decoration:none;color:var(--ink);flex:1;min-width:0}
  .rest-item a:hover{color:var(--accent)}
  .rest-item .date{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
  .rest-empty{color:var(--muted);font-size:14px;padding:10px 0}

  .hidden{display:none!important}

  footer{border-top:1px solid var(--hair);padding:40px 0 64px}
  footer .wrap{display:flex;flex-wrap:wrap;gap:18px 40px;justify-content:space-between;align-items:baseline}
  footer .mono{font-size:12.5px;color:var(--muted);line-height:1.7;max-width:64ch}
  footer .brand{font-size:14px}

  @media(max-width:860px){
    .cap-grid{grid-template-columns:repeat(2,1fr)}
    .features{grid-template-columns:1fr}
    .charts{grid-template-columns:1fr}
  }
  @media(max-width:640px){
    body{font-size:17px}
    header{padding:60px 0 24px}
    .cap-grid{grid-template-columns:1fr}
    nav .links .hideable{display:none}
  }
  @media(prefers-reduced-motion:no-preference){
    .reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.3,1) forwards}
    .reveal.d1{animation-delay:.06s}.reveal.d2{animation-delay:.14s}
    @keyframes rise{to{opacity:1;transform:none}}
  }
  a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
</style>
</head>
<body>

<nav>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq"></span>Mega Saver</a>
    <div class="links">
      <a class="hideable" href="/#how">how it works</a>
      <a class="hideable" href="/harnesses">harnesses</a>
      <a class="hideable" href="/pro">pricing</a>
      <a href="/">&#8592; back</a>
      <a href="https://github.com/haJ1t/MegaSaver">github &#8599;</a>
    </div>
  </div>
</nav>

<header>
  <div class="wrap">
    <div class="label eyebrow reveal">what Mega Saver does</div>
    <h1 class="reveal d1">Not a filing cabinet. A product, mapped.</h1>
    <p class="sub reveal d2">Under the hood, Mega Saver is ${specs.length} design specs. But you don't care about the count — you care about <b>what it does for you</b>. Here it is, grouped by the things you actually touch: saving tokens, remembering, staying safe, trusting the output, and picking up where you left off.</p>
    <div class="statband">
      <div class="stat big"><div class="n tnum">${CAPS.length}</div><div class="k">capability areas</div></div>
      <div class="stat"><div class="n tnum">${specs.length}</div><div class="k">design specs behind them</div></div>
      <div class="stat"><div class="n tnum">${riskCounts.high + riskCounts.critical}</div><div class="k">high / critical risk</div></div>
      <div class="stat"><div class="n tnum">${monthList.length}</div><div class="k">months shipped</div></div>
    </div>
  </div>
</header>

<div class="pipeline-band wrap">
  <div class="cap">one pipeline, every tool output</div>
  ${pipelineSVG()}
</div>

<div class="charts wrap">
  <div class="chart-card">
    <h2>risk, honestly classified</h2>
    ${donutSVG()}
  </div>
  <div class="chart-card">
    <h2>shipping cadence</h2>
    ${barsSVG()}
  </div>
</div>

<section class="capmap wrap">
  <h2 class="reveal">Twelve capabilities.</h2>
  <p class="lede reveal d1">Every one traces to its design specs — linked below each card. Jump to what you care about.</p>
  <div class="cap-grid">
${cards}
  </div>
</section>

<main class="wrap">
${sections}
</main>

<footer>
  <div class="wrap">
    <a class="brand" href="/"><span class="sq acc"></span>Mega Saver</a>
    <div class="mono">Capability map generated from <span class="mono">docs/superpowers/specs/</span> in the Mega Saver repository &middot; risk levels follow the project's risk-modes convention &middot; MIT &middot; Not affiliated with Anthropic, Cursor, or OpenAI.</div>
  </div>
</footer>

</body>
</html>
`;

writeFileSync(OUT, html);
console.log(
  `Wrote ${OUT} (${html.length} bytes): ${specs.length} specs across ${CAPS.length} capabilities.`,
);
