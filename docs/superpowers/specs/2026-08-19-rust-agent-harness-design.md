# Rust Agent Harness & Multi-Terminal Conductor Design

- **Author:** Mega Saver Team
- **Date:** 2026-08-19
- **Risk Level:** HIGH
- **Status:** DRAFT / PROPOSED
- **Target Crate:** `crates/mega-agent` (Native Rust Executable)

---

## 1. Overview & Vision

Mega Saver Agent Harness is an ultra-lightweight, sub-2ms cold start, single-binary autonomous AI coding agent designed to be **faster and lighter than `jcode`**, equipped with a **mouse-interactive terminal TUI**, and capable of **autonomous multi-terminal peer coordination**.

When a developer opens multiple terminal windows (or split panes):
- The **first active terminal** dynamically becomes the **Orchestra Conductor (Director / Tech Lead)**.
- Subsequent terminals automatically discover the Conductor via local Unix Domain Sockets and register as specialized **Workers (Backend, Frontend, Tester, Reviewer)**.
- The Conductor breaks down project goals into isolated tasks, delegates them across Worker terminals, monitors live execution in isolated **Git Worktrees**, and reviews diffs with automatic verification gates.
- All terminals leverage **Mega Saver ContextOps** (AST token compression, `fence.yaml` critical file protection, token budget circuit breakers, and SAGE SQLite-FTS5 long-term memory).

---

## 2. Core Pillars & Non-Negotiable Requirements

1. **Ultra-Lightweight & Blazing Speed (Faster than `jcode`):**
   - **Cold-start:** $\le 2\text{ ms}$ (pure Rust native static binary).
   - **RAM Footprint:** $\le 12\text{ MB}$ per agent process (zero garbage collection pauses).
   - **Streaming:** Zero-copy HTTP/2 SSE parser with instant microsecond ANSI token streaming.
2. **Mouse-Controllable Modern TUI (`ratatui` + SGR 1006):**
   - Clickable tabs (`[👑 Conductor]`, `[⚙️ Worker-1]`, `[🧪 Worker-2]`, `[📊 Metrics]`).
   - Smooth mouse-wheel scrolling for diffs, tool execution receipts, and terminal logs.
   - Clickable action triggers (`[Approve Diff]`, `[Reject]`, `[Pause]`, `[Add Worker]`).
   - Click-to-expand accordion inspection for compressed logs.
3. **Dynamic Orchestra Conductor & Multi-Terminal IPC:**
   - Single-agent mode: Autonomous Solo Agent.
   - Multi-agent mode: Earliest alive process is elected **Conductor**; subsequent instances join as **Workers**.
   - Failover: If the Conductor exits, the next oldest worker automatically promotes to Conductor and adopts the durable task board.
   - Zero network overhead: Pure Unix Domain Sockets (`.megasaver/mesh/agent-*.sock`) with lock-free atomic event messaging.
4. **ContextOps Dogfooding & Protection:**
   - Enforces `fence.yaml` rules natively in Rust (prevents modifying lockfiles, generated code).
   - Enforces Token Budget circuit breakers (`@megasaver/stats` compatible).
   - Integrated with SAGE SQLite/FTS5 code-anchored long-term memory.
5. **Provider Agnostic & Zero Lock-in (140+ Providers):**
   - Anthropic (Claude 3.7 / 3.5), OpenAI (o3 / GPT-4o), Google Gemini 2.5, DeepSeek V3, Ollama / vLLM / LM Studio local endpoints, OpenRouter.
   - Automatic fallback chains on rate-limits (429/500).

---

