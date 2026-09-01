# Harness-Agnostic Transcript & Cockpit Sticky Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every session from any of the 39 harnesses renders a real transcript (not the 1-msg placeholder), with live incremental streaming, correct telemetry/tasks/savings/memory resolution, auto-scroll pinned to the latest message, a sticky cockpit header/nav, and visually distinct collapsed thinking blocks — one fix pass for all harnesses.

**Architecture:** Shared dispatcher across 4 session-scoped bridge endpoints (GET :dir/:id, /telemetry, /stream, resolveSessionWorkspace). 3-tier fallback: Claude dash transcript -> readHarnessTranscript(home,id) (Codex -> Pi -> OpenCode) -> placeholder. Stream tails the real backing file (watchFile for JSONL, interval poll for SQLite). Split 418 LOC harness-transcript.ts into bounded modules. Cockpit sticky wrapper + thinking badge.

**Tech Stack:** Node 22, TypeScript strict ESM NodeNext, pnpm, tsup, Vitest, React 18 Vite 5, node:sqlite DatabaseSync, watchFile, SSE, encodeWorkspaceKey FNV-1a, Zod.

**Spec:** Fix transcript/telemetry/stream for all harnesses, sticky cockpit, thinking distinction, auto-scroll at bottom. Superpowers debugging + verification-before-completion, branch fix/indexer-and-cli-bugs.

## Global Constraints
- Node 22 LTS, TS strict ESM NodeNext, pnpm workspace, turbo, Vitest, Biome
- Validation at boundaries (Zod, safeSessionPath), trust internal
- One responsibility per file (≤300 LOC or single concern)
- workspaceKey = FNV-1a hex of cwd (packages/shared)
- Branch-only, conventions:sync required
- Security: safeSessionPath, allowedRoots prefix, LIVE_WINDOW_MS exemption
- Any bridge fix MUST cover all 39 harnesses and add permanent rule to docs/conventions/code-conventions.md

---

## Preamble: Phases 1-3 compact evidence

**Phase 1 root cause:** scanAllHarnessSessions surfaces Codex/Pi/OpenCode rows correctly, but readTranscript only knows Claude jsonl; resolveSessionWorkspace never called readHarnessTranscript so tasks/savings/memory 404 or collapsed to 1-msg placeholder; stream closed after snapshot (snapshot+end) so no incremental tail and chatbot auto-scroll never triggered; transcript thinking identical styling; cockpit header/nav not sticky.

**Phase 2 pattern:** Working Claude path is normalizeLine+tailTranscript over user|assistant jsonl with BlockKind text|thinking|tool_use|tool_result. Need to match: Codex response_item JSONL, Pi message JSONL with thinking, OpenCode SQLite message/part. Parsers already exist in harness-transcript.ts — only wiring missing.

**Phase 3 hypothesis:** If every endpoint runs Claude dash -> harness parser -> placeholder and stream tails the backing file, transcript length>1 and telemetry turnCount>1 hold for all harnesses and tails emit incremental SSE events; sticky+thinking fix the UX.

---

### Task 1: Split harness-transcript.ts into bounded modules (≤300 LOC each)

**Files:**
- Modify: apps/gui/bridge/claude-sessions/harness-transcript.ts (dispatcher only, <120 LOC)
- Create: apps/gui/bridge/claude-sessions/codex-transcript.ts (Codex-only)
- Create: apps/gui/bridge/claude-sessions/pi-transcript.ts (Pi-only)
- Create: apps/gui/bridge/claude-sessions/opencode-transcript.ts (OpenCode-only)
- Test: apps/gui/test/bridge/harness-transcript.test.ts
- Docs: docs/conventions/code-conventions.md + conventions:sync

**Interfaces:**
- Consumes: @megasaver/harness-detect (catalog helpers), ./types.js (ClaudeTranscript, NormalizedMessage), ./multi-harness-scanner.js (isCodexNoiseText), node fs/path/sqlite.
- Produces: readCodexTranscript, readPiTranscript, readOpenCodeTranscript, readHarnessTranscript(homeDir,id) -> tries Codex -> Pi -> OpenCode in order.

- [ ] Step 1: Write failing split-test (red) — expect new modules to exist and re-export.

Run: pnpm --filter @megasaver/gui exec vitest run apps/gui/test/bridge/harness-transcript.test.ts -v (must FAIL initially).

- [ ] Step 2: Extract per-harness modules + restore dispatcher harness-transcript.ts to: import {readCodexTranscript} from "./codex-transcript.js"; etc. and re-export readHarnessTranscript that tries Codex -> Pi -> OpenCode. Each file ≤300 LOC. Preserve TOOL_INPUT_MAX, HEADER_BYTES, isCodexNoiseText semantics exactly.

- [ ] Step 3: Append permanent rule to code-conventions.md:

## Harness-agnostic bridge rule
Every session-scoped bridge route and resolver MUST be harness-agnostic across the full supported catalog (currently 39 harnesses). Do not branch on a single harness id, do not return a placeholder transcript where a real parser exists, and keep telemetry/memory/savings/stream behavior identical regardless of backing store (JSONL vs SQLite). Add new harness support by extending the shared dispatcher, not by forking a route.

Then: pnpm conventions:sync and pnpm conventions:check.

- [ ] Step 4: Verify pnpm --filter @megasaver/gui typecheck + vitest for harness-transcript + bridge build.

- [ ] Step 5: Commit refactor(bridge): split harness-transcript into bounded modules + harness-agnostic rule.

---

### Task 2: Make bridge endpoints + resolver harness-agnostic with incremental stream tails

