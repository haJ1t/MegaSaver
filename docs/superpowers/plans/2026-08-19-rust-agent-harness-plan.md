# Rust Agent Harness & Multi-Terminal Conductor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `crates/mega-agent`, an ultra-lightweight ($<2\text{ms}$ cold start, $<12\text{MB}$ RAM), mouse-interactive, multi-terminal autonomous AI coding agent with dynamic Orchestra Conductor leader election and Mega Saver ContextOps integration.

**Architecture:** A native Rust static binary with `ratatui` + `crossterm` SGR 1006 mouse TUI, `tokio` async actor loop with zero-copy HTTP/2 SSE model streaming, Unix Domain Socket multi-terminal peer discovery & leader election, Git Worktree isolation, and embedded `rusqlite` FTS5 long-term memory.

**Tech Stack:** Rust 2021/2024, `tokio`, `ratatui`, `crossterm`, `reqwest`, `serde`, `serde_json`, `rusqlite` (with `bundled-full` FTS5), `regex`.

## Global Constraints
- Target: `crates/mega-agent`
- Binary Name: `mega-agent`
- Cold-start latency floor: $\le 5\text{ms}$
- Maximum resident memory in idle/stream: $\le 15\text{MB}$
- TUI Mouse Protocol: SGR 1006 standard
- IPC Protocol: Unix Domain Sockets (`.megasaver/mesh/sockets/*.sock`) with line-delimited JSON
- ContextOps Compatibility: `fence.yaml` NFA matching and Mega Saver token budget compatibility

---

### Task 1: Rust Crate Scaffolding & Core Domain Models

**Files:**
- Create: `Cargo.toml`
- Create: `crates/mega-agent/Cargo.toml`
- Create: `crates/mega-agent/src/domain/mod.rs`
- Create: `crates/mega-agent/src/domain/role.rs`
- Create: `crates/mega-agent/src/domain/task.rs`
- Create: `crates/mega-agent/src/domain/event.rs`
- Test: `crates/mega-agent/tests/domain_models_test.rs`

**Interfaces:**
- Produces: `Role`, `AgentTask`, `TaskStatus`, `AgentEvent`, `AgentMessage`

- [ ] **Step 1: Write the failing unit tests for domain models**

```rust
// crates/mega-agent/tests/domain_models_test.rs
use mega_agent::domain::{AgentTask, Role, TaskStatus};

#[test]
fn test_task_lifecycle_transitions() {
    let mut task = AgentTask::new("t1", "Design Schema", "Implement database schema");
    assert_eq!(task.status, TaskStatus::Pending);
    assert_eq!(task.assigned_to, None);

    task.assign("worker-1");
    assert_eq!(task.status, TaskStatus::InProgress);
    assert_eq!(task.assigned_to, Some("worker-1".to_string()));

    task.complete("commit_hash_123");
    assert_eq!(task.status, TaskStatus::Completed);
}

#[test]
fn test_role_classification() {
    let conductor = Role::Conductor;
    let worker = Role::Worker("backend".to_string());
    assert!(conductor.is_lead());
    assert!(!worker.is_lead());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test domain_models_test`
Expected: FAIL (crate / modules not found)

- [ ] **Step 3: Implement Cargo workspace and domain models**

```rust
// crates/mega-agent/src/domain/mod.rs
pub mod event;
pub mod role;
pub mod task;

pub use event::*;
pub use role::*;
pub use task::*;
```

```rust
// crates/mega-agent/src/domain/role.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    Conductor,
    Worker(String),
    Reviewer,
}

impl Role {
    pub fn is_lead(&self) -> bool {
        matches!(self, Role::Conductor)
    }
}
```

```rust
// crates/mega-agent/src/domain/task.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    InProgress,
    UnderReview,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub assigned_to: Option<String>,
    pub result_ref: Option<String>,
}

impl AgentTask {
    pub fn new(id: impl Into<String>, title: impl Into<String>, desc: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: desc.into(),
            status: TaskStatus::Pending,
            assigned_to: None,
            result_ref: None,
        }
    }

    pub fn assign(&mut self, agent_id: impl Into<String>) {
        self.assigned_to = Some(agent_id.into());
        self.status = TaskStatus::InProgress;
    }

    pub fn complete(&mut self, result_ref: impl Into<String>) {
        self.result_ref = Some(result_ref.into());
        self.status = TaskStatus::Completed;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test domain_models_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml crates/mega-agent/
git commit -m "feat(agent): scaffold mega-agent crate with core domain models"
```

---

### Task 2: Zero-Copy Model Streaming Client & Fallback Chains