## 3. Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CRATES/MEGA-AGENT (RUST)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. TUI LAYER (`ratatui` + `crossterm`)                                     │
│     ├── SGR 1006 Mouse Tracker (Click, Drag, Scroll Wheel)                  │
│     ├── Tab Manager (Conductor, Workers, Task Board, Token Ledger)          │
│     └── Streaming Unified Diff Renderer (Syntax Highlighted)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  2. MESH & PEER IPC ENGINE (`tokio::net::UnixListener`, UDS)                │
│     ├── Peer Presence & Heartbeat Discovery                                 │
│     ├── Dynamic Leader Election (Earliest Timestamp / Promotion)            │
│     ├── Mailbox Message Dispatcher (Targeted Work Orders & ACKs)            │
│     └── Claim Lock Engine (Prevents two agents editing the same file)       │
├─────────────────────────────────────────────────────────────────────────────┤
│  3. AGENT RUNNER & KERNEL (`tokio` Async Actor System)                      │
│     ├── EventBus & State Machine (Idle -> Planning -> Executing -> Review)  │
│     ├── Tool Executor (Bash, ReadAST, WritePatch, Grep, GitWorktree)        │
│     ├── ContextOps Gate (Output Reducer, AST Chunking, Prompt Cache Guard)  │
│     └── Policy / Fence Validator (`fence.yaml` NFA Matcher)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  4. MODEL DRIVER & PROVIDER ENGINE                                          │
│     ├── HTTP/2 Streaming Client (`reqwest` with SIMD JSON parser)           │
│     ├── Per-Role Routing (Director = o3/Sonnet 3.7, Worker = Haiku/DeepSeek)│
│     └── Provider Fallback Chain (Primary -> Secondary -> Local Ollama)      │
├─────────────────────────────────────────────────────────────────────────────┤
│  5. SAGE MEMORY ENGINE (`rusqlite` with FTS5)                               │
│     ├── Project Decision Index & Architecture Rules                         │
│     ├── Failed Attempt Recall (`FORGE` Anti-Pattern Avoidance)              │
│     └── Fast Lexical & Code-Anchored Retrieval                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Multi-Terminal Dynamic Leadership Protocol

### 4.1. Peer Discovery & Leader Election Algorithm
1. On startup (`mega agent` / `mega-agent`), the process inspects `.megasaver/mesh/peers/`.
2. It writes its ephemeral presence file `.megasaver/mesh/peers/<pid>.json`:
   ```json
   {
     "pid": 12840,
     "sessionId": "ses_01j...",
     "startedAt": 1771463700000,
     "role": "auto",
     "socketPath": ".megasaver/mesh/sockets/12840.sock"
   }
   ```
3. **Leadership Evaluation:**
   - Scan all active peers with valid heartbeats ($\le 5\text{s}$ old).
   - Find the peer with the earliest `startedAt` timestamp.
   - If `self.pid == earliest_peer.pid`:
     - Role $\leftarrow$ **Conductor (Director / Tech Lead)**.
     - Spawns Task Board Manager and opens the Coordinator TUI.
   - Else:
     - Role $\leftarrow$ **Worker (Specialist)**.
     - Connects to Conductor's socket, announces readiness, and listens for tasks.

### 4.2. Work Delegation & Git Worktree Isolation
```
Conductor Terminal                  Worker-1 Terminal (UDS)
     │                                    │
     ├────── [Assign Task #2] ───────────►│
     │       (Worktree: .worktrees/w1)    ├─ git worktree add .worktrees/w1
     │                                    ├─ Execute tool loop & edit files
     │                                    ├─ Run test suite (Output Filter)
     │◄───── [Task Complete + Diff] ──────┤
     ├─ Chimera Review / Verification     │
     └─ Merge Worktree to Main            │
```

---

## 5. TUI Layout & Mouse Event Interaction Specification