**Files:**
- Modify: apps/gui/bridge/routes/claude-sessions.ts (handleGetClaudeSession/handleGetClaudeSessionTelemetry/handleStreamClaudeSession + tryHarnessFallbackTranscript)
- Modify: apps/gui/bridge/routes/_claude-session.ts (resolveSessionWorkspace)
- Modify: apps/gui/bridge/claude-sessions/reader.ts (optional helper — tails wiring)
- Modify if needed: codex-transcript.ts / pi-transcript.ts / opencode-transcript.ts to also export resolve path helpers (resolveCodexTranscriptPath etc.) so stream can tail without duplicating scan logic.
- Test: apps/gui/test/bridge/claude-sessions-harness-agnostic.test.ts (fixture-backed: handler with tmp HOME, asserts transcript messages>1 + telemetry turnCount>1 + stream snapshot>1)
- Docs: reuses Task 1 rule

**Interfaces:**
- Consumes: readHarnessTranscript + optional path helpers, readTranscript, safeSessionPath, tailTranscript, scanAllHarnessSessions, aggregateTelemetry, RouteContext{homeDir, storeRoot, claudeProjectsDir}.
- Produces: For any harness id: GET /dir/id -> real transcript, GET /telemetry -> turnCount>1, SSE /stream -> snapshot + incremental message events live, resolver -> /tasks /memory /savings stop 404ing and show cwd-derived data.

- [ ] Step 1: Write failing route test with fixture HOME subtrees (.codex/sessions/… etc). Use createBridgeHandler({ storePath, claudeProjectsDir: tmpClaude, homeDir: tmpHome }). Fetch /api/claude-sessions/:dir/:id + /telemetry; assert body.messages.length>1 and turnCount>1. Must fail while _claude-session and stream still close after placeholder.

- [ ] Step 2: Fix resolver _claude-session.ts: before scanAllHarnessSessions fallback insert: try { const t=await readHarnessTranscript(ctx.homeDir ?? process.env.HOME ?? "", id); if (t && t.projectLabel) return { workspaceKey: encodeWorkspaceKey(t.projectLabel), liveSessionId:id, cwd:t.projectLabel }; } catch {}

- [ ] Step 3: Keep claude-sessions.ts fallback order (readHarnessTranscript before placeholder) and ensure telemetry aggregates fallback.messages with messages.length>0.

- [ ] Step 4: Fix stream: after snapshot from real harness transcript do NOT close. Resolve backing path (file JSONL or dbPath). If file-backed call tailTranscript(backing.path, backing.offset, msg=>send("message",msg)) with existing HEARTBEAT_MS and closed guard; if SQLite setInterval 750ms re-read and emit only new messages. Wire cleanup to close both.

- [ ] Step 5: Verify pnpm --filter @megasaver/gui typecheck + build + vitest for harness-agnostic routes + manual node import of readHarnessTranscript for a real host Codex/Pi/OpenCode id.

- [ ] Step 6: Commit fix(bridge): make session routes harness-agnostic with incremental stream tails.

---

### Task 3: Cockpit sticky header+tabs + distinct thinking blocks

**Files:**
- Modify: apps/gui/src/cockpit/session-cockpit.tsx (sticky header+nav wrapper)
- Modify: apps/gui/src/cockpit/panels/transcript-panel.tsx (thinking distinct + keep auto-stick)
- Test: apps/gui/test/components/transcript-panel.test.tsx (assert sticky class + thinking badge + details collapsed)
- Test: apps/gui/test/components/session-cockpit.test.tsx (optional — header+nav inside sticky wrapper)

**Interfaces:**
- Consumes: claude-sessions-client stream. No new deps.
- Produces: Long transcript: header+tab strip stays pinned (sticky top-0 bg-surface z-10); thinking blocks render as amber left-border details collapsed with Thinking badge; tools mono muted; auto-scroll still useLayoutEffect + double rAF + endRef.

- [ ] Step 1: Update tests to encode sticky + thinking invariants; expect failure.

- [ ] Step 2: Wrap header+nav in sticky div in session-cockpit.tsx: <div className="sticky top-0 bg-surface z-10 shrink-0 border-b border-transparent"><header/><nav/></div>. Keep main overflow-hidden and aside independently scrollable.

- [ ] Step 3: In transcript-panel.tsx branch on b.kind==="thinking": render <details> with amber border-l-4 + summary Thinking badge + pre for text. Text/tool blocks stay pre with prior mono styling.

- [ ] Step 4: Keep scrollRef on section overflow container; do not move onScroll handler; useLayoutEffect dep [messages] unchanged; sticky wrapper has no overflow so no scroll steal.

- [ ] Step 5: Verify pnpm --filter @megasaver/gui typecheck + vitest for transcript-panel.

- [ ] Step 6: Commit fix(cockpit): sticky header+tabs and distinct thinking blocks.

---

### Task 4: Final sweep + verification-before-completion

**Files:** none new; verify.

- [ ] Step 1: Fresh pnpm typecheck (all workspaces) and build (pnpm --filter @megasaver/gui build + bridge where defined).

- [ ] Step 2: Full turbo test (pnpm test) 0 failures, 300 LOC rule satisfied after split, pnpm lint diagnostics satisfied.

- [ ] Step 3: Host live probes: node -e importing readHarnessTranscript for one Codex + one Pi + one OpenCode id logging messages.length + projectLabel; curl-equivalent handler hit for GET /telemetry turnCount>1; SSE snapshot>1.

- [ ] Step 4: pnpm conventions:check passes.