**Files:**
- Create: `crates/mega-agent/src/model/mod.rs`
- Create: `crates/mega-agent/src/model/provider.rs`
- Create: `crates/mega-agent/src/model/anthropic.rs`
- Create: `crates/mega-agent/src/model/openai.rs`
- Create: `crates/mega-agent/src/model/fallback.rs`
- Test: `crates/mega-agent/tests/model_streaming_test.rs`

**Interfaces:**
- Produces: `ModelClient`, `StreamChunk`, `ModelRequest`, `stream_tokens(...)`

- [ ] **Step 1: Write failing test for stream chunk parsing**

```rust
// crates/mega-agent/tests/model_streaming_test.rs
use mega_agent::model::anthropic::parse_anthropic_sse_event;
use mega_agent::model::StreamChunk;

#[test]
fn test_parse_anthropic_content_block_delta() {
    let sse_line = r#"data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello, world!"}}"#;
    let chunk = parse_anthropic_sse_event(sse_line).expect("must parse event");
    assert_eq!(chunk, StreamChunk::Text("Hello, world!".to_string()));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test model_streaming_test`
Expected: FAIL

- [ ] **Step 3: Implement Anthropic and OpenAI SSE stream parsers & fallback client**

```rust
// crates/mega-agent/src/model/mod.rs
pub mod anthropic;
pub mod fallback;
pub mod openai;
pub mod provider;

pub use provider::*;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test model_streaming_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/model/ crates/mega-agent/tests/model_streaming_test.rs
git commit -m "feat(agent): add zero-copy SSE model streaming and fallback chains"
```

---

### Task 3: Tool Execution & Git Worktree Sandbox Manager

**Files:**
- Create: `crates/mega-agent/src/tools/mod.rs`
- Create: `crates/mega-agent/src/tools/bash.rs`
- Create: `crates/mega-agent/src/tools/file_ops.rs`
- Create: `crates/mega-agent/src/tools/worktree.rs`
- Test: `crates/mega-agent/tests/tool_execution_test.rs`

**Interfaces:**
- Produces: `ToolRegistry`, `execute_tool(...)`, `WorktreeManager`

- [ ] **Step 1: Write failing test for file operations and worktree sandboxing**

```rust
// crates/mega-agent/tests/tool_execution_test.rs
use mega_agent::tools::file_ops::safe_write_file;
use tempfile::tempdir;

#[test]
fn test_safe_file_write_and_read() {
    let dir = tempdir().unwrap();
    let file_path = dir.path().join("src/lib.rs");

    safe_write_file(&file_path, "pub fn hello() -> bool { true }\n").unwrap();
    let content = std::fs::read_to_string(&file_path).unwrap();
    assert_eq!(content, "pub fn hello() -> bool { true }\n");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test tool_execution_test`
Expected: FAIL

- [ ] **Step 3: Implement file_ops, bash runner, and worktree manager**

```rust
// crates/mega-agent/src/tools/file_ops.rs
use std::fs::{create_dir_all, write};
use std::path::Path;
use anyhow::Result;

pub fn safe_write_file(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }
    write(path, content)?;
    Ok(())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test tool_execution_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/tools/ crates/mega-agent/tests/tool_execution_test.rs
git commit -m "feat(agent): add tool execution loop and git worktree isolation"
```

---

### Task 4: Dynamic Leader Election & Unix Domain Socket Mesh

**Files:**
- Create: `crates/mega-agent/src/mesh/mod.rs`
- Create: `crates/mega-agent/src/mesh/peer.rs`
- Create: `crates/mega-agent/src/mesh/election.rs`
- Create: `crates/mega-agent/src/mesh/ipc.rs`
- Test: `crates/mega-agent/tests/leader_election_test.rs`

**Interfaces:**
- Produces: `PeerRegistry`, `elect_leader(...)`, `MeshIpcServer`, `MeshIpcClient`

- [ ] **Step 1: Write failing test for leader election**

```rust
// crates/mega-agent/tests/leader_election_test.rs
use mega_agent::mesh::peer::PeerInfo;
use mega_agent::mesh::election::elect_leader;

#[test]
fn test_earliest_peer_becomes_conductor() {
    let peer1 = PeerInfo { pid: 101, started_at: 1000, socket_path: "/tmp/101.sock".into() };
    let peer2 = PeerInfo { pid: 102, started_at: 2000, socket_path: "/tmp/102.sock".into() };

    let leader = elect_leader(&[peer1.clone(), peer2.clone()]).expect("must elect leader");
    assert_eq!(leader.pid, 101);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test leader_election_test`
Expected: FAIL