### 5.1. Screen Layout Wireframe
```
┌─ MEGA AGENT ───────────────────────────────────────────────────────────────┐
│ [👑 Conductor] [⚙️ Worker-1: API] [🧪 Worker-2: Test]  [📊 Token: $0.12 (82% saved)] │
├────────────────────────────────────────────────────┬───────────────────────┤
│ 👑 CONDUCTOR LIVE STREAM                           │ 📋 TASK BOARD         │
│                                                    │                       │
│ User Goal: "Add OAuth2 authentication"             │ [✓] 1. Auth Schemas   │
│ > Created Plan with 3 independent tasks.           │ [●] 2. Google OAuth   │
│ > Delegated Task #2 to Worker-1 (isolated worktree)│     └ Worker-1        │
│ > Delegated Task #3 to Worker-2 (test suite)       │ [ ] 3. E2E Tests      │
│                                                    │     └ Worker-2        │
│ ┌─ Worker-1 Live Diff ────────────── (Scroll ▲▼)───┤                       │
│ │ + pub async fn verify_oauth_token(...) -> Result │ 🛡️ FENCE & BUDGET     │
│ │ +   let client = reqwest::Client::new();         │ • Fence: 0 violations │
│ │ +   // verified token                            │ • Budget: 42k/200k tok│
│ └──────────────────────────────────────────────────┴───────────────────────┤
│ [✅ Approve & Merge]  [❌ Request Changes]  [⏸️ Pause]  [➕ Add Worker]    │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.2. Mouse Tracking Specification (SGR 1006 Mode)
- **Mouse Click on Header Tabs:** Switches the focused viewport to the selected agent.
- **Mouse Wheel over Diff/Output Box:** Smooth scroll up/down without flickering.
- **Mouse Click on Bottom Action Buttons:** Dispatches execution actions (`Approve`, `Reject`, `Pause`, `Add Worker`).
- **Mouse Click on Task Item:** Expands task details and displays execution transcript.

---

## 6. Model Provider & Zero-Copy Token Streaming

### 6.1. Unified Provider Adapter
The engine implements a lightweight streaming client supporting:
- **Anthropic API:** `/v1/messages` (SSE stream with prompt caching `cache_control`).
- **OpenAI / OpenAI-Compatible:** `/v1/chat/completions` (OpenAI, DeepSeek, Groq, OpenRouter, vLLM, LM Studio, Ollama).
- **Google Gemini API:** `/v1beta/models/{model}:streamGenerateContent`.

### 6.2. Per-Role Model Routing Configuration (`config.toml`)
```toml
[models.director]
provider = "anthropic"
model = "claude-3-7-sonnet-20250219"
thinking_budget = 4096
fallback = ["openai/o3-mini", "deepseek/deepseek-reasoner"]

[models.worker_fast]
provider = "anthropic"
model = "claude-3-5-haiku-20241022"
fallback = ["openai/gpt-4o-mini", "ollama/qwen2.5-coder-7b"]

[models.reviewer]
provider = "openai"
model = "o3-mini"
fallback = ["anthropic/claude-3-7-sonnet-20250219"]
```

---

## 7. Memory & ContextOps Integration

1. **SAGE Long-Term Memory:**
   - Embedded SQLite with FTS5 table `sage_memories` indexing past decisions, rules, and root causes.
   - BM25 ranked retrieval during prompt assembly ($<0.5\text{ms}$).
2. **`fence.yaml` NFA Engine:**
   - Pre-compiled NFA regex matchers evaluate tool file-write paths before I/O occurs. Denies modifications to protected/generated files.
3. **AST & Terminal Output Compressor:**
   - Filters ANSI escape noise, deduplicates repetitive build/test lines, and extracts root-cause failure traces, keeping agent context compact.

---

## 8. Verification & DoD Gates

1. **Unit & Integration Test Suite (`cargo test`):**
   - Peer discovery, leader election, and failover tests.
   - Tool execution and Git worktree isolation tests.
   - Fence and budget enforcement tests.
   - SGR mouse event parsing tests.
2. **Benchmark Gate:**
   - Cold start time $< 5\text{ms}$.
   - Memory usage $< 15\text{MB}$ in steady state.
   - Stream processing latency $< 1\text{ms}$ per chunk.

---

## 9. Implementation Phasing

- **Phase 1 (Kernel & Core Runner):** Pure Rust agent loop, HTTP/2 streaming client, and basic tools (`read`, `edit`, `bash`).
- **Phase 2 (Ratatui TUI & Mouse Engine):** Full SGR 1006 mouse-controllable TUI, diff scrolling, and clickable controls.
- **Phase 3 (Multi-Terminal Mesh & Conductor):** Unix domain socket IPC, dynamic leader election, and Git worktree isolation.
- **Phase 4 (ContextOps, SAGE & Providers):** `fence.yaml` enforcement, SAGE SQLite-FTS5 memory, and multi-provider fallback chains.