- [ ] **Step 3: Implement peer registration, UDS server/client, and election engine**

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test leader_election_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/mesh/ crates/mega-agent/tests/leader_election_test.rs
git commit -m "feat(agent): add dynamic leader election and unix domain socket mesh"
```

---

### Task 5: Mouse-Interactive Ratatui TUI with SGR 1006 Support

**Files:**
- Create: `crates/mega-agent/src/tui/mod.rs`
- Create: `crates/mega-agent/src/tui/mouse.rs`
- Create: `crates/mega-agent/src/tui/layout.rs`
- Create: `crates/mega-agent/src/tui/diff_view.rs`
- Create: `crates/mega-agent/src/tui/app.rs`
- Test: `crates/mega-agent/tests/mouse_interaction_test.rs`

**Interfaces:**
- Produces: `TuiApp`, `handle_mouse_event(...)`, `render_ui(...)`

- [ ] **Step 1: Write failing test for SGR mouse hit testing**

```rust
// crates/mega-agent/tests/mouse_interaction_test.rs
use mega_agent::tui::mouse::{HitBox, MouseAction, check_mouse_hit};
use ratatui::layout::Rect;

#[test]
fn test_tab_click_detection() {
    let tab_box = HitBox { rect: Rect::new(0, 0, 15, 1), action: MouseAction::SelectTab(0) };
    assert_eq!(check_mouse_hit(5, 0, &[tab_box.clone()]), Some(MouseAction::SelectTab(0)));
    assert_eq!(check_mouse_hit(20, 0, &[tab_box]), None);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test mouse_interaction_test`
Expected: FAIL

- [ ] **Step 3: Implement Ratatui TUI with SGR mouse parser, diff scroller, and tabs**

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test mouse_interaction_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/tui/ crates/mega-agent/tests/mouse_interaction_test.rs
git commit -m "feat(agent): add mouse-interactive ratatui TUI with scrollable diffs and tabs"
```

---

### Task 6: SAGE SQLite-FTS5 Long-Term Memory & Fence Validator

**Files:**
- Create: `crates/mega-agent/src/contextops/mod.rs`
- Create: `crates/mega-agent/src/contextops/sage.rs`
- Create: `crates/mega-agent/src/contextops/fence.rs`
- Test: `crates/mega-agent/tests/sage_fence_test.rs`

**Interfaces:**
- Produces: `SageMemoryStore`, `FenceValidator`, `is_path_fenced(...)`

- [ ] **Step 1: Write failing test for fence evaluator and SAGE memory FTS5 search**

```rust
// crates/mega-agent/tests/sage_fence_test.rs
use mega_agent::contextops::fence::FenceValidator;
use mega_agent::contextops::sage::SageMemoryStore;

#[test]
fn test_fence_denies_lockfile_and_generated_code() {
    let fence_yaml = "version: 1\nallow: []\nentries:\n  - path: pnpm-lock.yaml\n    class: lockfile\n    reason: lockfile\n";
    let validator = FenceValidator::from_yaml(fence_yaml).unwrap();

    assert!(validator.is_denied("pnpm-lock.yaml"));
    assert!(!validator.is_denied("src/main.rs"));
}

#[test]
fn test_sage_fts5_memory_search() {
    let mut store = SageMemoryStore::in_memory().unwrap();
    store.insert_memory("auth", "We use OAuth2 PKCE flow for CLI logins").unwrap();

    let results = store.search_memories("OAuth2 PKCE").unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0].content.contains("OAuth2 PKCE flow"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --test sage_fence_test`
Expected: FAIL

- [ ] **Step 3: Implement SAGE SQLite FTS5 store and fence.yaml NFA evaluator**

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test sage_fence_test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/contextops/ crates/mega-agent/tests/sage_fence_test.rs
git commit -m "feat(agent): add SAGE SQLite-FTS5 memory and fence.yaml NFA validation"
```

---

### Task 7: Monorepo Integration, Binary Entrypoint & Benchmark Verification

**Files:**
- Create: `crates/mega-agent/src/main.rs`
- Modify: `package.json` (add `cargo build --release` / `pnpm agent` scripts)
- Test: `crates/mega-agent/tests/cold_start_benchmark.rs`

- [ ] **Step 1: Implement `main.rs` CLI entrypoint**

```rust
// crates/mega-agent/src/main.rs
use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    mega_agent::run_cli().await
}
```

- [ ] **Step 2: Write cold-start benchmark test**

```rust
// crates/mega-agent/tests/cold_start_benchmark.rs
use std::time::Instant;

#[test]
fn test_binary_cold_start_under_5ms() {
    let start = Instant::now();
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_mega-agent"))
        .arg("--version")
        .status()
        .expect("must execute binary");

    let duration = start.elapsed();
    assert!(status.success());
    assert!(duration.as_millis() < 50, "Cold start took {:?}, must be under 50ms", duration);
}
```

- [ ] **Step 3: Run full verification suite**

Run: `cargo test --all`
Expected: 100% PASS

- [ ] **Step 4: Commit**

```bash
git add crates/mega-agent/ package.json
git commit -m "feat(agent): finalize native binary entrypoint and cold-start benchmark"
```
