# Rust Agent Harness — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the containment and the measuring instrument first (Phase 0: OS sandbox, supervisor/agent split, eval loop, NDJSON event channel), then the agent kernel they measure (Phase 1: model driver, state machine, edit-apply ladder, fence).

**Architecture:** A new `crates/mega-agent` Rust binary in the existing pnpm monorepo, split into two processes (spec §3.3). The **supervisor** is unsandboxed, does no filesystem work, and holds the only two connections in the system — to the model provider and to the TypeScript daemon over loopback HTTP + bearer token. The **agent** is sandboxed with no network whatsoever, does every filesystem read and write and every shell command, and reaches both connections by asking its supervisor over an inherited stdin/stdout pipe. Per-token and per-tool work is Rust; per-turn work is a daemon call. Every internal event is written as one NDJSON line, so every metric in the spec is a `jq` invocation rather than an instrumentation project later.

**Tech Stack:** Rust (edition 2021), `serde`/`serde_json`, `reqwest` (blocking), `sha2`, `anyhow`, `thiserror`, `toml`, `tempfile`, and `landlock` on Linux only. Blocking I/O + std threads, not `tokio` — the harness blocks on one model call at a time and spawns *processes*, not tasks, for parallelism. `ponytail:` if Phase 3's TUI or Phase 4's fan-out ever needs real concurrency, that is the moment to introduce an async runtime, not before.

**Spec:** [docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md](../specs/2026-08-19-rust-agent-harness-design.md) (rev. 3, risk **CRITICAL**)

**Scope:** This plan covers spec §17 **Phase 0 and Phase 1 only**. Phases 2 (accuracy levers), 3 (TUI), and 4 (mesh + `--candidates N`) get their own plans, generated from §17 once Phase 1 lands and the eval loop can price them. Writing all five phases here would reproduce exactly the defect the review found in the previous plan (N8: tasks with empty implementation steps).

## Three things to know before Task 1

**1. The Phase 0 delta is expected to be ~0. That is the deliverable.** Arm B at the end of Phase 0 is the harness with no features yet, so it should score the same as Arm A. A `resolve_rate` delta near zero is the instrument passing its own null test. A large delta at Phase 0 means the harness is measuring something other than the model — investigate before continuing. The delta only becomes the product's claim once Phase 1 and 2 land.

**2. The sandbox comes before the first model call, not after the kernel.** An earlier revision of this plan put the sandbox last, wrapped each child `Command` in it, and left two holes: the harness's own in-process `fs::write` was never inside the profile at all, and Arm A — a real agent loop with a real `bash` tool — ran unattended across dozens of eval instances with no containment. Task 4 now enters the profile at the **process** level, and every later task inherits it. If you find yourself adding sandbox code to a tool, stop: the tool is already inside the box, and a tool that carries sandbox code can carry a sandbox bug.

**3. Task order is not negotiable and Tasks 3–4 are why.** They look like plumbing next to the eval loop everyone wants to see. They are the reason the eval loop can run at all without putting an unattended model loop on the operator's filesystem.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **Risk is CRITICAL** (§2). Work in a worktree — no edits on `main`. `architect`, `critic`, `security-reviewer`, `verifier` passes and the `tracer` evidence loop all block merge. Risk may not be lowered to skip a skill.
- **Operator confirmations are closed.** Spec §13 items 1–7 were all confirmed 2026-08-19, including item 6 (the mission inversion), which was executed the same day. No task in this plan is waiting on an operator decision.
- **The agent process has no network** (§3.3, §11.1). There is no carve-out, no pinned port, no loopback exception. If a task seems to need one, it belongs on the supervisor's side of the boundary instead.
- **Eval spend lock** (§13/5, §4.4): a non-loopback `base_url` is refused without an explicit per-invocation `--allow-remote-model`. Never persist that flag to config.
- **Prompt-cache invariant** (§6.2): the prompt prefix is append-only within a session; a historical `tool_result` is never rewritten in place, ever. Compression happens at write time, before content enters history. `cache_control` breakpoints sit at stable boundaries, **≤ 4** (provider limit).
- **No model ids compiled into the binary** (§10.2). Routing is config-first, from `config.toml`. The current family is `claude-opus-5` (director), `claude-sonnet-5` (worker), `claude-haiku-4-5-20251001` (fast) — these appear in an example config file, never in Rust source.
- **`apply_success_rate` floor is 98%** (§4.2, §7).
- **Fallback triggers on 429/5xx only**, bounded retry, no silent retry on malformed responses.
- **Secrets** (§11.5): API keys and the daemon bearer token are read from env/keychain/`daemon.json`, held in memory, never logged, never emitted to the event stream, never passed via `argv` (world-readable on both target platforms).
- **Windows**: the crate must compile, but sandbox and unattended modes are deferred (§11.1). Gate sandbox tests with `#[cfg(unix)]`; `mega-agent` refuses unattended modes on Windows.
- **English only** in code, comments, docs, and commit messages (`docs/conventions/language.md`).
- **Commits**: Conventional Commits, subject ≤ 50 chars, imperative. One logical change per commit.

## File Structure

| Path | Responsibility |
|---|---|
| `Cargo.toml` (repo root) | Cargo workspace member list |
| `rust-toolchain.toml` | pinned toolchain |
| `crates/mega-agent/Cargo.toml` | crate manifest |
| `crates/mega-agent/src/lib.rs` | module wiring only |
| `crates/mega-agent/src/event.rs` | NDJSON event enum + sink (§4.5) |
| `crates/mega-agent/src/rpc.rs` | length-prefixed frames over the supervisor pipe (§3.3) |
| `crates/mega-agent/src/supervisor.rs` | agent launch, fence→profile fold, call proxying (§3.3) |
| `crates/mega-agent/src/bin/sandbox-probe.rs` | test-only: enters the profile, attempts one named op |
| `crates/mega-agent/config.example.toml` | committed example; `config.toml` is gitignored |
| `crates/mega-agent/src/suite.rs` | eval task suite: types, classification, hashing (§4.3) |
| `crates/mega-agent/src/bin/suite-gen.rs` | git-history suite generator + red/green screen |
| `crates/mega-agent/src/provider/mod.rs` | `Transport`, `Provider`, `ChatRequest`, `Chunk` |
| `crates/mega-agent/src/provider/openai_compat.rs` | `/v1/chat/completions` wire format |
| `crates/mega-agent/src/provider/anthropic.rs` | `/v1/messages` + `cache_control` |
| `crates/mega-agent/src/provider/gemini.rs` | `:streamGenerateContent` |
| `crates/mega-agent/src/provider/http.rs` | real `reqwest` transport |
| `crates/mega-agent/src/bin/baseline.rs` | Arm A — the ~200-line honest reference loop |
| `crates/mega-agent/src/bin/eval.rs` | two-arm driver + metric extraction |
| `crates/mega-agent/src/config.rs` | `config.toml` parse, per-role routing |
| `crates/mega-agent/src/kernel.rs` | state machine, budgets, stop conditions |
| `crates/mega-agent/src/tools/mod.rs` | tool dispatch + schemas |
| `crates/mega-agent/src/tools/edit.rs` | search/replace ladder (§7) |
| `crates/mega-agent/src/tools/bash.rs` | shell — no sandbox code; the process is already inside one |
| `crates/mega-agent/src/sandbox/mod.rs` | mode → profile, and `enter()` for the current process |
| `crates/mega-agent/src/sandbox/seatbelt.rs` | macOS: profile text + re-exec under `sandbox-exec` |
| `crates/mega-agent/src/sandbox/landlock.rs` | Linux: `landlock_restrict_self`, no re-exec |
| `crates/mega-agent/src/daemon.rs` | loopback HTTP client (discovery, bearer, pid check) |
| `packages/daemon/src/handlers-agent.ts` | new daemon routes the harness consumes |

---

# Phase 0 — The Instrument

## Task 1: Crate skeleton, monorepo plumbing, NDJSON event channel

Spec §4.5 (event side-channel) and §14/N10 (monorepo plumbing). Plumbing is folded in here rather than split out: `crates/` does not exist, so nothing else in this plan can run a test until it does.

**Files:**
- Create: `Cargo.toml` (repo root), `rust-toolchain.toml`, `crates/mega-agent/Cargo.toml`, `crates/mega-agent/src/lib.rs`, `crates/mega-agent/src/event.rs`
- Modify: `.gitignore`, `biome.json:10-19` (`files.ignore` array), `package.json:26` (`verify` script), `.github/workflows/ci.yml`
- Test: inline `#[cfg(test)] mod tests` in `crates/mega-agent/src/event.rs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `mega_agent::event::{Event, EventSink}`. `EventSink::open(&Path) -> std::io::Result<EventSink>`, `EventSink::emit(&mut self, &Event) -> std::io::Result<()>`. `Event` is a `#[serde(tag = "type", rename_all = "snake_case")]` enum — every later task adds variants to it and emits through this sink.

- [ ] **Step 1: Create the Cargo workspace and pin the toolchain**

Root `Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/mega-agent"]
```

Pin the toolchain to whatever stable is actually installed — do not copy a version number from this plan, it will be stale:

```bash
rustc --version
```

Write the version from that output into `rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.XX.Y"          # exact output of `rustc --version`
components = ["rustfmt", "clippy"]
```

`crates/mega-agent/Cargo.toml`:

```toml
[package]
name = "mega-agent"
version = "0.0.0"
edition = "2021"
publish = false

[dependencies]
anyhow = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
tempfile = "3"
```

`crates/mega-agent/src/lib.rs`:

```rust
pub mod event;
```

- [ ] **Step 2: Write the failing test**

In `crates/mega-agent/src/event.rs`, write only the test:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_one_json_line_per_event() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("events.ndjson");

        let mut sink = EventSink::open(&path).unwrap();
        sink.emit(&Event::TurnStarted { turn: 1 }).unwrap();
        sink.emit(&Event::TaskFinished { id: "t1".into(), resolved: true }).unwrap();

        let body = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "one line per event");

        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["type"], "task_finished");
        assert_eq!(second["resolved"], true);
    }

    #[test]
    fn reopening_appends_rather_than_truncates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.ndjson");

        EventSink::open(&path).unwrap().emit(&Event::TurnStarted { turn: 1 }).unwrap();
        EventSink::open(&path).unwrap().emit(&Event::TurnStarted { turn: 2 }).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap().lines().count(), 2);
    }
}
```

The second test is not redundant: a run that resumes (§12.2) opens the same journal twice, and truncation there would silently destroy the evidence every DoD gate in §16 reads.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cargo test -p mega-agent
```

Expected: FAIL to compile — `cannot find type EventSink in this scope`.

- [ ] **Step 4: Write the minimal implementation**

Above the test module in `crates/mega-agent/src/event.rs`:

```rust
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    RunStarted { session: String, arm: String, suite_hash: String },
    TurnStarted { turn: u32 },
    TaskFinished { id: String, resolved: bool },
}

pub struct EventSink {
    out: BufWriter<File>,
}

impl EventSink {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(dir) = path.parent() {
            create_dir_all(dir)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self { out: BufWriter::new(file) })
    }

    pub fn emit(&mut self, event: &Event) -> std::io::Result<()> {
        serde_json::to_writer(&mut self.out, event)?;
        self.out.write_all(b"\n")?;
        // Flushed per event, not per buffer: a killed run must still leave a
        // readable journal, and §16 accepts the journal as evidence or nothing.
        self.out.flush()
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cargo test -p mega-agent
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Wire Rust into the monorepo gate**

`.gitignore` — append:

```
# Rust build output
target/
```

`biome.json` — add `"crates/**"` to the `files.ignore` array (Biome has no Rust support and `ignoreUnknown` is `false`, so it will otherwise complain about `.rs` files):

```json
      "**/tsconfig.tmp.json",
      "wiki/raw",
      "crates/**"
```

`package.json` — add two scripts and fold them into `verify`:

```json
    "lint:rust": "cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings",
    "test:rust": "cargo test --workspace",
    "verify": "pnpm lint && pnpm lint:rust && pnpm typecheck && pnpm test && pnpm test:rust && pnpm conventions:check",
```

This makes a working Rust toolchain a prerequisite for `pnpm verify`. That is the intended consequence — spec §16 requires that a Rust regression can fail the monorepo gate, and a gate that skips what it cannot run is worse than no gate.

`.github/workflows/ci.yml` — add a toolchain step before `Install` in the `verify` job (after `- uses: pnpm/action-setup@v6`), so both matrix legs have `cargo`:

```yaml
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
```

- [ ] **Step 7: Verify the whole gate is green**

```bash
pnpm verify
```

Expected: PASS. If `cargo clippy` fails on the new code, fix the code — do not relax the lint.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml rust-toolchain.toml crates/ .gitignore biome.json package.json .github/workflows/ci.yml
git commit -m "feat(agent): add mega-agent crate with NDJSON events"
```

---

## Task 2: Eval task suite generated from this repo's git history

Spec §4.3. The suite is the denominator of every number this project claims, so a "list of commits" is not enough — an instance only counts if its tests demonstrably fail before the fix and pass after.

**Files:**
- Create: `crates/mega-agent/src/suite.rs`, `crates/mega-agent/src/bin/suite-gen.rs`
- Create: `crates/mega-agent/tests/suite_gen.rs`
- Modify: `crates/mega-agent/src/lib.rs`, `crates/mega-agent/Cargo.toml`

**Interfaces:**
- Consumes: nothing from Task 1 (independent module).
- Produces: `mega_agent::suite::{Suite, SuiteInstance, classify_paths, suite_hash}`.
  `classify_paths(&[String]) -> Option<(Vec<String>, Vec<String>)>` returns `(test_files, source_files)` or `None` if the commit is not a candidate.
  `suite_hash(&[SuiteInstance]) -> String` is a hex sha256 over the id-sorted canonical JSON.
  `Suite { hash: String, generated_at_unix: u64, repo: String, instances: Vec<SuiteInstance> }` serializes to `crates/mega-agent/suites/self-<hash>.json`.

  **Not** `.megasaver/` — `.gitignore:49` ignores `**/.megasaver/*`, and a pinned suite that is not committed cannot be compared across machines or against a CI baseline. Run journals stay in `.megasaver/agent/` (correctly ignored); the suite is a versioned artifact and is committed.

- [ ] **Step 1: Add the dependencies**

In `crates/mega-agent/Cargo.toml`, add to `[dependencies]`:

```toml
sha2 = "0.10"
tempfile = "3"
```

`tempfile` moves from `[dev-dependencies]` to `[dependencies]` here — `screen_candidate` creates the scratch worktree and it lives in the library, not the tests. Delete the now-duplicate line from `[dev-dependencies]`; Cargo errors on a dependency declared in both.

- [ ] **Step 2: Write the failing unit tests**

`crates/mega-agent/src/suite.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_needs_both_a_test_and_a_source_file() {
        let both = vec![
            "packages/core/src/session.ts".to_string(),
            "packages/core/test/session.test.ts".to_string(),
        ];
        let (tests, sources) = classify_paths(&both).expect("candidate");
        assert_eq!(tests, vec!["packages/core/test/session.test.ts"]);
        assert_eq!(sources, vec!["packages/core/src/session.ts"]);

        assert!(classify_paths(&["packages/core/src/session.ts".to_string()]).is_none());
        assert!(classify_paths(&["packages/core/test/a.test.ts".to_string()]).is_none());
    }

    #[test]
    fn docs_only_changes_are_not_source_files() {
        let paths = vec![
            "README.md".to_string(),
            "packages/core/test/a.test.ts".to_string(),
        ];
        assert!(classify_paths(&paths).is_none(), "a doc edit is not a fix");
    }

    #[test]
    fn hash_is_order_independent_but_content_sensitive() {
        let a = SuiteInstance {
            id: "i1".into(), base_commit: "aaa".into(), fix_commit: "bbb".into(),
            test_files: vec!["t.test.ts".into()], source_files: vec!["s.ts".into()],
            test_cmd: "pnpm vitest run t.test.ts".into(),
        };
        let b = SuiteInstance { id: "i2".into(), ..a.clone() };

        assert_eq!(suite_hash(&[a.clone(), b.clone()]), suite_hash(&[b.clone(), a.clone()]));

        let mut c = b.clone();
        c.test_cmd = "pnpm vitest run other.test.ts".into();
        assert_ne!(suite_hash(&[a, b]), suite_hash(&[c]));
    }
}
```

The third test is the one that matters. §4.3 requires a changed suite to invalidate stored baselines rather than silently compare across corpora — the hash is the mechanism, so it must be stable under reordering and unstable under any content change.

- [ ] **Step 3: Run to verify failure**

```bash
cargo test -p mega-agent --lib suite
```

Expected: FAIL to compile — `cannot find function classify_paths`.

- [ ] **Step 4: Implement the suite types**

Above the tests in `crates/mega-agent/src/suite.rs`:

```rust
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SuiteInstance {
    pub id: String,
    pub base_commit: String,
    pub fix_commit: String,
    pub test_files: Vec<String>,
    pub source_files: Vec<String>,
    pub test_cmd: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Suite {
    pub hash: String,
    /// Unix seconds. Deliberately not RFC3339 — a date crate for one string is
    /// not worth it, and an ambiguous `generated_at: String` is worse than a
    /// field whose name says what it holds.
    pub generated_at_unix: u64,
    pub repo: String,
    pub instances: Vec<SuiteInstance>,
}

const TEST_MARKERS: [&str; 4] = ["/test/", "/tests/", "/__tests__/", ".test."];
const SOURCE_EXTS: [&str; 5] = [".ts", ".tsx", ".rs", ".js", ".mjs"];

fn is_test(path: &str) -> bool {
    TEST_MARKERS.iter().any(|m| path.contains(m))
}

fn is_source(path: &str) -> bool {
    !is_test(path) && SOURCE_EXTS.iter().any(|e| path.ends_with(e))
}

pub fn classify_paths(paths: &[String]) -> Option<(Vec<String>, Vec<String>)> {
    let tests: Vec<String> = paths.iter().filter(|p| is_test(p)).cloned().collect();
    let sources: Vec<String> = paths.iter().filter(|p| is_source(p)).cloned().collect();
    if tests.is_empty() || sources.is_empty() {
        return None;
    }
    Some((tests, sources))
}

pub fn suite_hash(instances: &[SuiteInstance]) -> String {
    let mut sorted = instances.to_vec();
    sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let canonical = serde_json::to_vec(&sorted).expect("SuiteInstance is always serializable");
    format!("{:x}", Sha256::digest(&canonical))
}
```

Add `pub mod suite;` to `crates/mega-agent/src/lib.rs`.

- [ ] **Step 5: Run to verify the unit tests pass**

```bash
cargo test -p mega-agent --lib suite
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing integration test for the red/green screen**

`crates/mega-agent/tests/suite_gen.rs` — builds a throwaway git repo so the screen is exercised for real without depending on this repo's history:

```rust
use std::process::Command;

use mega_agent::suite::screen_candidate;

fn git(dir: &std::path::Path, args: &[&str]) -> String {
    let out = Command::new("git").current_dir(dir).args(args).output().expect("git runs");
    assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn screen_keeps_a_real_red_green_pair_and_drops_an_always_green_one() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "user.email", "t@example.com"]);
    git(root, &["config", "user.name", "t"]);

    // Commit 1: buggy source + a test that fails against it.
    std::fs::write(root.join("s.sh"), "#!/bin/sh\necho wrong\n").unwrap();
    std::fs::write(root.join("t.test.sh"), "#!/bin/sh\n[ \"$(sh s.sh)\" = right ]\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "base"]);
    let base = git(root, &["rev-parse", "HEAD"]);

    // Commit 2: the fix. Same test file, now passing.
    std::fs::write(root.join("s.sh"), "#!/bin/sh\necho right\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "fix"]);
    let fix = git(root, &["rev-parse", "HEAD"]);

    let kept = screen_candidate(
        root, &base, &fix,
        &["t.test.sh".to_string()],
        &["s.sh".to_string()],
        "sh t.test.sh",
    ).unwrap();
    assert!(kept, "test fails at base and passes at fix — a real instance");

    // A candidate whose test passes at base proves nothing and must be dropped.
    let dropped = screen_candidate(
        root, &base, &fix,
        &["t.test.sh".to_string()],
        &["s.sh".to_string()],
        "true",
    ).unwrap();
    assert!(!dropped, "an always-green command is not evidence of a bug");
}
```

- [ ] **Step 7: Run to verify failure**

```bash
cargo test -p mega-agent --test suite_gen
```

Expected: FAIL to compile — `cannot find function screen_candidate`.

- [ ] **Step 8: Implement the screen**

Append to `crates/mega-agent/src/suite.rs`:

```rust
use std::path::Path;
use std::process::Command;

fn run(dir: &Path, program: &str, args: &[&str]) -> anyhow::Result<bool> {
    Ok(Command::new(program).current_dir(dir).args(args).status()?.success())
}

/// True when the tests fail at `base` with the fix's test files applied, and
/// pass once the fix's source files are applied too. Anything else is not
/// evidence of a bug and does not enter the suite.
pub fn screen_candidate(
    repo: &Path,
    base: &str,
    fix: &str,
    test_files: &[String],
    source_files: &[String],
    test_cmd: &str,
) -> anyhow::Result<bool> {
    let work = tempfile::tempdir()?;
    let work_path = work.path().join("wt");
    let work_str = work_path.to_string_lossy().to_string();

    run(repo, "git", &["worktree", "add", "--detach", "-q", &work_str, base])?;
    let result = (|| -> anyhow::Result<bool> {
        let mut checkout: Vec<&str> = vec!["checkout", fix, "--"];
        checkout.extend(test_files.iter().map(String::as_str));
        run(&work_path, "git", &checkout)?;

        if run(&work_path, "sh", &["-c", test_cmd])? {
            return Ok(false); // green at base — the test does not capture the bug
        }

        let mut apply: Vec<&str> = vec!["checkout", fix, "--"];
        apply.extend(source_files.iter().map(String::as_str));
        run(&work_path, "git", &apply)?;

        run(&work_path, "sh", &["-c", test_cmd]) // must be green now
    })();

    // Always remove the worktree: a failed screen must not leave registrations
    // behind, or the next run's `worktree add` collides on a stale path.
    let _ = run(repo, "git", &["worktree", "remove", "--force", &work_str]);
    result
}
```

- [ ] **Step 9: Run to verify it passes**

```bash
cargo test -p mega-agent --test suite_gen
```

Expected: PASS, 1 test.

- [ ] **Step 10: Write the generator binary**

`crates/mega-agent/src/bin/suite-gen.rs`. It walks `git log`, classifies each commit, screens the candidates, and writes the pinned suite:

```rust
use std::path::PathBuf;
use std::process::Command;

use mega_agent::suite::{classify_paths, screen_candidate, suite_hash, Suite, SuiteInstance};

fn main() -> anyhow::Result<()> {
    let repo = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| ".".into()));
    let limit: usize = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(30);

    let log = Command::new("git")
        .current_dir(&repo)
        .args(["log", "--format=%H", "-n", "400"])
        .output()?;
    let shas: Vec<String> =
        String::from_utf8_lossy(&log.stdout).lines().map(str::to_string).collect();

    let mut instances = Vec::new();
    for fix in shas {
        if instances.len() >= limit {
            break;
        }
        let files = Command::new("git")
            .current_dir(&repo)
            .args(["show", "--name-only", "--format=", &fix])
            .output()?;
        let paths: Vec<String> =
            String::from_utf8_lossy(&files.stdout).lines().map(str::to_string).collect();

        let Some((test_files, source_files)) = classify_paths(&paths) else { continue };

        let base = String::from_utf8_lossy(
            &Command::new("git").current_dir(&repo).args(["rev-parse", &format!("{fix}^")]).output()?.stdout,
        ).trim().to_string();
        if base.is_empty() {
            continue;
        }

        let test_cmd = format!("pnpm vitest run --no-coverage {}", test_files.join(" "));
        if !screen_candidate(&repo, &base, &fix, &test_files, &source_files, &test_cmd)? {
            continue;
        }
        instances.push(SuiteInstance {
            id: format!("self-{}", &fix[..8]),
            base_commit: base,
            fix_commit: fix,
            test_files,
            source_files,
            test_cmd,
        });
    }

    let hash = suite_hash(&instances);
    let suite = Suite {
        hash: hash.clone(),
        generated_at_unix: now_unix(),
        repo: repo.to_string_lossy().to_string(),
        instances,
    };
    let out = repo.join("crates/mega-agent/suites").join(format!("self-{}.json", &hash[..12]));
    std::fs::create_dir_all(out.parent().expect("suites dir has a parent"))?;
    std::fs::write(&out, serde_json::to_vec_pretty(&suite)?)?;
    eprintln!("wrote {} instances to {}", suite.instances.len(), out.display());
    Ok(())
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock is after 1970")
        .as_secs()
}
```

- [ ] **Step 11: Generate a real suite and read it**

```bash
cargo run -p mega-agent --bin suite-gen -- . 10
```

Expected: a `crates/mega-agent/suites/self-*.json` file with ≥ 1 instance, and the count on stderr. This is slow (it runs the test suite twice per candidate) — that is the price of a suite whose instances are known-good, and it is paid once.

If it yields zero instances, do not lower the bar. Read the screen output and find out why: it usually means `test_cmd` is wrong for this repo's layout, which is a bug in the generator, not a reason to accept unscreened instances.

- [ ] **Step 12: Commit**

```bash
git add crates/mega-agent/src/suite.rs crates/mega-agent/src/bin/suite-gen.rs crates/mega-agent/tests/suite_gen.rs crates/mega-agent/src/lib.rs crates/mega-agent/Cargo.toml crates/mega-agent/suites/
git commit -m "feat(agent): generate eval suite from git history"
```

---

## Task 3: The supervisor/agent RPC frame

Spec §3.3. This is the channel that lets the agent be sandboxed with no network at all: it holds the model and daemon connections on the supervisor's side of the boundary, and the agent reaches them only by asking.

Two properties matter more than elegance here. The channel is written to by a process we assume is hostile (§3.3), so the frame reader must not trust a length header. And the frame layer must not know what a chat request is — if `rpc.rs` depends on `provider/`, the module built for safety depends on the module built for throughput, and neither can be tested alone.

**Files:**
- Create: `crates/mega-agent/src/rpc.rs`
- Create: `crates/mega-agent/tests/rpc_frame.rs`
- Modify: `crates/mega-agent/src/lib.rs`

**Interfaces:**
- Consumes: nothing (deliberately — this module has no dependency on any other task).
- Produces:
  - `mega_agent::rpc::Frame { kind: String, body: serde_json::Value }`, deriving `Debug, Clone, PartialEq, Serialize, Deserialize`.
  - `mega_agent::rpc::write_frame(w: &mut impl Write, f: &Frame) -> std::io::Result<()>`
  - `mega_agent::rpc::read_frame(r: &mut impl Read) -> std::io::Result<Option<Frame>>` — `Ok(None)` on clean EOF, `Err` on a truncated or oversized frame.
  - `mega_agent::rpc::MAX_FRAME_BYTES: usize` = `64 * 1024 * 1024`.

- [ ] **Step 1: Write the failing tests**

`crates/mega-agent/tests/rpc_frame.rs`:

```rust
use mega_agent::rpc::{read_frame, write_frame, Frame, MAX_FRAME_BYTES};

fn frame(kind: &str) -> Frame {
    Frame { kind: kind.into(), body: serde_json::json!({ "n": 1, "s": "héllo" }) }
}

#[test]
fn a_frame_survives_a_round_trip() {
    let mut buf = Vec::new();
    write_frame(&mut buf, &frame("model.chat")).unwrap();
    let mut cur = std::io::Cursor::new(buf);
    assert_eq!(read_frame(&mut cur).unwrap(), Some(frame("model.chat")));
}

#[test]
fn two_frames_written_back_to_back_read_back_as_two() {
    // The classic framing bug: a reader that consumes to EOF, or that keeps a
    // buffer it forgets to drain, silently merges or drops the second frame.
    let mut buf = Vec::new();
    write_frame(&mut buf, &frame("daemon.fence")).unwrap();
    write_frame(&mut buf, &frame("end")).unwrap();

    let mut cur = std::io::Cursor::new(buf);
    assert_eq!(read_frame(&mut cur).unwrap(), Some(frame("daemon.fence")));
    assert_eq!(read_frame(&mut cur).unwrap(), Some(frame("end")));
    assert_eq!(read_frame(&mut cur).unwrap(), None, "clean EOF, not an error");
}

#[test]
fn an_oversized_length_header_is_rejected_without_allocating() {
    // The agent writes into this channel and is assumed hostile (§3.3). A reader
    // that trusts the header will happily try to reserve 4 GiB on request.
    let mut buf = ((MAX_FRAME_BYTES + 1) as u32).to_be_bytes().to_vec();
    buf.extend_from_slice(b"{}");
    let err = read_frame(&mut std::io::Cursor::new(buf)).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
}

#[test]
fn a_truncated_frame_is_an_error_not_a_silent_none() {
    // Distinguishing "peer closed cleanly" from "peer died mid-frame" is the
    // difference between a normal shutdown and a lost tool result.
    let mut buf = Vec::new();
    write_frame(&mut buf, &frame("model.chunk")).unwrap();
    buf.truncate(buf.len() - 3);
    let err = read_frame(&mut std::io::Cursor::new(buf)).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p mega-agent --test rpc_frame
```

Expected: FAIL to compile — `unresolved import mega_agent::rpc`.

- [ ] **Step 3: Implement the frame layer**

`crates/mega-agent/src/rpc.rs`:

```rust
use std::io::{Error, ErrorKind, Read, Write};

use serde::{Deserialize, Serialize};

/// Refuse anything larger rather than trusting a hostile peer's length header.
pub const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub kind: String,
    pub body: serde_json::Value,
}

pub fn write_frame(w: &mut impl Write, f: &Frame) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(f)?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(Error::new(ErrorKind::InvalidData, "frame exceeds MAX_FRAME_BYTES"));
    }
    w.write_all(&(bytes.len() as u32).to_be_bytes())?;
    w.write_all(&bytes)?;
    w.flush()
}

pub fn read_frame(r: &mut impl Read) -> std::io::Result<Option<Frame>> {
    let mut header = [0u8; 4];
    match r.read_exact(&mut header) {
        Ok(()) => {}
        Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(header) as usize;
    if len > MAX_FRAME_BYTES {
        return Err(Error::new(ErrorKind::InvalidData, "frame exceeds MAX_FRAME_BYTES"));
    }
    let mut bytes = vec![0u8; len];
    r.read_exact(&mut bytes)?;
    serde_json::from_slice(&bytes).map(Some).map_err(Into::into)
}
```

Add `pub mod rpc;` to `lib.rs`.

Note on the EOF split: `read_exact` on the *header* hitting EOF means the peer closed between frames — that is `Ok(None)`. `read_exact` on the *body* hitting EOF means it died mid-frame, and its `UnexpectedEof` propagates as the error the fourth test asserts. That asymmetry is the whole point; do not collapse both arms into `Ok(None)`.

- [ ] **Step 4: Run to verify pass**

```bash
cargo test -p mega-agent --test rpc_frame
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/mega-agent/src/rpc.rs crates/mega-agent/tests/rpc_frame.rs crates/mega-agent/src/lib.rs
git commit -m "feat(agent): add length-prefixed supervisor RPC frame"
```

---

## Task 4: Process-level OS sandbox and the agent launcher

Spec §3.3, §11.1, §11.2. This is the containment, and it lands before anything in this plan runs a model loop — including Arm A, which is a real agent with real `bash`.

**The correction this task encodes.** An earlier draft installed the sandbox by wrapping each child `Command`. That leaves the harness's own in-process `fs::write` and edit-apply *outside* the profile, which makes the fence exactly the theatre spec §11.2 was written to end — `bash` guarded at the syscall boundary while `write`, in the same process image, is guarded by a politely-worded `if`. The profile is entered by the **process**. Every route to the filesystem is then inside it, and there is no route that is not a route to the filesystem.

**Why the tests spawn a binary.** Entering a sandbox is process-global and irreversible: a test that entered it would poison every test after it in the same harness process, and `cargo test` gives no ordering guarantee. So the assertions run against `sandbox-probe`, a binary that enters the profile and then attempts exactly one named operation. This is not a workaround; it is the only honest way to test an irreversible global.

**Files:**
- Create: `crates/mega-agent/src/sandbox/mod.rs`, `crates/mega-agent/src/sandbox/seatbelt.rs`, `crates/mega-agent/src/sandbox/landlock.rs`
- Create: `crates/mega-agent/src/supervisor.rs`
- Create: `crates/mega-agent/src/bin/sandbox-probe.rs`
- Create: `crates/mega-agent/tests/sandbox_escape.rs`
- Modify: `crates/mega-agent/src/lib.rs`, `crates/mega-agent/Cargo.toml`

**Interfaces:**
- Consumes: `mega_agent::rpc::{Frame, read_frame, write_frame}` (Task 3).
- Produces:
  - `mega_agent::sandbox::SandboxMode` — `ReadOnly | WorkspaceWrite | DangerFullAccess`, deriving `Debug, Clone, Copy, PartialEq`.
  - `mega_agent::sandbox::Profile::compile(mode: SandboxMode, worktree: &Path, fenced: &[PathBuf]) -> anyhow::Result<Profile>` — `fenced` is a **deny** list; everything under `worktree` is writable unless it appears there. No port argument: there is no network carve-out (§11.1).
  - `mega_agent::sandbox::Profile::enter(self) -> anyhow::Result<()>` — applies to the current process. Idempotent via the `MEGA_AGENT_SANDBOXED` marker.
  - `mega_agent::supervisor::spawn_agent(exe: &Path, args: &[String], profile: &Profile) -> std::io::Result<std::process::Child>` — piped stdin/stdout, inherited stderr.

- [ ] **Step 1: Write the probe binary**

`crates/mega-agent/src/bin/sandbox-probe.rs`. Written before the tests because the tests invoke it; it is scaffolding for the assertions, not production behaviour.

```rust
use std::path::PathBuf;

use mega_agent::rpc::{read_frame, write_frame};
use mega_agent::sandbox::{Profile, SandboxMode};

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let worktree = PathBuf::from(args.next().expect("worktree"));
    let fenced: Vec<PathBuf> = match args.next().as_deref() {
        None | Some("") => vec![],
        Some(csv) => csv.split(',').map(PathBuf::from).collect(),
    };
    let op = args.next().expect("op");

    Profile::compile(SandboxMode::WorkspaceWrite, &worktree, &fenced)?.enter()?;

    // Everything below runs inside the profile.
    let ok = match op.split_once(':') {
        Some(("write", path)) => std::fs::write(path, "pwned\n").is_ok(),
        Some(("sh", script)) => std::process::Command::new("sh")
            .current_dir(&worktree)
            .args(["-c", script])
            .status()
            .map(|s| s.success())
            .unwrap_or(false),
        Some(("connect", addr)) => std::net::TcpStream::connect(addr).is_ok(),
        Some(("rpc-echo", _)) | None if op.starts_with("rpc-echo") => {
            let mut stdin = std::io::stdin().lock();
            let mut stdout = std::io::stdout().lock();
            match read_frame(&mut stdin)? {
                Some(f) => {
                    write_frame(&mut stdout, &f)?;
                    true
                }
                None => false,
            }
        }
        _ => panic!("unknown op: {op}"),
    };
    std::process::exit(if ok { 0 } else { 1 });
}
```

- [ ] **Step 2: Write the failing tests**

`crates/mega-agent/tests/sandbox_escape.rs`. These are the §16 gates.

```rust
#![cfg(unix)]

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use mega_agent::rpc::{read_frame, write_frame, Frame};

fn probe(worktree: &Path, fenced: &str, op: &str) -> bool {
    Command::new(env!("CARGO_BIN_EXE_sandbox-probe"))
        .args([&worktree.display().to_string(), fenced, op])
        .status()
        .expect("probe runs")
        .success()
}

#[test]
fn a_write_inside_the_worktree_succeeds() {
    // Positive control for every denial below. Without it, a profile that denies
    // everything makes the whole file green while the sandbox is broken in the
    // opposite direction — "the fence works" and "nothing works" look identical.
    let wt = tempfile::tempdir().unwrap();
    let inside = wt.path().join("ok.txt");
    assert!(probe(wt.path(), "", &format!("write:{}", inside.display())));
    assert_eq!(std::fs::read_to_string(&inside).unwrap(), "pwned\n");
}

#[test]
fn a_write_outside_the_worktree_is_denied() {
    let wt = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let target = outside.path().join("escaped.txt");
    assert!(!probe(wt.path(), "", &format!("write:{}", target.display())));
    assert!(!target.exists());
}

#[test]
fn an_in_process_write_to_a_fenced_path_is_denied() {
    // The finding this task exists for. `write` is an ordinary fs::write in the
    // harness's own address space; a sandbox that only wrapped child Commands
    // would never see it, and spec §11.2's claim would be false.
    let wt = tempfile::tempdir().unwrap();
    let fenced = wt.path().join("pnpm-lock.yaml");
    std::fs::write(&fenced, "original\n").unwrap();

    assert!(!probe(
        wt.path(),
        &fenced.display().to_string(),
        &format!("write:{}", fenced.display()),
    ));
    assert_eq!(std::fs::read_to_string(&fenced).unwrap(), "original\n");
}

#[test]
fn every_bash_bypass_of_the_fence_is_denied() {
    let wt = tempfile::tempdir().unwrap();
    let fenced = wt.path().join("pnpm-lock.yaml");
    std::fs::write(&fenced, "original\n").unwrap();
    let csv = fenced.display().to_string();

    // The four one-liners that made a write-path-only fence theatre (§11.2).
    for script in [
        "sed -i.bak s/original/pwned/ pnpm-lock.yaml",
        "echo pwned > pnpm-lock.yaml",
        "printf pwned >> pnpm-lock.yaml",
        "rm -f pnpm-lock.yaml",
    ] {
        assert!(!probe(wt.path(), &csv, &format!("sh:{script}")), "`{script}` was allowed");
        assert_eq!(std::fs::read_to_string(&fenced).unwrap(), "original\n");
    }

    // Positive control at the same fence, same profile: a non-fenced write must
    // still succeed, or the four assertions above prove only that sh is broken.
    assert!(probe(wt.path(), &csv, "sh:echo fine > not-fenced.txt"));
    assert_eq!(std::fs::read_to_string(wt.path().join("not-fenced.txt")).unwrap(), "fine\n");
}

#[test]
fn all_network_egress_is_denied_including_loopback() {
    // A listener we own on loopback. Asserting against something we control is
    // what makes a connect failure attributable to the sandbox rather than to a
    // host that happens to be offline — and loopback specifically, because the
    // carve-out that used to live here is what §3.3 removed.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let wt = tempfile::tempdir().unwrap();

    assert!(!probe(wt.path(), "", &format!("connect:{addr}")), "loopback must be denied");
    assert!(!probe(wt.path(), "", "connect:203.0.113.1:80"), "TEST-NET-3 must be denied");
}

#[test]
fn the_supervisor_channel_survives_the_sandbox() {
    // The positive control for the network test: "no network" must not mean
    // "no way to reach the supervisor", or the agent cannot call the model at
    // all and every denial above is trivially satisfied by a dead process.
    let wt = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_sandbox-probe"))
        .args([&wt.path().display().to_string(), "", "rpc-echo"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();

    let sent = Frame { kind: "model.chat".into(), body: serde_json::json!({ "hi": true }) };
    let mut stdin = child.stdin.take().unwrap();
    write_frame(&mut stdin, &sent).unwrap();
    stdin.flush().unwrap();
    drop(stdin);

    let mut stdout = child.stdout.take().unwrap();
    assert_eq!(read_frame(&mut stdout).unwrap(), Some(sent));
    assert!(child.wait().unwrap().success());
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cargo test -p mega-agent --test sandbox_escape
```

Expected: FAIL to compile — `unresolved import mega_agent::sandbox`.

- [ ] **Step 4: Implement the profile**

`crates/mega-agent/src/sandbox/mod.rs`:

```rust
use std::path::{Path, PathBuf};

#[cfg(target_os = "linux")]
mod landlock;
#[cfg(target_os = "macos")]
mod seatbelt;

/// Set on the re-exec'd child on macOS so `enter` is idempotent.
pub const SANDBOXED_MARKER: &str = "MEGA_AGENT_SANDBOXED";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SandboxMode {
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub mode: SandboxMode,
    pub worktree: PathBuf,
    pub fenced: Vec<PathBuf>,
}

impl Profile {
    pub fn compile(
        mode: SandboxMode,
        worktree: &Path,
        fenced: &[PathBuf],
    ) -> anyhow::Result<Self> {
        let worktree = worktree.canonicalize()?;
        // Canonicalize the deny list too: a fenced path given as `a/../b` must
        // still match the kernel's view of `b`.
        let fenced = fenced
            .iter()
            .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()))
            .collect();
        Ok(Self { mode, worktree, fenced })
    }

    pub fn enter(self) -> anyhow::Result<()> {
        if self.mode == SandboxMode::DangerFullAccess {
            return Ok(());
        }
        if std::env::var_os(SANDBOXED_MARKER).is_some() {
            return Ok(());
        }
        #[cfg(target_os = "macos")]
        return seatbelt::enter(self);
        #[cfg(target_os = "linux")]
        return landlock::enter(self);
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        anyhow::bail!(
            "no sandbox implementation for this platform; mega-agent refuses \
             unattended modes without one (spec §11.1)"
        );
    }
}
```

`crates/mega-agent/src/sandbox/seatbelt.rs`:

```rust
use std::io::Write;
use std::os::unix::process::CommandExt;
use std::process::Command;

use super::{Profile, SandboxMode, SANDBOXED_MARKER};

/// Seatbelt has no in-process entry we can rely on (`sandbox_init` is
/// deprecated and its profile language is undocumented), so we re-exec the
/// current binary under `sandbox-exec`. `exec` replaces the image, so the
/// inherited stdin/stdout pipes — the supervisor channel (§3.3) — survive.
pub fn enter(p: Profile) -> anyhow::Result<()> {
    let mut file = tempfile::Builder::new().suffix(".sb").tempfile()?;
    file.write_all(profile_text(&p).as_bytes())?;
    let (_, path) = file.keep()?;

    let exe = std::env::current_exe()?;
    let args: Vec<String> = std::env::args().skip(1).collect();

    let err = Command::new("sandbox-exec")
        .arg("-f")
        .arg(&path)
        .arg(&exe)
        .args(&args)
        .env(SANDBOXED_MARKER, "1")
        .exec();
    Err(err.into())
}

fn profile_text(p: &Profile) -> String {
    let tmp = std::env::temp_dir();
    let mut s = String::from("(version 1)\n(deny default)\n");
    s.push_str("(allow process-exec process-fork sysctl-read signal)\n");
    s.push_str("(allow file-read*)\n");
    if p.mode == SandboxMode::WorkspaceWrite {
        s.push_str(&format!(
            "(allow file-write* (subpath {:?}) (subpath {:?}))\n",
            p.worktree.display().to_string(),
            tmp.display().to_string(),
        ));
    }
    // Deny after allow wins in seatbelt, which is the only reason the fence can
    // be expressed as a deny list layered over a broad worktree allow.
    for f in &p.fenced {
        s.push_str(&format!("(deny file-write* (subpath {:?}))\n", f.display().to_string()));
    }
    s.push_str("(deny network*)\n");
    s
}
```

`crates/mega-agent/src/sandbox/landlock.rs`:

```rust
use landlock::{
    Access, AccessFs, AccessNet, NetPort, PathBeneath, PathFd, RestrictionStatus, Ruleset,
    RulesetAttr, RulesetCreatedAttr, RulesetStatus, ABI,
};

use super::{Profile, SandboxMode};

/// Landlock restricts the *current* process, so no re-exec is needed. ABI 4 is
/// the floor because that is where TCP restriction arrives; below it we would
/// silently run with network access, which is worse than refusing.
pub fn enter(p: Profile) -> anyhow::Result<()> {
    let abi = ABI::V4;
    let mut ruleset = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))?
        .handle_access(AccessNet::BindTcp | AccessNet::ConnectTcp)?
        .create()?;

    if p.mode == SandboxMode::WorkspaceWrite {
        for dir in [p.worktree.clone(), std::env::temp_dir()] {
            ruleset = ruleset.add_rule(PathBeneath::new(PathFd::new(&dir)?, AccessFs::from_all(abi)))?;
        }
    }
    // Reads stay broad, matching the seatbelt profile and §11.1's read-anywhere rule.
    ruleset = ruleset.add_rule(PathBeneath::new(PathFd::new("/")?, AccessFs::from_read(abi)))?;

    // No `add_rule` for AccessNet at all: no port is permitted, in either
    // direction. There is no daemon carve-out (§3.3) — the supervisor channel is
    // an inherited pipe, which Landlock's network hooks do not touch.
    let _: Vec<NetPort> = vec![];

    let status: RestrictionStatus = ruleset.restrict_self()?;
    if status.ruleset != RulesetStatus::FullyEnforced {
        anyhow::bail!(
            "Landlock reports {:?}, not FullyEnforced — this kernel cannot \
             enforce the profile and mega-agent will not run unattended \
             pretending otherwise (spec §11.1)",
            status.ruleset
        );
    }
    Ok(())
}
```

The fenced deny list has no Landlock equivalent — Landlock is allow-only, with no deny-after-allow. Express the fence by narrowing the allow set: grant write beneath the worktree, then for each fenced path grant nothing, relying on Landlock's rule that the most specific matching rule wins. If a kernel's Landlock cannot express a per-file exclusion under a granted directory, the Linux path must fall back to granting write per top-level entry of the worktree, excluding fenced ones. Write that fallback only if the first form fails the `an_in_process_write_to_a_fenced_path_is_denied` test on a real Linux host — do not write it speculatively, and do not skip the test on Linux to avoid finding out.

`crates/mega-agent/src/supervisor.rs`:

```rust
use std::path::Path;
use std::process::{Child, Command, Stdio};

use crate::sandbox::Profile;

/// Launch an agent into `profile`. The child enters the sandbox itself, at
/// startup, before its first model call — the parent does not wrap it. Stdin and
/// stdout are the RPC channel (§3.3); stderr is inherited so the child's
/// diagnostics reach the operator's terminal unchanged.
pub fn spawn_agent(exe: &Path, args: &[String], profile: &Profile) -> std::io::Result<Child> {
    Command::new(exe)
        .args(args)
        .arg("--worktree")
        .arg(&profile.worktree)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
}
```

Add to `lib.rs`:

```rust
pub mod sandbox;
pub mod supervisor;
```

Add to `crates/mega-agent/Cargo.toml`:

```toml
[target.'cfg(target_os = "linux")'.dependencies]
landlock = "0.4"
```

- [ ] **Step 5: Run to verify pass**

```bash
cargo test -p mega-agent --test sandbox_escape
```

Expected: PASS, 6 tests.

Three of them carry their own positive control — a permitted write, a non-fenced write under the same fence, and an RPC round-trip through the sandbox. Those are what keep the file from going green because *everything* is denied. Before accepting, also run one escape script outside the sandbox and confirm it does escape; a denial that would have failed anyway proves nothing.

If `the_supervisor_channel_survives_the_sandbox` fails on macOS, check the re-exec first: `exec` must replace the image so the inherited pipes carry over. A `spawn` + `wait` there would close them and the failure would look like a sandbox problem.

Two details of `seatbelt::enter` are load-bearing for Task 5 and must not be
"simplified" away. It collects `std::env::args().skip(1)` and passes them
through, so the `--agent` flag survives into the re-exec'd image; and it sets
`SANDBOXED_MARKER` in the exec'd **environment**, not merely reads it, so the
second pass through `enter` returns immediately. Drop either and the re-exec'd
process restarts in supervisor mode and spawns a third process — and
`the_supervisor_channel_survives_the_sandbox` still passes, because the pipes
do survive. It is the mode that flips, silently.

- [ ] **Step 6: Commit**

```bash
git add crates/mega-agent/src/sandbox crates/mega-agent/src/supervisor.rs crates/mega-agent/src/bin/sandbox-probe.rs crates/mega-agent/tests/sandbox_escape.rs crates/mega-agent/src/lib.rs crates/mega-agent/Cargo.toml
git commit -m "feat(agent): enter OS sandbox at process level"
```

---

## Task 5: Provider abstraction and Arm A (the baseline loop)

Spec §4.1. Arm A is deliberately ~200 lines and deliberately dumb — it is the control, and a control that accumulates features stops being one.

**Files:**
- Create: `crates/mega-agent/src/provider/mod.rs`, `crates/mega-agent/src/provider/openai_compat.rs`, `crates/mega-agent/src/provider/http.rs`, `crates/mega-agent/src/provider/supervisor_provider.rs`, `crates/mega-agent/src/bin/baseline.rs`
- Modify: `crates/mega-agent/src/lib.rs`, `crates/mega-agent/src/event.rs`, `crates/mega-agent/src/supervisor.rs`, `crates/mega-agent/Cargo.toml`

**Interfaces:**
- Consumes: `mega_agent::event::{Event, EventSink}` (Task 1), `mega_agent::suite::{Suite, SuiteInstance}` (Task 2), `mega_agent::rpc::{Frame, read_frame, write_frame}` (Task 3), `mega_agent::sandbox::{Profile, SandboxMode}` (Task 4).
- Produces:
  - `trait Transport: Send + Sync` with `fn post_sse(&self, url: &str, headers: &[(String, String)], body: String) -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<String>> + Send>>` — one SSE *data* payload per item, `[DONE]` sentinels already stripped.
  - `trait Provider` with `fn stream(&self, req: &ChatRequest) -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<Chunk>> + Send>>`.
  - `ChatRequest { model, system, messages: Vec<Message>, tools: Vec<ToolSchema>, cache_breakpoints: Vec<usize> }`.
  - `enum Chunk { Text(String), ToolUse { id, name, input }, Usage { input, output, cache_read, cache_creation }, Done }`.
  - `OpenAiCompat::new(transport, base_url, api_key)` — used by the **supervisor**, which is outside the sandbox and may open sockets.
  - `SupervisorProvider::from_stdio()` — used by the **agent**, which is inside the sandbox and may not. Same `Provider` trait, so nothing downstream knows which side it is on. Also carries `emit(&Event)`, the agent's only route to the journal.
  - `mega_agent::supervisor::serve(rx: impl Read, tx: impl Write, provider: &dyn Provider, sink: &mut EventSink) -> anyhow::Result<()>` — the supervisor's loop: proxies `model.chat`, records `Ttft`/`Usage`, writes agent-shipped events to the journal. It takes the two pipes rather than the `Child` so a test can drive it from a `Cursor` with no process, no sandbox and no socket anywhere in sight; the two real callers do the `.take()` themselves.

Splitting `Transport` from `Provider` is what keeps every wire-format test offline: tests inject a canned transport, so no test in this plan ever opens a socket.

- [ ] **Step 1: Add the HTTP dependency**

```toml
reqwest = { version = "0.12", default-features = false, features = ["blocking", "json", "rustls-tls"] }
```

`default-features = false` + `rustls-tls` avoids the system OpenSSL dependency, which is the usual cause of a Rust crate failing on one CI leg and not the other.

- [ ] **Step 2: Write the failing test**

`crates/mega-agent/src/provider/openai_compat.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{ChatRequest, Chunk, Provider, Transport};

    struct StubTransport(Vec<String>);

    impl Transport for StubTransport {
        fn post_sse(&self, _url: &str, _headers: &[(String, String)], _body: String)
            -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<String>> + Send>> {
            let lines: Vec<anyhow::Result<String>> = self.0.iter().cloned().map(Ok).collect();
            Ok(Box::new(lines.into_iter()))
        }
    }

    fn req() -> ChatRequest {
        ChatRequest {
            model: "stub-model".into(),
            system: "sys".into(),
            messages: vec![],
            tools: vec![],
            cache_breakpoints: vec![],
        }
    }

    #[test]
    fn decodes_text_deltas_and_usage() {
        let stub = StubTransport(vec![
            r#"{"choices":[{"delta":{"content":"he"}}]}"#.into(),
            r#"{"choices":[{"delta":{"content":"llo"}}]}"#.into(),
            r#"{"usage":{"prompt_tokens":12,"completion_tokens":3}}"#.into(),
        ]);
        let p = OpenAiCompat::new(Box::new(stub), "http://stub".into(), "k".into());

        let chunks: Vec<Chunk> = p.stream(&req()).unwrap().map(Result::unwrap).collect();
        let text: String = chunks.iter().filter_map(|c| match c {
            Chunk::Text(t) => Some(t.as_str()),
            _ => None,
        }).collect();
        assert_eq!(text, "hello");

        let usage = chunks.iter().find_map(|c| match c {
            Chunk::Usage { input, output, .. } => Some((*input, *output)),
            _ => None,
        });
        assert_eq!(usage, Some((12, 3)));
    }

    #[test]
    fn decodes_a_tool_call_split_across_deltas() {
        let stub = StubTransport(vec![
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read","arguments":"{\"pa"}}]}}]}"#.into(),
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\":\"a.ts\"}"}}]}}]}"#.into(),
            r#"{"choices":[{"finish_reason":"tool_calls","delta":{}}]}"#.into(),
        ]);
        let p = OpenAiCompat::new(Box::new(stub), "http://stub".into(), "k".into());

        let call = p.stream(&req()).unwrap().map(Result::unwrap).find_map(|c| match c {
            Chunk::ToolUse { name, input, .. } => Some((name, input)),
            _ => None,
        }).expect("a tool call");
        assert_eq!(call.0, "read");
        assert_eq!(call.1["path"], "a.ts");
    }
}
```

The second test is the one that catches real bugs. Every OpenAI-compatible provider fragments `arguments` across deltas at different boundaries, and a decoder that only handles whole-JSON-per-delta works against one vendor and silently drops calls from the next.

- [ ] **Step 3: Run to verify failure**

```bash
cargo test -p mega-agent --lib provider
```

Expected: FAIL to compile — `cannot find type OpenAiCompat`.

- [ ] **Step 4: Implement the traits and the OpenAI-compatible decoder**

`crates/mega-agent/src/provider/mod.rs`:

```rust
pub mod http;
pub mod openai_compat;

// Everything below crosses the supervisor pipe as a frame body (§3.3), so it
// round-trips rather than only serializing outward.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSchema>,
    /// Indices into `messages` after which a cache breakpoint is placed.
    /// Providers cap this at 4 (§6.2.3); enforced in Task 7.
    pub cache_breakpoints: Vec<usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Chunk {
    Text(String),
    ToolUse { id: String, name: String, input: serde_json::Value },
    Usage { input: u64, output: u64, cache_read: u64, cache_creation: u64 },
    Done,
}

pub trait Transport: Send + Sync {
    fn post_sse(&self, url: &str, headers: &[(String, String)], body: String)
        -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<String>> + Send>>;
}

pub trait Provider {
    fn stream(&self, req: &ChatRequest)
        -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<Chunk>> + Send>>;
}
```

`crates/mega-agent/src/provider/openai_compat.rs` — above the tests:

```rust
use super::{ChatRequest, Chunk, Provider, Transport};

pub struct OpenAiCompat {
    transport: Box<dyn Transport>,
    base_url: String,
    api_key: String,
}

impl OpenAiCompat {
    pub fn new(transport: Box<dyn Transport>, base_url: String, api_key: String) -> Self {
        Self { transport, base_url, api_key }
    }
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    args: String,
}

impl Provider for OpenAiCompat {
    fn stream(&self, req: &ChatRequest)
        -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<Chunk>> + Send>> {
        let mut messages = vec![serde_json::json!({ "role": "system", "content": req.system })];
        messages.extend(req.messages.iter().map(|m| serde_json::json!({
            "role": m.role, "content": m.content,
        })));
        let body = serde_json::json!({
            "model": req.model,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": messages,
            "tools": req.tools.iter().map(|t| serde_json::json!({
                "type": "function",
                "function": { "name": t.name, "description": t.description, "parameters": t.input_schema },
            })).collect::<Vec<_>>(),
        });
        let headers = vec![
            ("authorization".to_string(), format!("Bearer {}", self.api_key)),
            ("content-type".to_string(), "application/json".to_string()),
        ];
        let raw = self.transport.post_sse(
            &format!("{}/chat/completions", self.base_url),
            &headers,
            serde_json::to_string(&body)?,
        )?;

        // Tool-call arguments arrive fragmented at vendor-specific boundaries,
        // so calls accumulate by index and are only emitted once complete.
        let mut calls: Vec<PartialCall> = Vec::new();
        let mut out: Vec<anyhow::Result<Chunk>> = Vec::new();
        for line in raw {
            let v: serde_json::Value = match serde_json::from_str(&line?) {
                Ok(v) => v,
                Err(e) => { out.push(Err(e.into())); continue; }
            };
            if let Some(u) = v.get("usage").filter(|u| !u.is_null()) {
                out.push(Ok(Chunk::Usage {
                    input: u["prompt_tokens"].as_u64().unwrap_or(0),
                    output: u["completion_tokens"].as_u64().unwrap_or(0),
                    cache_read: u.pointer("/prompt_tokens_details/cached_tokens")
                        .and_then(serde_json::Value::as_u64).unwrap_or(0),
                    cache_creation: 0,
                }));
            }
            let Some(delta) = v.pointer("/choices/0/delta") else { continue };
            if let Some(t) = delta["content"].as_str() {
                out.push(Ok(Chunk::Text(t.to_string())));
            }
            // `unwrap_or(&vec![])` would borrow a temporary that drops at the
            // end of the expression — this must be an `if let`, not a default.
            if let Some(tool_calls) = delta["tool_calls"].as_array() {
                for tc in tool_calls {
                    let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                    if calls.len() <= idx {
                        calls.resize_with(idx + 1, PartialCall::default);
                    }
                    let slot = &mut calls[idx];
                    if let Some(id) = tc["id"].as_str() { slot.id = id.to_string(); }
                    if let Some(n) = tc.pointer("/function/name").and_then(|n| n.as_str()) {
                        slot.name = n.to_string();
                    }
                    if let Some(a) = tc.pointer("/function/arguments").and_then(|a| a.as_str()) {
                        slot.args.push_str(a);
                    }
                }
            }
        }
        for c in calls.into_iter().filter(|c| !c.name.is_empty()) {
            match serde_json::from_str::<serde_json::Value>(&c.args) {
                Ok(input) => out.push(Ok(Chunk::ToolUse { id: c.id, name: c.name, input })),
                // A malformed call is surfaced, never silently dropped and never
                // silently retried (`anti-patterns.md`). Task 8 turns this into a
                // corrective turn with the parse error as the tool result.
                Err(e) => out.push(Err(anyhow::anyhow!("tool call {} args invalid: {e}", c.name))),
            }
        }
        out.push(Ok(Chunk::Done));
        Ok(Box::new(out.into_iter()))
    }
}
```

- [ ] **Step 5: Run to verify the tests pass**

```bash
cargo test -p mega-agent --lib provider
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Implement the real transport**

`crates/mega-agent/src/provider/http.rs`:

```rust
use std::io::{BufRead, BufReader};

use super::Transport;

pub struct HttpTransport {
    client: reqwest::blocking::Client,
}

impl HttpTransport {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self { client: reqwest::blocking::Client::builder().build()? })
    }
}

impl Transport for HttpTransport {
    fn post_sse(&self, url: &str, headers: &[(String, String)], body: String)
        -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<String>> + Send>> {
        let mut req = self.client.post(url).body(body);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req.send()?;
        let status = res.status();
        if !status.is_success() {
            anyhow::bail!("provider returned {status}");
        }
        let reader = BufReader::new(res);
        Ok(Box::new(reader.lines().filter_map(|line| match line {
            Err(e) => Some(Err(e.into())),
            Ok(l) => {
                let payload = l.strip_prefix("data: ")?;
                if payload.trim() == "[DONE]" { None } else { Some(Ok(payload.to_string())) }
            }
        })))
    }
}
```

- [ ] **Step 7: Write the failing test for the model proxy**

Add four variants to `Event` in `crates/mega-agent/src/event.rs`:

```rust
    AgentStarted { endpoint: String, model: String },
    Usage { input: u64, output: u64, cache_read: u64, cache_creation: u64 },
    Ttft { ms: u64 },
    ToolCall { name: String, ms: u64 },
```

All four are declared here, ahead of the two steps that emit them and one task
before Task 6 reads them. That ordering is deliberate: the reader may lag the
writer (unknown event types are skipped), but a writer that emits a variant the
enum does not have will not compile — including the test below.

**Every event type has exactly one emitter, and the split is not arbitrary.**

| Event | Emitter | Why that side |
|---|---|---|
| `RunStarted`, `TaskFinished` | eval driver (Task 6) | it owns the suite and decides pass/fail |
| `AgentStarted`, `Usage`, `Ttft` | supervisor | it opened the socket and saw the stream |
| `TurnStarted`, `ToolCall`, later `EditApplied`/`EditRejected` | agent | it ran the turn and the tool |

`Usage` is the one that will be emitted twice if nobody says otherwise: it
arrives at the agent as a forwarded `Chunk::Usage` and at the supervisor as a
real one, so both sides can plausibly claim it. If both do, `tokens_per_resolved`
is exactly 2× and every gate still passes. `Ttft` belongs to the supervisor for a
stronger reason than convenience — measured agent-side it would include the pipe
round-trip, which is not time-to-first-token.

`serve` is where the two rules of §3.3 are actually enforced — one emitter per
event type, and the agent never touches the journal — so it gets a test rather
than a manual smoke run. Both rules fail *silently*: a doubled `usage` leaves
every gate green while every token metric reads 2×. The stream is canned and the
journal is a tempfile, so this test opens no socket and spawns no process.

`crates/mega-agent/src/supervisor.rs`:

```rust
#[cfg(test)]
mod proxy_tests {
    use super::*;
    use crate::event::{Event, EventSink};
    use crate::provider::{ChatRequest, Chunk, Provider};
    use crate::rpc::{read_frame, write_frame, Frame};
    use std::io::Cursor;

    struct StubProvider(Vec<Chunk>);

    impl Provider for StubProvider {
        fn stream(&self, _req: &ChatRequest)
            -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<Chunk>> + Send>> {
            let chunks: Vec<anyhow::Result<Chunk>> =
                self.0.clone().into_iter().map(Ok).collect();
            Ok(Box::new(chunks.into_iter()))
        }
    }

    fn framed(fs: Vec<Frame>) -> Cursor<Vec<u8>> {
        let mut buf = Vec::new();
        for f in &fs {
            write_frame(&mut buf, f).unwrap();
        }
        Cursor::new(buf)
    }

    fn chat_frame() -> Frame {
        Frame {
            kind: "model.chat".into(),
            body: serde_json::to_value(ChatRequest {
                model: "stub-model".into(),
                system: "sys".into(),
                messages: vec![],
                tools: vec![],
                cache_breakpoints: vec![],
            })
            .unwrap(),
        }
    }

    fn journal_kinds(path: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|l| {
                serde_json::from_str::<serde_json::Value>(l).unwrap()["type"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    fn reply_kinds(tx: Vec<u8>) -> Vec<String> {
        let mut cur = Cursor::new(tx);
        let mut out = Vec::new();
        while let Some(f) = read_frame(&mut cur).unwrap() {
            out.push(f.kind);
        }
        out
    }

    #[test]
    fn an_agent_event_reaches_the_journal_verbatim() {
        let dir = tempfile::tempdir().unwrap();
        let jpath = dir.path().join("events.ndjson");
        let mut sink = EventSink::open(&jpath).unwrap();
        let rx = framed(vec![Frame {
            kind: "event".into(),
            body: serde_json::to_value(Event::ToolCall { name: "read".into(), ms: 7 }).unwrap(),
        }]);
        let mut tx = Vec::new();

        serve(rx, &mut tx, &StubProvider(vec![]), &mut sink).unwrap();

        assert_eq!(journal_kinds(&jpath), vec!["tool_call"]);
        // An `event` frame is one-way: only `model.chat` earns a reply.
        assert!(tx.is_empty());
    }

    #[test]
    fn usage_is_journaled_exactly_once_and_still_forwarded() {
        let dir = tempfile::tempdir().unwrap();
        let jpath = dir.path().join("events.ndjson");
        let mut sink = EventSink::open(&jpath).unwrap();
        let provider = StubProvider(vec![
            Chunk::Text("hi".into()),
            Chunk::Usage { input: 10, output: 2, cache_read: 8, cache_creation: 0 },
            Chunk::Done,
        ]);
        let mut tx = Vec::new();

        serve(framed(vec![chat_frame()]), &mut tx, &provider, &mut sink).unwrap();

        // The trap: `usage` also travels on to the agent as an ordinary chunk, so
        // an agent that emits it too doubles every token metric in §16 with every
        // gate still green. Exactly one `usage` line, written by the supervisor.
        let kinds = journal_kinds(&jpath);
        assert_eq!(kinds.iter().filter(|k| k.as_str() == "usage").count(), 1);
        assert_eq!(kinds.iter().filter(|k| k.as_str() == "ttft").count(), 1);
        // ...and the forwarding is not what was traded away for that: three
        // chunks reach the agent, then exactly one terminator.
        assert_eq!(reply_kinds(tx), vec!["chunk", "chunk", "chunk", "end"]);
    }

    #[test]
    fn an_unknown_frame_kind_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut sink = EventSink::open(&dir.path().join("events.ndjson")).unwrap();
        let rx = framed(vec![Frame { kind: "daemon.memory".into(), body: serde_json::json!({}) }]);

        // §3.3 lists `daemon.<route>` as future vocabulary. Until a supervisor
        // route exists it must fail loudly here rather than be dropped, which
        // would hang the agent waiting for a reply that is never coming.
        let err = serve(rx, &mut Vec::new(), &StubProvider(vec![]), &mut sink).unwrap_err();
        assert!(err.to_string().contains("daemon.memory"));
    }
}
```

- [ ] **Step 8: Run to verify failure**

```bash
cargo test -p mega-agent proxy_tests
```

Expected: FAIL to compile — `cannot find function serve in this scope`.

- [ ] **Step 9: Write the two halves of the model proxy**

The sandbox denies all network, so the agent cannot open a socket and cannot
open the events journal either — the journal lives outside the worktree, which
is the only writable tree. Both needs are one need: the agent has a pipe, and
everything that is not filesystem-in-the-worktree goes down it.

`crates/mega-agent/src/provider/supervisor_provider.rs` — the agent side:

```rust
use std::io::{Stdin, Stdout};
use std::sync::{Arc, Mutex};

use crate::event::Event;
use crate::provider::{ChatRequest, Chunk, Provider};
use crate::rpc::{read_frame, write_frame, Frame};

/// Implements `Provider` without owning a socket. Nothing downstream can tell
/// it apart from `OpenAiCompat`, which is the whole point of §3.3: the split is
/// invisible above the trait.
#[derive(Clone)]
pub struct SupervisorProvider {
    tx: Arc<Mutex<Stdout>>,
    rx: Arc<Mutex<Stdin>>,
}

impl SupervisorProvider {
    pub fn from_stdio() -> Self {
        Self {
            tx: Arc::new(Mutex::new(std::io::stdout())),
            rx: Arc::new(Mutex::new(std::io::stdin())),
        }
    }

}

/// Ship one event to the supervisor, which owns the journal. The agent never
/// opens the events file: it is outside the worktree, so it is outside the only
/// writable tree the profile grants.
impl crate::event::Events for SupervisorProvider {
    fn emit(&mut self, ev: &Event) -> anyhow::Result<()> {
        let mut tx = self.tx.lock().unwrap();
        write_frame(&mut *tx, &Frame { kind: "event".into(), body: serde_json::to_value(ev)? })?;
        Ok(())
    }
}

impl Provider for SupervisorProvider {
    fn stream(&self, req: &ChatRequest)
        -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<Chunk>> + Send>> {
        {
            let mut tx = self.tx.lock().unwrap();
            write_frame(&mut *tx, &Frame {
                kind: "model.chat".into(), body: serde_json::to_value(req)?,
            })?;
        }
        // `Provider::stream` returns a box with no lifetime parameter, so the
        // iterator is implicitly `'static` and CANNOT borrow `self`. Capture an
        // owned `Arc` clone instead. The tempting fix — read every frame here and
        // return `vec.into_iter()` — compiles and destroys the §10.1 TTFT metric,
        // because a fully-drained stream makes time-to-first-token equal
        // time-to-last-token. Keep it lazy.
        let rx = Arc::clone(&self.rx);
        Ok(Box::new(std::iter::from_fn(move || {
            let mut rx = rx.lock().unwrap();
            match read_frame(&mut *rx) {
                Err(e) => Some(Err(e.into())),
                Ok(None) => Some(Err(anyhow::anyhow!("supervisor closed the channel mid-stream"))),
                Ok(Some(f)) if f.kind == "end" => None,
                Ok(Some(f)) if f.kind == "error" => Some(Err(anyhow::anyhow!("supervisor: {}", f.body))),
                Ok(Some(f)) => Some(serde_json::from_value::<Chunk>(f.body).map_err(Into::into)),
            }
        })))
    }
}
```

Add `pub mod supervisor_provider;` to `provider/mod.rs`, and derive `Clone` on
`SupervisorProvider` — it is two `Arc`s, so a clone shares the same pipe and the
same mutexes. Task 8's kernel needs the one object under two trait objects
(`Box<dyn Provider>` and `Box<dyn Events>`); constructing it twice would make two
independent mutexes over one file descriptor and interleave frames mid-write.

The journal needs a seam for the same reason, in `event.rs`:

```rust
/// Two implementors, two sides of §3.3: `EventSink` writes the file and lives in
/// the supervisor; `SupervisorProvider` writes a frame and lives in the agent,
/// which cannot reach the file at all. Anything that emits events takes this
/// rather than an `EventSink`.
pub trait Events {
    fn emit(&mut self, e: &Event) -> anyhow::Result<()>;
}

impl Events for EventSink {
    fn emit(&mut self, e: &Event) -> anyhow::Result<()> {
        // Not recursion: a `Type::method` path resolves to the inherent impl
        // before the trait one, so this reaches `EventSink`'s own `emit` and
        // only widens `io::Error` to `anyhow::Error`.
        EventSink::emit(self, e)?;
        Ok(())
    }
}
```

The supervisor side, appended to `crates/mega-agent/src/supervisor.rs`:

```rust
use std::io::{Read, Write};

use crate::event::{Event, EventSink};
use crate::provider::{ChatRequest, Chunk, Provider};
use crate::rpc::{read_frame, write_frame, Frame};

/// Serve one agent until it closes its stdout. This is the only place in the
/// system where a socket and a worktree are both reachable, and it reaches the
/// worktree not at all — it holds the model connection and the journal, and
/// forwards. Blocking and single-threaded on purpose: one agent, one turn at a
/// time, so there is nothing to interleave.
///
/// Takes the pipes rather than the `Child` so the loop can be driven from a
/// `Cursor` in a test; the two real callers `.take()` them off the child first.
///
/// The single-threaded shape carries one invariant the agent must respect:
/// between `model.chat` and `end` the supervisor is inside the stream loop and
/// is NOT reading `rx`, so agent-side events emitted mid-stream sit in the pipe
/// buffer until the turn ends. That is safe at ~100 bytes an event against a
/// ~64KB buffer and deadlocks above it. Emit after the drain where you can —
/// Task 8's kernel does, in `Observe`; Arm A emits inside the loop and stays
/// under the bound by having almost nothing to say.
pub fn serve(
    mut rx: impl Read,
    mut tx: impl Write,
    provider: &dyn Provider,
    sink: &mut EventSink,
) -> anyhow::Result<()> {
    while let Some(f) = read_frame(&mut rx)? {
        match f.kind.as_str() {
            "event" => sink.emit(&serde_json::from_value(f.body)?)?,
            "model.chat" => {
                let req: ChatRequest = serde_json::from_value(f.body)?;
                let started = std::time::Instant::now();
                match provider.stream(&req) {
                    // The agent gets a typed failure rather than a closed pipe:
                    // a closed pipe is indistinguishable from a finished stream.
                    Err(e) => write_frame(&mut tx, &Frame {
                        kind: "error".into(), body: serde_json::json!(e.to_string()),
                    })?,
                    Ok(chunks) => {
                        let mut first = true;
                        for chunk in chunks {
                            let chunk = chunk?;
                            if first {
                                sink.emit(&Event::Ttft { ms: started.elapsed().as_millis() as u64 })?;
                                first = false;
                            }
                            if let Chunk::Usage { input, output, cache_read, cache_creation } = &chunk {
                                sink.emit(&Event::Usage {
                                    input: *input, output: *output,
                                    cache_read: *cache_read, cache_creation: *cache_creation,
                                })?;
                            }
                            write_frame(&mut tx, &Frame {
                                kind: "chunk".into(), body: serde_json::to_value(&chunk)?,
                            })?;
                        }
                        write_frame(&mut tx, &Frame {
                            kind: "end".into(), body: serde_json::Value::Null,
                        })?;
                    }
                }
            }
            other => anyhow::bail!("unknown frame kind from agent: {other}"),
        }
    }
    Ok(())
}
```

- [ ] **Step 10: Run to verify the proxy tests pass**

```bash
cargo test -p mega-agent proxy_tests
```

Expected: PASS, 3 tests.


- [ ] **Step 11: Write Arm A**

`crates/mega-agent/src/bin/baseline.rs` — read, write, bash, a turn cap, and nothing else. No edit ladder, no diagnostics, no compaction, no repo map. When you are tempted to improve it, that improvement belongs in Arm B.

**Arm A enters the sandbox too, and this is not optional.** `agent_main`'s first statement is `Profile::compile(SandboxMode::WorkspaceWrite, &root, &[])?.enter()?` (Task 4), before it reads a byte of config. Two reasons, both load-bearing:

1. It is a real agent loop with a real `bash` tool, run unattended across dozens of eval instances. Running it outside a sandbox to collect measurements is precisely the thing this harness exists to prevent, and `current_dir` is not containment — a model that writes an absolute path leaves the worktree without trying.
2. The two arms must differ **only** in the harness. A sandboxed Arm B against an unsandboxed Arm A is an environment asymmetry, and §4.4's same-model check would not catch it because it is not a model difference.

Because the sandbox denies all network (§11.1), Arm A cannot call the model directly either. It talks to the supervisor over stdin/stdout using `rpc::{Frame, read_frame, write_frame}` (Task 3): send `{kind: "model.chat", body: <serialized ChatRequest>}`, then read frames until one arrives with `kind == "end"`. Each intermediate frame's body deserializes into a `Chunk`. The `Provider` trait is unchanged — `SupervisorProvider` is one more implementation of it, sitting beside `OpenAiCompat` rather than replacing it, so every offline wire-format test in this task keeps working untouched.

```rust
use std::path::PathBuf;

use mega_agent::event::{Event, EventSink, Events};
use mega_agent::provider::supervisor_provider::SupervisorProvider;
use mega_agent::provider::{http::HttpTransport, openai_compat::OpenAiCompat};
use mega_agent::provider::{ChatRequest, Chunk, Message, Provider, ToolSchema};
use mega_agent::sandbox::{Profile, SandboxMode};
use mega_agent::supervisor;

const MAX_TURNS: u32 = 30;

fn tools() -> Vec<ToolSchema> {
    vec![
        ToolSchema {
            name: "read".into(),
            description: "Read a UTF-8 file relative to the worktree root.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"],
            }),
        },
        ToolSchema {
            name: "write".into(),
            description: "Overwrite a file with the given content.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "path": { "type": "string" }, "content": { "type": "string" } },
                "required": ["path", "content"],
            }),
        },
        ToolSchema {
            name: "bash".into(),
            description: "Run a shell command in the worktree root.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": { "cmd": { "type": "string" } },
                "required": ["cmd"],
            }),
        },
    ]
}

fn run_tool(root: &PathBuf, name: &str, input: &serde_json::Value) -> String {
    match name {
        "read" => std::fs::read_to_string(root.join(input["path"].as_str().unwrap_or("")))
            .unwrap_or_else(|e| format!("error: {e}")),
        "write" => {
            let path = root.join(input["path"].as_str().unwrap_or(""));
            match std::fs::write(&path, input["content"].as_str().unwrap_or("")) {
                Ok(()) => "ok".into(),
                Err(e) => format!("error: {e}"),
            }
        }
        "bash" => {
            let out = std::process::Command::new("sh")
                .current_dir(root)
                .args(["-c", input["cmd"].as_str().unwrap_or("true")])
                .output();
            match out {
                Ok(o) => format!(
                    "exit {}\n{}{}",
                    o.status.code().unwrap_or(-1),
                    String::from_utf8_lossy(&o.stdout),
                    String::from_utf8_lossy(&o.stderr),
                ),
                Err(e) => format!("error: {e}"),
            }
        }
        other => format!("error: unknown tool {other}"),
    }
}

/// One binary, two modes. The eval driver launches it exactly once per instance
/// and it splits itself — which is what makes "both arms are launched
/// identically" a property of the code rather than a promise in a doc.
fn main() -> anyhow::Result<()> {
    if std::env::args().any(|a| a == "--agent") {
        return agent_main();
    }
    supervisor_main()
}

/// Unsandboxed. Holds the socket and the journal, and touches no file inside the
/// worktree.
fn supervisor_main() -> anyhow::Result<()> {
    let worktree = PathBuf::from(std::env::var("MEGA_AGENT_WORKTREE")?);
    let mut sink = EventSink::open(&PathBuf::from(std::env::var("MEGA_AGENT_EVENTS")?))?;

    let base_url = std::env::var("MEGA_AGENT_BASE_URL")?;
    let model = std::env::var("MEGA_AGENT_MODEL")?;
    let provider = OpenAiCompat::new(
        Box::new(HttpTransport::new()?),
        base_url.clone(),
        std::env::var("MEGA_AGENT_API_KEY").unwrap_or_default(),
    );

    // Emitted by the process that actually opened the socket, from the values it
    // handed the provider. Emitted agent-side it would be a sandboxed process
    // echoing back an env var describing a connection it never made.
    sink.emit(&Event::AgentStarted { endpoint: base_url, model })?;

    let profile = Profile::compile(SandboxMode::WorkspaceWrite, &worktree, &[])?;
    let goal = std::env::args().nth(1).unwrap_or_default();
    let mut child = supervisor::spawn_agent(
        &std::env::current_exe()?,
        &["--agent".to_string(), goal],
        &profile,
    )?;
    let rx = child.stdout.take().expect("spawn_agent pipes stdout");
    let tx = child.stdin.take().expect("spawn_agent pipes stdin");
    supervisor::serve(rx, tx, &provider, &mut sink)?;
    child.wait()?;
    Ok(())
}

/// Sandboxed. Enters the profile before it reads anything, then runs the loop
/// against a provider that is a pipe rather than a socket.
fn agent_main() -> anyhow::Result<()> {
    let root = PathBuf::from(std::env::var("MEGA_AGENT_WORKTREE")?);
    Profile::compile(SandboxMode::WorkspaceWrite, &root, &[])?.enter()?;

    // argv is [exe, "--agent", goal, "--worktree", path]: `spawn_agent` appends
    // the flag and the macOS re-exec preserves argv[1..] verbatim, so index 2 is
    // stable on both platforms and across the re-exec.
    let goal = std::env::args().nth(2).unwrap_or_default();
    let mut provider = SupervisorProvider::from_stdio();

    let mut messages = vec![Message { role: "user".into(), content: goal.into() }];
    for turn in 1..=MAX_TURNS {
        provider.emit(&Event::TurnStarted { turn })?;
        let req = ChatRequest {
        model: std::env::var("MEGA_AGENT_MODEL")?,
            system: "You are a coding agent. Use the tools to fix the repository.".into(),
            messages: messages.clone(),
            tools: tools(),
            cache_breakpoints: vec![],
        };

        let mut called = false;
        for chunk in provider.stream(&req)? {
            match chunk? {
                Chunk::ToolUse { id, name, input } => {
                    called = true;
                    let t0 = std::time::Instant::now();
                    let result = run_tool(&root, &name, &input);
                    provider.emit(&Event::ToolCall {
                        name: name.clone(), ms: t0.elapsed().as_millis() as u64,
                    })?;
                    messages.push(Message {
                        role: "assistant".into(),
                        content: serde_json::json!([{ "type": "tool_use", "id": id, "name": name, "input": input }]),
                    });
                    messages.push(Message {
                        role: "user".into(),
                        content: serde_json::json!([{ "type": "tool_result", "tool_use_id": id, "content": result }]),
                    });
                }
                // Text goes to stderr: stdout is the RPC channel, and a stray
                // `print!` there corrupts the frame stream.
                Chunk::Text(t) => eprint!("{t}"),
                // Not emitted here. The supervisor saw the real stream and
                // already recorded it; emitting again would double every token
                // count in the eval (see the emitter table above).
                Chunk::Usage { .. } => {}
                Chunk::Done => {}
            }
        }
        if !called {
            break; // no tool call, no further work — the model is done talking
        }
    }
    Ok(())
}
```

- [ ] **Step 12: Smoke-run Arm A against a local model**

Start a local OpenAI-compatible server (Ollama's is at `http://localhost:11434/v1`), then:

```bash
mkdir -p /tmp/scratch && MEGA_AGENT_WORKTREE=/tmp/scratch MEGA_AGENT_EVENTS=/tmp/ev.ndjson MEGA_AGENT_BASE_URL=http://localhost:11434/v1 MEGA_AGENT_MODEL=qwen2.5-coder cargo run -p mega-agent --bin baseline -- "create hello.txt containing hi"
```

Expected: `/tmp/scratch/hello.txt` exists, and `/tmp/ev.ndjson` carries all five
event types the split produces — `agent_started`, `ttft`, `usage` from the
supervisor, `turn_started` and `tool_call` from the agent. Per §13 item 5, this
runs against a local model; no paid API spend without separate authorisation.

This is the first end-to-end exercise of §3.3, so read the journal rather than
just checking the exit code. Three failures look like success from the outside:

```bash
jq -r .type /tmp/ev.ndjson | sort | uniq -c
```

- No `turn_started` or `tool_call` lines → the agent's events are not reaching
  the supervisor; the child is writing them somewhere, or nowhere.
- Two `usage` lines per turn → both sides are emitting it; the agent's arm of
  the emitter table was not applied.
- `hello.txt` written but no events at all → the child never entered
  `agent_main` and ran the whole loop as a second supervisor.

- [ ] **Step 13: Commit**

```bash
git add crates/mega-agent/src/provider crates/mega-agent/src/bin/baseline.rs crates/mega-agent/src/event.rs crates/mega-agent/src/supervisor.rs crates/mega-agent/src/lib.rs crates/mega-agent/Cargo.toml
git commit -m "feat(agent): add provider layer and sandboxed baseline arm"
```

---

## Task 6: Two-arm eval driver and metric extraction

Spec §4.1, §4.2, §12.1. This is the task that makes the project falsifiable.

**Files:**
- Create: `crates/mega-agent/src/bin/eval.rs`, `crates/mega-agent/src/metrics.rs`
- Create: `crates/mega-agent/tests/metrics.rs`
- Modify: `crates/mega-agent/src/lib.rs`

**Interfaces:**
- Consumes: `Suite`, `SuiteInstance` (Task 2); `Event`, `EventSink` (Task 1); the `baseline` binary (Task 5).
- Produces: `mega_agent::metrics::{ArmReport, read_journal, RunIdentity, compare, check_spend_lock, percentile, EvalConfig}`.
  `read_journal(&Path) -> anyhow::Result<(RunIdentity, ArmReport)>`.
  `percentile` is a free function, not a method: `percentile(samples: &[u64], p: f64) -> Option<u64>`.
  `ArmReport` derives `Debug, Default, PartialEq` — `Default` so tests can build one from two fields without listing ten.
  `ArmReport { resolved: u32, attempted: u32, tokens_in: u64, tokens_out: u64, cache_read: u64, cache_creation: u64, edits_attempted: u32, edits_applied: u32, ttft_ms: Vec<u64>, tool_ms: Vec<u64> }` with methods `resolve_rate()`, `tokens_per_resolved() -> Option<f64>`, `apply_success_rate() -> Option<f64>`, and `cache_read_ratio() -> Option<f64>`.

  `ttft_ms` and `tool_ms` carry the §10.1 metrics. They are aggregated here, one task before Task 8 starts emitting them, precisely because `read_journal` tolerates unknown event types — the reader is ready before the writer exists, not after.

  `RunIdentity { endpoint: String, model: String, suite_hash: String }`, deriving `Debug, Clone, PartialEq, Serialize, Deserialize`, read from the journal's `RunStarted` event.
  `compare(a: &(RunIdentity, ArmReport), b: &(RunIdentity, ArmReport)) -> Result<Delta, Mismatch>` — refuses to produce a delta when the two identities differ, naming the field that differs.

`Option` returns are the point, not an inconvenience: `bench-replay`'s discipline is that *a measurement tool that silently drifts is worse than no tool*. Zero resolved tasks means `tokens_per_resolved` has no value, and the driver must refuse to print one rather than print `inf` or `0`.

**The three mechanisms from spec §4.4 live in this task**, because this is where the measurement becomes a claim. Each one closes a failure mode that is otherwise *silent* — which is what makes them worth code rather than a paragraph in a README:

| Mechanism | The quiet failure it closes |
|---|---|
| Preflight | No endpoint reachable → every instance fails → a green run reporting an empty measurement, because `Option` returns `None` rather than erroring |
| Same-model check | Arms run against different models or suites → a delta that measures the model, not the harness, and nothing anywhere says so |
| Spend lock | A non-loopback `base_url` in config → real money against an operator confirmation (§13 item 5) that only ever existed as prose |

- [ ] **Step 1: Write the failing test**

`crates/mega-agent/tests/metrics.rs`:

```rust
use mega_agent::metrics::read_journal;

fn journal(lines: &[&str]) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ev.ndjson");
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();
    (dir, path)
}

#[test]
fn aggregates_resolution_tokens_and_apply_rate() {
    let (_d, path) = journal(&[
        r#"{"type":"usage","input":100,"output":10,"cache_read":80,"cache_creation":20}"#,
        r#"{"type":"edit_applied","path":"a.ts","rung":"exact"}"#,
        r#"{"type":"edit_rejected","path":"b.ts","reason":"ambiguous anchor"}"#,
        r#"{"type":"task_finished","id":"t1","resolved":true}"#,
        r#"{"type":"task_finished","id":"t2","resolved":false}"#,
    ]);
    let (_ident, r) = read_journal(&path).unwrap();

    assert_eq!((r.resolved, r.attempted), (1, 2));
    assert_eq!(r.resolve_rate(), 0.5);
    assert_eq!(r.tokens_per_resolved(), Some(110.0));
    assert_eq!(r.apply_success_rate(), Some(0.5));
    assert_eq!(r.cache_read_ratio(), Some(0.8));
}

#[test]
fn refuses_a_ratio_it_cannot_compute() {
    let (_d, path) = journal(&[r#"{"type":"task_finished","id":"t1","resolved":false}"#]);
    let (_ident, r) = read_journal(&path).unwrap();

    assert_eq!(r.resolve_rate(), 0.0);
    assert_eq!(r.tokens_per_resolved(), None, "no resolved tasks, no per-resolved number");
    assert_eq!(r.apply_success_rate(), None, "no edits attempted, no rate");
    assert_eq!(r.cache_read_ratio(), None);
}

#[test]
fn collects_latency_samples_for_the_felt_metrics() {
    let (_d, path) = journal(&[
        r#"{"type":"ttft","ms":380}"#,
        r#"{"type":"ttft","ms":420}"#,
        r#"{"type":"tool_call","name":"read","ms":12}"#,
        r#"{"type":"tool_call","name":"grep","ms":48}"#,
    ]);
    let (_ident, r) = read_journal(&path).unwrap();

    // §10.1: TTFT p50 < 400ms, tool round-trip p50 < 50ms. Reported, and for
    // cold start explicitly not a pillar — no gate here, just the number.
    assert_eq!(mega_agent::metrics::percentile(&r.ttft_ms, 0.5), Some(380));
    assert_eq!(mega_agent::metrics::percentile(&r.tool_ms, 0.5), Some(12));
    assert_eq!(mega_agent::metrics::percentile(&[], 0.5), None);
}

#[test]
fn an_unknown_event_type_does_not_break_the_reader() {
    let (_d, path) = journal(&[
        r#"{"type":"some_future_event","whatever":1}"#,
        r#"{"type":"task_finished","id":"t1","resolved":true}"#,
    ]);
    assert_eq!(read_journal(&path).unwrap().1.resolved, 1);
}
```

The third test matters because every later phase adds `Event` variants. A reader that rejects unknown types turns a Phase 2 feature into a Phase 0 regression.

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p mega-agent --test metrics
```

Expected: FAIL to compile — `unresolved import mega_agent::metrics`.

- [ ] **Step 3: Implement the reader**

`read_journal` returns `(RunIdentity, ArmReport)`. It fills `suite_hash` from `RunStarted`, `endpoint` and `model` from `AgentStarted`, and leaves any it never saw as the empty string — an empty field is a mismatch against a populated one, so a journal missing its identity fails the comparison rather than passing it by default.


`crates/mega-agent/src/metrics.rs`:

```rust
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq)]
pub struct ArmReport {
    pub resolved: u32,
    pub attempted: u32,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cache_read: u64,
    pub cache_creation: u64,
    pub edits_attempted: u32,
    pub edits_applied: u32,
    pub ttft_ms: Vec<u64>,
    pub tool_ms: Vec<u64>,
}

/// What a journal says it measured. Kept apart from `ArmReport` because a
/// report is arithmetic and an identity is provenance: two arms may only be
/// subtracted when their identities match (§4.4).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct RunIdentity {
    pub endpoint: String,
    pub model: String,
    pub suite_hash: String,
}

impl ArmReport {
    pub fn resolve_rate(&self) -> f64 {
        if self.attempted == 0 { return 0.0; }
        f64::from(self.resolved) / f64::from(self.attempted)
    }

    pub fn tokens_per_resolved(&self) -> Option<f64> {
        if self.resolved == 0 { return None; }
        Some((self.tokens_in + self.tokens_out) as f64 / f64::from(self.resolved))
    }

    pub fn apply_success_rate(&self) -> Option<f64> {
        if self.edits_attempted == 0 { return None; }
        Some(f64::from(self.edits_applied) / f64::from(self.edits_attempted))
    }

    pub fn cache_read_ratio(&self) -> Option<f64> {
        let total = self.cache_read + self.cache_creation;
        if total == 0 { return None; }
        Some(self.cache_read as f64 / total as f64)
    }
}

/// Nearest-rank percentile. `None` on an empty sample rather than a fabricated
/// zero — the same refusal as the ratio methods above.
pub fn percentile(samples: &[u64], p: f64) -> Option<u64> {
    if samples.is_empty() { return None; }
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let rank = ((p * sorted.len() as f64).ceil() as usize).max(1) - 1;
    sorted.get(rank).copied()
}

pub fn read_journal(path: &Path) -> anyhow::Result<(RunIdentity, ArmReport)> {
    let mut id = RunIdentity::default();
    let mut r = ArmReport::default();
    for line in std::fs::read_to_string(path)?.lines() {
        if line.trim().is_empty() { continue; }
        let v: serde_json::Value = serde_json::from_str(line)?;
        match v["type"].as_str().unwrap_or("") {
            "usage" => {
                r.tokens_in += v["input"].as_u64().unwrap_or(0);
                r.tokens_out += v["output"].as_u64().unwrap_or(0);
                r.cache_read += v["cache_read"].as_u64().unwrap_or(0);
                r.cache_creation += v["cache_creation"].as_u64().unwrap_or(0);
            }
            "edit_applied" => { r.edits_attempted += 1; r.edits_applied += 1; }
            "edit_rejected" => { r.edits_attempted += 1; }
            "task_finished" => {
                r.attempted += 1;
                if v["resolved"].as_bool().unwrap_or(false) { r.resolved += 1; }
            }
            "ttft" => r.ttft_ms.push(v["ms"].as_u64().unwrap_or(0)),
            "tool_call" => r.tool_ms.push(v["ms"].as_u64().unwrap_or(0)),
            // First writer wins, for both. A journal can legitimately hold several
            // of each — the eval driver writes one `run_started` and then spawns a
            // supervisor per instance, each of which writes its own
            // `agent_started`. The outermost line is the one that describes the
            // run; last-wins would let per-instance lines overwrite it.
            "run_started" if id.suite_hash.is_empty() => {
                id.suite_hash = v["suite_hash"].as_str().unwrap_or("").to_string();
            }
            "agent_started" if id.endpoint.is_empty() => {
                id.endpoint = v["endpoint"].as_str().unwrap_or("").to_string();
                id.model = v["model"].as_str().unwrap_or("").to_string();
            }
            _ => {}
        }
    }
    Ok((id, r))
}
```

Add `pub mod metrics;` to `crates/mega-agent/src/lib.rs`, and the two edit variants to `Event`:

```rust
    EditApplied { path: String, rung: String },
    EditRejected { path: String, reason: String },
```

- [ ] **Step 4: Run to verify the tests pass**

```bash
cargo test -p mega-agent --test metrics
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing tests for the three §4.4 mechanisms**

Append to `crates/mega-agent/tests/metrics.rs`:

```rust
use mega_agent::metrics::{compare, ArmReport, RunIdentity};

fn ident(model: &str) -> RunIdentity {
    RunIdentity {
        endpoint: "http://127.0.0.1:11434/v1".into(),
        model: model.into(),
        suite_hash: "abc123".into(),
    }
}

fn report(resolved: u32) -> ArmReport {
    ArmReport { resolved, attempted: 10, ..Default::default() }
}

#[test]
fn a_delta_across_two_different_models_is_refused() {
    // The hole that would silently invalidate the product's entire claim: two
    // arms measured against different models produce a number that describes
    // the models, not the harness, and nothing in a journal says so.
    let err = compare(&(ident("qwen2.5-coder:7b"), report(3)),
                      &(ident("qwen2.5-coder:32b"), report(6)))
        .unwrap_err();
    assert!(format!("{err}").contains("model"), "the error must name the field: {err}");
}

#[test]
fn a_delta_across_two_different_suites_is_refused() {
    let mut b = ident("qwen2.5-coder:7b");
    b.suite_hash = "def456".into();
    let err = compare(&(ident("qwen2.5-coder:7b"), report(3)), &(b, report(6))).unwrap_err();
    assert!(format!("{err}").contains("suite_hash"));
}

#[test]
fn matching_identities_produce_a_delta() {
    // Positive control. Without it the two refusals above are satisfied by a
    // `compare` that refuses everything.
    let d = compare(&(ident("m"), report(3)), &(ident("m"), report(6))).unwrap();
    assert!((d.resolve_rate - 0.3).abs() < 1e-9);
}

#[test]
fn a_non_loopback_endpoint_is_rejected_without_the_flag() {
    use mega_agent::metrics::check_spend_lock;
    assert!(check_spend_lock("https://api.anthropic.com/v1", false).is_err());
    assert!(check_spend_lock("https://api.anthropic.com/v1", true).is_ok());
    assert!(check_spend_lock("http://127.0.0.1:11434/v1", false).is_ok());
    assert!(check_spend_lock("http://localhost:11434/v1", false).is_ok());
    assert!(check_spend_lock("http://localhost/v1", false).is_ok(), "a portless loopback is still loopback");
}
```

- [ ] **Step 6: Implement them**

In `metrics.rs`:

```rust
#[derive(Debug)]
pub struct Delta {
    pub resolve_rate: f64,
    pub tokens_per_resolved: Option<f64>,
}

#[derive(Debug, thiserror::Error)]
#[error("arms are not comparable: {field} differs ({a} vs {b})")]
pub struct Mismatch {
    pub field: &'static str,
    pub a: String,
    pub b: String,
}

pub fn compare(
    a: &(RunIdentity, ArmReport),
    b: &(RunIdentity, ArmReport),
) -> Result<Delta, Mismatch> {
    for (field, x, y) in [
        ("endpoint", &a.0.endpoint, &b.0.endpoint),
        ("model", &a.0.model, &b.0.model),
        ("suite_hash", &a.0.suite_hash, &b.0.suite_hash),
    ] {
        if x != y {
            return Err(Mismatch { field, a: x.clone(), b: y.clone() });
        }
    }
    Ok(Delta {
        resolve_rate: b.1.resolve_rate() - a.1.resolve_rate(),
        tokens_per_resolved: match (a.1.tokens_per_resolved(), b.1.tokens_per_resolved()) {
            (Some(x), Some(y)) => Some(y - x),
            _ => None,
        },
    })
}

/// §13 item 5, enforced rather than documented. A per-invocation flag, never
/// read from config — same treatment `danger-full-access` gets in §11.1.
pub fn check_spend_lock(base_url: &str, allow_remote: bool) -> anyhow::Result<()> {
    if allow_remote {
        return Ok(());
    }
    let authority = base_url
        .split("://").nth(1).unwrap_or(base_url)
        .split('/').next().unwrap_or("");
    // Strip a port only when there is one. `rsplit_once(':')` alone would eat
    // the tail of a portless `[::1]` and turn loopback into a rejection.
    let host = match authority.rsplit_once(':') {
        Some((h, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => h,
        _ => authority,
    };
    if matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]") {
        return Ok(());
    }
    anyhow::bail!(
        "eval base_url {base_url} is not loopback. Operator confirmation §13/5          permits local models only; pass --allow-remote-model to spend money."
    )
}
```

**Where this check actually bites.** Not within a single driver run: the driver
sets `MEGA_AGENT_BASE_URL` and `MEGA_AGENT_MODEL` for both arms, so within one
run they cannot differ. It bites across runs — comparing a stored baseline
journal from last month against today's harness journal, which is how a delta
gets quoted in practice, and is exactly the moment the model underneath has
quietly been upgraded. Two `read_journal` calls, one `compare`, and the
tempting number is refused instead of published.

`Event::AgentStarted { endpoint, model }` already exists — Task 5 added it, and
emits it from the **supervisor**, the process that opened the socket. Nothing new
is added to `Event` here; `read_journal` simply stops ignoring it.

And the eval endpoint config, deliberately its own block so a change to
production model routing cannot silently move what the measurement runs against
(spec §10.2):

```rust
#[derive(Debug, Deserialize)]
pub struct EvalConfig {
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key_env: Option<String>,
    #[serde(skip)]
    pub allow_remote: bool,
}

impl EvalConfig {
    pub fn load() -> anyhow::Result<Self> {
        let path = std::env::var("MEGA_AGENT_CONFIG").unwrap_or_else(|_| "config.toml".into());
        #[derive(Deserialize)]
        struct Root { eval: EvalConfig }
        let mut cfg: EvalConfig = toml::from_str::<Root>(&std::fs::read_to_string(&path)?)?.eval;
        cfg.allow_remote = std::env::args().any(|a| a == "--allow-remote-model");
        Ok(cfg)
    }

    pub fn api_key(&self) -> Option<String> {
        self.api_key_env.as_ref().and_then(|k| std::env::var(k).ok())
    }
}
```

Write `crates/mega-agent/config.example.toml` with the block filled in and committed — the real `config.toml` is gitignored:

```toml
[eval]
base_url = "http://127.0.0.1:11434/v1"   # any OpenAI-compatible server
model = "qwen2.5-coder:7b"
# api_key_env = "OPENAI_API_KEY"         # only needed for a remote endpoint,
#                                        # which also needs --allow-remote-model
```

No model id appears in any `.rs` file. That is the §10.2 rule and it is what stopped the v1 draft's table from rotting.

Add `thiserror` and `toml` to `[dependencies]`.

- [ ] **Step 7: Run to verify pass**

```bash
cargo test -p mega-agent --test metrics
```

Expected: PASS, 8 tests.

- [ ] **Step 8: Write the two-arm driver**

`crates/mega-agent/src/bin/eval.rs`. For each instance: create a worktree at `base_commit`, apply the fix's test files, run the arm's binary, run `test_cmd`, record the outcome, destroy the worktree.

```rust
use std::path::{Path, PathBuf};
use std::process::Command;

use mega_agent::event::{Event, EventSink};
use mega_agent::metrics::{
    check_spend_lock, compare, percentile, read_journal, ArmReport, EvalConfig, RunIdentity,
};
use mega_agent::provider::{http::HttpTransport, openai_compat::OpenAiCompat};
use mega_agent::provider::{ChatRequest, Message, Provider};
use mega_agent::suite::{Suite, SuiteInstance};

fn run_instance(
    repo: &Path,
    inst: &SuiteInstance,
    arm_bin: &str,
    events: &Path,
    cfg: &EvalConfig,
) -> anyhow::Result<bool> {
    let work = tempfile::tempdir()?;
    let wt = work.path().join("wt");
    let wt_str = wt.to_string_lossy().to_string();
    Command::new("git").current_dir(repo)
        .args(["worktree", "add", "--detach", "-q", &wt_str, &inst.base_commit]).status()?;

    let outcome = (|| -> anyhow::Result<bool> {
        let mut checkout: Vec<&str> = vec!["checkout", &inst.fix_commit, "--"];
        checkout.extend(inst.test_files.iter().map(String::as_str));
        Command::new("git").current_dir(&wt).args(&checkout).status()?;

        // Both arms read their endpoint from the environment, and both must read
        // the *same* one — passing it here rather than letting each arm find its
        // own is what makes §4.4's same-model check able to pass at all.
        Command::new(arm_bin)
            .current_dir(&wt)
            .env("MEGA_AGENT_WORKTREE", &wt)
            .env("MEGA_AGENT_EVENTS", events)
            .env("MEGA_AGENT_BASE_URL", &cfg.base_url)
            .env("MEGA_AGENT_MODEL", &cfg.model)
            .env("MEGA_AGENT_API_KEY", cfg.api_key().unwrap_or_default())
            .arg(format!("Make `{}` pass. Do not edit the test files.", inst.test_cmd))
            .status()?;

        Ok(Command::new("sh").current_dir(&wt).args(["-c", &inst.test_cmd]).status()?.success())
    })();

    let _ = Command::new("git").current_dir(repo)
        .args(["worktree", "remove", "--force", &wt_str]).status();
    outcome
}

fn run_arm(
    repo: &Path,
    suite: &Suite,
    arm: &str,
    bin: &str,
    cfg: &EvalConfig,
) -> anyhow::Result<(RunIdentity, ArmReport)> {
    // Absolute, because `run_instance` sets the child's cwd to a tempdir. A
    // relative path here resolves inside that tempdir, the journal is deleted
    // with it, and `read_journal` then reports a run where every token count is
    // zero and every ratio is a well-behaved `None` — an empty measurement that
    // looks exactly like a clean one. `repo` is canonicalized in `main`.
    let events = repo.join(".megasaver/agent").join(format!("eval-{arm}.ndjson"));
    if events.exists() { std::fs::remove_file(&events)?; }
    // N+1 writers share this one path: this driver, plus one supervisor per
    // instance. The sandboxed agents are not among them — they ship frames up
    // the pipe (§3.3) — but the supervisors are, and they are separate
    // processes. It holds because every `EventSink::open` is `O_APPEND` and
    // every `emit` flushes exactly one line, far under `PIPE_BUF`: writes
    // interleave between lines, never inside one. Buffering several events and
    // flushing per turn would break that and produce a spliced line that
    // `read_journal` cannot parse.
    let mut sink = EventSink::open(&events)?;
    sink.emit(&Event::RunStarted {
        session: format!("eval-{arm}"), arm: arm.to_string(), suite_hash: suite.hash.clone(),
    })?;

    for inst in &suite.instances {
        let resolved = run_instance(repo, inst, bin, &events, cfg).unwrap_or(false);
        sink.emit(&Event::TaskFinished { id: inst.id.clone(), resolved })?;
    }
    // `read_journal` returns both: `suite_hash` from this driver's RunStarted,
    // `endpoint` and `model` from the supervisor's AgentStarted.
    read_journal(&events)
}

fn line(label: &str, v: Option<f64>) -> String {
    match v {
        Some(x) => format!("{label}: {x:.4}"),
        // Refusing to emit a number is the instrument working, not a gap.
        None => format!("{label}: n/a (not computable from this run)"),
    }
}

/// One real completion before the first instance runs. Without it, an absent
/// endpoint produces a green run and an empty measurement: every instance fails,
/// `resolved` is 0, and every ratio is a well-behaved `None`.
fn preflight(cfg: &EvalConfig) -> anyhow::Result<()> {
    check_spend_lock(&cfg.base_url, cfg.allow_remote)?;
    let p = OpenAiCompat::new(
        Box::new(HttpTransport::new()?),
        cfg.base_url.clone(),
        cfg.api_key().unwrap_or_default(),
    );
    let req = ChatRequest {
        model: cfg.model.clone(),
        system: String::new(),
        messages: vec![Message { role: "user".into(), content: "ping".into() }],
        tools: vec![],
        cache_breakpoints: vec![],
    };
    p.stream(&req)
        .and_then(|it| it.take(1).collect::<anyhow::Result<Vec<_>>>())
        .map_err(|e| {
            anyhow::anyhow!(
                "preflight failed against {} (model {}): {e}\n\
                 The eval cannot measure anything without a reachable endpoint. \
                 Start a local OpenAI-compatible server, or fix [eval] in config.toml.",
                cfg.base_url, cfg.model,
            )
        })?;
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let repo = PathBuf::from(".").canonicalize()?;
    let suite_path = std::env::args().nth(1).expect("usage: eval <suite.json>");
    let suite: Suite = serde_json::from_slice(&std::fs::read(&suite_path)?)?;
    let cfg = EvalConfig::load()?;

    preflight(&cfg)?;

    let (a_id, a) = run_arm(&repo, &suite, "baseline", "./target/release/baseline", &cfg)?;
    let (b_id, b) = run_arm(&repo, &suite, "harness", "./target/release/mega-agent", &cfg)?;

    println!("suite {} — {} instances", &suite.hash[..12], suite.instances.len());
    for (name, r) in [("A/baseline", &a), ("B/harness", &b)] {
        println!("{name}");
        println!("  resolve_rate: {:.4} ({}/{})", r.resolve_rate(), r.resolved, r.attempted);
        println!("  {}", line("tokens_per_resolved", r.tokens_per_resolved()));
        println!("  {}", line("apply_success_rate", r.apply_success_rate()));
        println!("  {}", line("cache_read_ratio", r.cache_read_ratio()));
        println!("  ttft_ms p50/p95: {:?}/{:?}",
            percentile(&r.ttft_ms, 0.5), percentile(&r.ttft_ms, 0.95));
        println!("  tool_ms p50/p95: {:?}/{:?}",
            percentile(&r.tool_ms, 0.5), percentile(&r.tool_ms, 0.95));
    }
    match compare(&(a_id, a), &(b_id, b)) {
        Ok(d) => {
            println!("delta resolve_rate: {:+.4}", d.resolve_rate);
            println!("  {}", line("delta tokens_per_resolved", d.tokens_per_resolved));
        }
        // Printing a delta across mismatched arms would be worse than printing
        // nothing: it looks exactly like a result.
        Err(e) => println!("delta: refused — {e}"),
    }
    Ok(())
}
```

`run_arm` returns `(RunIdentity, ArmReport)` because the comparison must verify what a journal actually recorded rather than what config claimed. The identity travels **in the journal**, which is what makes a stored baseline comparable months later — the file carries its own provenance, so nothing has to be remembered about how it was produced.

- [ ] **Step 9: Run the null test**

```bash
cargo build --release -p mega-agent && cargo run -p mega-agent --bin eval -- crates/mega-agent/suites/self-*.json
```

**If preflight aborts, that is the expected outcome on a machine with no local model, and it is the mechanism working.** Start any OpenAI-compatible server and point `[eval] base_url` at it. Do not reach for a hosted API to get past this — `check_spend_lock` will refuse it without `--allow-remote-model`, and that refusal is operator confirmation §13/5 doing its job.

Once preflight passes: at this point `./target/release/mega-agent` does not exist, so Arm B scores 0 and the delta is negative. That is expected and is not a failure of the instrument — it is the instrument correctly reporting that Arm B has no agent. Record the Arm A numbers; they are the baseline every later phase is measured against.

Once Task 8 lands a `mega-agent` binary, re-run this command. The **Phase 0 exit criterion is `delta resolve_rate` ≈ 0 with both arms present** — see the note at the top of this plan.

- [ ] **Step 10: Commit**

```bash
git add crates/mega-agent/src/metrics.rs crates/mega-agent/src/bin/eval.rs crates/mega-agent/tests/metrics.rs crates/mega-agent/src/lib.rs crates/mega-agent/src/event.rs crates/mega-agent/config.example.toml
git commit -m "feat(agent): add two-arm eval driver and metrics"
```

---

# Phase 1 — The Kernel

> **Gate:** Tasks 1–6 must be green before starting Phase 1 — specifically the six sandbox-escape tests. The kernel is about to hand a language model a `write` tool; the box it writes into has to be proven shut first.

## Task 7: Anthropic wire format, the prompt-cache invariant, and config-first routing

Spec §6.2, §10.2. The cache invariant is enforced here, at the only place that constructs a request, because an invariant that lives in a convention is not an invariant.

**Files:**
- Create: `crates/mega-agent/src/provider/anthropic.rs`, `crates/mega-agent/src/history.rs`, `crates/mega-agent/src/config.rs`, `crates/mega-agent/config.example.toml`
- Modify: `crates/mega-agent/src/provider/mod.rs`, `crates/mega-agent/src/lib.rs`, `crates/mega-agent/Cargo.toml`

**Interfaces:**
- Consumes: `Transport`, `Provider`, `ChatRequest`, `Chunk`, `Message` (Task 5).
- Produces:
  - `mega_agent::history::History` — `new(system: String)`, `push(Message)`, `messages() -> &[Message]`, `generation() -> u32`, `rotate(summary: Message)`. **No indexed mutation exists on this type**; that absence is the §6.2.1 invariant.
  - `mega_agent::history::assert_prefix_stable(prev: &[Message], next: &[Message]) -> anyhow::Result<()>`.
  - `mega_agent::config::{Config, ModelRole}` — `Config::load(&Path)`, `Config::for_role(ModelRole) -> &ModelChoice`, `ModelChoice { provider, model, fallback: Vec<String> }`.
  - `Anthropic::new(transport, base_url, api_key)`.

- [ ] **Step 1: Write the failing tests for the invariant**

`crates/mega-agent/src/history.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::Message;

    fn msg(text: &str) -> Message {
        Message { role: "user".into(), content: serde_json::json!(text) }
    }

    #[test]
    fn appending_keeps_the_prefix_byte_identical() {
        let mut h = History::new("sys".into());
        h.push(msg("one"));
        let before = h.messages().to_vec();

        h.push(msg("two"));
        assert_prefix_stable(&before, h.messages()).expect("append-only");
    }

    #[test]
    fn a_changed_historical_message_is_detected() {
        let prev = vec![msg("one"), msg("two")];
        let next = vec![msg("one"), msg("EDITED"), msg("three")];
        assert!(
            assert_prefix_stable(&prev, &next).is_err(),
            "an in-place tool_result rewrite is the 0.96x defect and must be caught"
        );
    }

    #[test]
    fn rotation_starts_a_new_generation_instead_of_mutating() {
        let mut h = History::new("sys".into());
        h.push(msg("one"));
        h.push(msg("two"));
        assert_eq!(h.generation(), 0);

        h.rotate(msg("summary of one and two"));

        assert_eq!(h.generation(), 1, "compaction is a counted new prefix (§6.2.4)");
        assert_eq!(h.messages().len(), 1);
        assert_eq!(h.messages()[0].content, serde_json::json!("summary of one and two"));
    }

    #[test]
    fn breakpoints_are_capped_at_the_provider_limit() {
        assert!(cache_breakpoints_for(0).len() <= 4);
        assert!(cache_breakpoints_for(500).len() <= 4);
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p mega-agent --lib history
```

Expected: FAIL to compile — `cannot find type History`.

- [ ] **Step 3: Implement `History`**

```rust
use crate::provider::Message;

/// The prompt prefix is append-only within a generation (§6.2.1). This type
/// exposes no way to reach an existing element, which is the enforcement —
/// `syntheses/saver-cache-churn` measured the alternative at 0.96x.
pub struct History {
    system: String,
    messages: Vec<Message>,
    generation: u32,
}

impl History {
    pub fn new(system: String) -> Self {
        Self { system, messages: Vec::new(), generation: 0 }
    }

    pub fn system(&self) -> &str { &self.system }
    pub fn messages(&self) -> &[Message] { &self.messages }
    pub fn generation(&self) -> u32 { self.generation }

    pub fn push(&mut self, m: Message) { self.messages.push(m); }

    /// Compaction: replace the whole history with one summary message and count
    /// a new cache generation. Never a partial rewrite (§6.2.4, §6.3).
    pub fn rotate(&mut self, summary: Message) {
        self.messages = vec![summary];
        self.generation += 1;
    }
}

pub fn assert_prefix_stable(prev: &[Message], next: &[Message]) -> anyhow::Result<()> {
    if next.len() < prev.len() {
        anyhow::bail!("history shrank: {} -> {}", prev.len(), next.len());
    }
    for (i, old) in prev.iter().enumerate() {
        if old.content != next[i].content || old.role != next[i].role {
            anyhow::bail!("message {i} was rewritten in place");
        }
    }
    Ok(())
}

/// Coarse-to-fine, at stable boundaries only: system+tools, repo map, history.
/// Capped at 4 because that is the provider limit (§6.2.3).
pub fn cache_breakpoints_for(message_count: usize) -> Vec<usize> {
    let mut bps = Vec::new();
    if message_count > 0 {
        bps.push(0);
    }
    if message_count > 8 {
        bps.push(message_count / 2);
    }
    bps.truncate(4);
    bps
}
```

Add `pub mod history;` to `lib.rs`. `Message` already derives `Clone` (Task 5), which is all these tests need — the comparisons are on `serde_json::Value` and `String`, both of which have `PartialEq` already.

- [ ] **Step 4: Run to verify the tests pass**

```bash
cargo test -p mega-agent --lib history
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the Anthropic wire format**

`crates/mega-agent/src/provider/anthropic.rs`, using the same `StubTransport` shape as Task 5 (repeat it — the two test modules are independent and the executor may read them out of order):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{ChatRequest, Chunk, Message, Provider, Transport};
    use std::sync::Mutex;

    struct StubTransport {
        lines: Vec<String>,
        seen_body: Mutex<Option<String>>,
    }

    impl Transport for StubTransport {
        fn post_sse(&self, _url: &str, _headers: &[(String, String)], body: String)
            -> anyhow::Result<Box<dyn Iterator<Item = anyhow::Result<String>> + Send>> {
            *self.seen_body.lock().unwrap() = Some(body);
            let lines: Vec<anyhow::Result<String>> = self.lines.iter().cloned().map(Ok).collect();
            Ok(Box::new(lines.into_iter()))
        }
    }

    #[test]
    fn reports_cache_read_and_creation_separately() {
        let stub = StubTransport {
            lines: vec![
                r#"{"type":"message_start","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":900,"cache_creation_input_tokens":100}}}"#.into(),
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}"#.into(),
                r#"{"type":"message_delta","usage":{"output_tokens":7}}"#.into(),
            ],
            seen_body: Mutex::new(None),
        };
        let p = Anthropic::new(Box::new(stub), "http://stub".into(), "k".into());
        let chunks: Vec<Chunk> = p.stream(&req(vec![])).unwrap().map(Result::unwrap).collect();

        let usage = chunks.iter().find_map(|c| match c {
            Chunk::Usage { cache_read, cache_creation, .. } => Some((*cache_read, *cache_creation)),
            _ => None,
        });
        // cache_read_ratio is a gated metric (§4.2); collapsing these two into
        // one number is how the previous compression work hid its own defect.
        assert_eq!(usage, Some((900, 100)));
    }

    #[test]
    fn places_cache_control_only_at_requested_breakpoints() {
        let stub = StubTransport { lines: vec![], seen_body: Mutex::new(None) };
        let p = Anthropic::new(Box::new(stub), "http://stub".into(), "k".into());
        let _ = p.stream(&req(vec![0])).unwrap().count();

        let body: serde_json::Value =
            serde_json::from_str(&p.transport_body().expect("body captured")).unwrap();
        let marked = body["messages"].as_array().unwrap().iter()
            .filter(|m| m.pointer("/content/0/cache_control").is_some())
            .count();
        assert_eq!(marked, 1);
        assert!(body["system"][0]["cache_control"].is_object(), "system block is always cached");
    }

    fn req(bps: Vec<usize>) -> ChatRequest {
        ChatRequest {
            model: "stub".into(),
            system: "sys".into(),
            messages: vec![
                Message { role: "user".into(), content: serde_json::json!([{ "type": "text", "text": "a" }]) },
                Message { role: "assistant".into(), content: serde_json::json!([{ "type": "text", "text": "b" }]) },
            ],
            tools: vec![],
            cache_breakpoints: bps,
        }
    }
}
```

- [ ] **Step 6: Run to verify failure, then implement**

```bash
cargo test -p mega-agent --lib provider::anthropic
```

Expected: FAIL to compile. Then implement `Anthropic` in the same file: build `{ model, stream: true, system: [{type:"text", text, cache_control:{type:"ephemeral"}}], messages, tools }`, attaching `cache_control` to the last content block of each message whose index is in `cache_breakpoints`; assert `cache_breakpoints.len() <= 4` and return an error above it. Decode `message_start` → `Chunk::Usage` (reading `cache_read_input_tokens` and `cache_creation_input_tokens` distinctly), `content_block_delta`/`text_delta` → `Chunk::Text`, `content_block_start`/`tool_use` plus `input_json_delta` accumulation → `Chunk::ToolUse`, `message_stop` → `Chunk::Done`. Expose `transport_body()` for the test by storing the stub handle. Re-run until PASS.

- [ ] **Step 7: Config-first routing**

`crates/mega-agent/config.example.toml` — **the only place model ids appear** (§10.2):

```toml
[models.director]                     # decomposition, review, integration
provider = "anthropic"
model = "claude-opus-5"
fallback = ["anthropic/claude-sonnet-5"]

[models.worker]                       # implementation turns
provider = "anthropic"
model = "claude-sonnet-5"
fallback = ["openai-compat/deepseek-chat", "openai-compat/ollama:qwen2.5-coder"]

[models.fast]                         # diagnostics triage, summarization
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
```

`crates/mega-agent/src/config.rs` parses it with `toml` + `serde`. Write one test asserting that a config with an unknown `provider` value is a load-time error, not a runtime surprise, and one asserting `Config::load` on a file with no `[models.worker]` section fails with a message naming the missing role. Add `toml = "0.8"` to `[dependencies]`.

Fallback is attempted **only** on HTTP 429 and 5xx, bounded to the configured list, with no retry on a malformed response body — that path returns the error (`anti-patterns.md`: no silent retries).

- [ ] **Step 8: Verify and commit**

```bash
pnpm verify
```

```bash
git add crates/mega-agent/src/history.rs crates/mega-agent/src/config.rs crates/mega-agent/src/provider/anthropic.rs crates/mega-agent/config.example.toml crates/mega-agent/src/lib.rs crates/mega-agent/src/provider/mod.rs crates/mega-agent/Cargo.toml
git commit -m "feat(agent): enforce append-only prompt prefix"
```

---

## Task 8: Agent kernel, tool dispatch, budgets, and headless mode

Spec §3.2, §11.4, §12.1. This task produces the `mega-agent` binary, which is what makes Arm B real.

**Bash is deliberately absent from this task**, and for a different reason than in the previous revision of this plan. The sandbox already exists (Task 4) and this process is already inside it, so shell would be *safe* here — it is simply not needed yet. The kernel gets `read`, `grep`, `write`, and a *fixed* verify step whose command comes from the suite instance, not from the model. Model-controlled shell arrives in Task 10 alongside the fence that decides what it may touch, which keeps "can run any command" and "knows which paths are off limits" in the same commit and the same review.

**Files:**
- Create: `crates/mega-agent/src/kernel.rs`, `crates/mega-agent/src/tools/mod.rs`, `crates/mega-agent/src/main.rs`
- Modify: `crates/mega-agent/src/lib.rs`, `crates/mega-agent/Cargo.toml`

**Interfaces:**
- Consumes: `History`, `assert_prefix_stable`, `cache_breakpoints_for` (Task 7); `Provider`, `Chunk`, `ChatRequest`, `SupervisorProvider` (Task 5); `Event`, `Events` (Tasks 1 and 5); `Profile`, `SandboxMode`, `spawn_agent`, `serve` (Tasks 4 and 5).
- Produces:
  - `mega_agent::kernel::{Kernel, State, Budgets, Outcome}`.
  - `State` = `Idle | Plan | Act | Observe | Verify | Done`.
  - `Budgets { max_turns: u32, max_tokens: u64, max_tool_calls: u32 }`.
  - `Kernel::step(&mut self) -> anyhow::Result<State>` — one transition per call, which is what makes the transitions testable one at a time per §16.
  - Accessors used by the tests: `Kernel::state() -> State`, `Kernel::outcome() -> Option<Outcome>`, `Kernel::history() -> &History`.
  - Test constructors: `Kernel::for_test()`, `Kernel::for_test_with_calls(n: u32)`, `Kernel::for_test_with_budget(Budgets)`, and `Budgets::test()`.
  - `trait Tool { fn name(&self) -> &str; fn schema(&self) -> ToolSchema; fn call(&self, input: &serde_json::Value) -> String; }`.
  - No new `Event` variants: `ToolCall` and `Ttft` were declared in Task 5, and `Ttft` is emitted there too, by the supervisor.

`State` and `Outcome` derive `Debug, Clone, Copy, PartialEq` (`Outcome::Failed(String)` forces `Clone` instead of `Copy` — derive `Debug, Clone, PartialEq` there).
  - Binary `mega-agent` with `-p <prompt> --output-format json --events <path> --sandbox <mode>`.

- [ ] **Step 1: Write the failing state-machine tests — one per transition (§16)**

`crates/mega-agent/src/kernel.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_to_act_on_start() {
        let mut k = Kernel::for_test();
        assert_eq!(k.state(), State::Idle);
        assert_eq!(k.step().unwrap(), State::Act);
    }

    #[test]
    fn act_to_observe_when_the_model_calls_a_tool() {
        let mut k = Kernel::for_test_with_calls(1);
        k.step().unwrap();                                  // Idle -> Act
        assert_eq!(k.step().unwrap(), State::Observe);
    }

    #[test]
    fn act_to_verify_when_the_model_stops_calling_tools() {
        let mut k = Kernel::for_test_with_calls(0);
        k.step().unwrap();
        assert_eq!(k.step().unwrap(), State::Verify);
    }

    #[test]
    fn exceeding_the_turn_budget_stops_and_reports() {
        let mut k = Kernel::for_test_with_budget(Budgets { max_turns: 1, ..Budgets::test() });
        k.step().unwrap();
        k.step().unwrap();
        // §11.4: hitting a cap stops and reports; it never silently continues.
        assert_eq!(k.step().unwrap(), State::Done);
        assert_eq!(k.outcome(), Some(Outcome::BudgetExhausted));
    }

    #[test]
    fn every_turn_preserves_the_prefix() {
        let mut k = Kernel::for_test_with_calls(2);
        let mut prev = k.history().messages().to_vec();
        for _ in 0..6 {
            k.step().unwrap();
            crate::history::assert_prefix_stable(&prev, k.history().messages())
                .expect("kernel never rewrites history");
            prev = k.history().messages().to_vec();
        }
    }
}
```

The last test is the §6.2 invariant enforced against the component most likely to violate it. It is worth more than the four above it combined.

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p mega-agent --lib kernel
```

Expected: FAIL to compile — `cannot find type Kernel`.

- [ ] **Step 3: Implement the kernel**

Implement `State`, `Budgets` (with `Budgets::test()` and `Default` giving `max_turns: 50, max_tokens: 2_000_000, max_tool_calls: 200`), `Outcome` (`Resolved | Unresolved | BudgetExhausted | Failed(String)`), and `Kernel` holding `provider: Box<dyn Provider>`, `history: History`, `tools: Vec<Box<dyn Tool>>`, `budgets`, `events: Box<dyn Events>`, `state`, `turn`.

`events` is a `Box<dyn Events>`, never an `EventSink`. The kernel runs inside the
sandbox, where the journal is unreachable; in production both boxes are clones of
one `SupervisorProvider`, and in tests both are stubs. A kernel that opened a file
would compile, pass every unit test, and fail only under the real profile.

`step()` matches on the current state:
- `Idle` → `Act`. It emits no `RunStarted`: under the eval that line belongs to the driver, which wrote it before this process existed, and a second one would describe the instance rather than the run.
- `Act` → check budgets first (over → `Done` + `BudgetExhausted`); build `ChatRequest` with `cache_breakpoints_for(history.messages().len())`; drain the stream; push the assistant message; `Observe` if any tool call, else `Verify`. **No `Ttft` emit here.** The supervisor times the socket (Task 5); timing it here would add the pipe round-trip to a number defined as time-to-first-*token*, and would double the samples feeding `percentile`.
- `Observe` → dispatch each recorded call through `tools`, push each `tool_result` as a **new** message (never a rewrite), emit `Event::ToolCall { name, ms }` with the elapsed round-trip (§10.1: p50 < 50 ms for read/grep) — this one *is* the agent's, since the agent is where the tool ran, `Act`.
- `Verify` → run the fixed verify command, emit `TaskFinished`, `Done`.
- `Done` → `Done`.

`Kernel::for_test*` constructors inject a scripted provider that yields a configurable number of tool calls then stops — no network, per the Task 5 rule.

- [ ] **Step 4: Run to verify the tests pass**

```bash
cargo test -p mega-agent --lib kernel
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Implement the tools and the headless binary**

`crates/mega-agent/src/tools/mod.rs`: the `Tool` trait plus `Read`, `Grep`, `Write`. Each rejects a path that escapes the worktree root after canonicalization — that is a trust boundary, and `docs/conventions/code-conventions.md` requires validation at boundaries even though it is otherwise a "defensive check".

`crates/mega-agent/src/main.rs`:

It takes the same two-mode shape as Arm A, and for the same reason: the arms must
be launched identically or the delta measures the launch. Copy the structure from
`baseline.rs` — supervisor by default, `--agent` for the sandboxed child — with
one difference, the exit code, which the supervisor propagates from the child.

```rust
fn main() -> anyhow::Result<()> {
    // -p <prompt> --output-format json --events <path> --sandbox <mode>
    // Exit codes are part of the interface (§12.1) and are asserted by Step 6:
    //   0 resolved · 1 unresolved · 2 budget exhausted · 3 harness error
    if std::env::args().any(|a| a == "--agent") {
        let args = parse_args(std::env::args().skip(1))?;
        let sp = SupervisorProvider::from_stdio();
        Profile::compile(args.sandbox, &args.worktree, &[])?.enter()?;
        let outcome = run(args, Box::new(sp.clone()), Box::new(sp))?;
        std::process::exit(match outcome {
            Outcome::Resolved => 0,
            Outcome::Unresolved => 1,
            Outcome::BudgetExhausted => 2,
            Outcome::Failed(_) => 3,
        })
    }

    let args = parse_args(std::env::args().skip(1))?;
    let mut sink = EventSink::open(&args.events)?;
    let provider = OpenAiCompat::new(
        Box::new(HttpTransport::new()?),
        args.base_url.clone(),
        args.api_key.clone().unwrap_or_default(),
    );
    sink.emit(&Event::AgentStarted {
        endpoint: args.base_url.clone(), model: args.model.clone(),
    })?;

    let profile = Profile::compile(args.sandbox, &args.worktree, &[])?;
    let mut child = supervisor::spawn_agent(
        &std::env::current_exe()?,
        &forward_args(&args),
        &profile,
    )?;
    let rx = child.stdout.take().expect("spawn_agent pipes stdout");
    let tx = child.stdin.take().expect("spawn_agent pipes stdin");
    supervisor::serve(rx, tx, &provider, &mut sink)?;

    // Forward the child's code: the exit-code contract (§12.1) must survive the
    // split rather than being swallowed by the parent's own successful exit.
    std::process::exit(child.wait()?.code().unwrap_or(3))
}
```

`forward_args` rebuilds the flag list with `--agent` prepended; `spawn_agent`
appends `--worktree <path>` on top, so `parse_args` must **accept both**
`--agent` and `--worktree` even though the operator never types either. A parser
that rejects unknown flags will fail in the child only, after the supervisor has
already reported success — check this first if the child dies instantly.

`run(args, provider, events)` takes its provider and its event sink as
parameters rather than building them, which is also what lets Step 6's
integration test drive it with a stub.

- [ ] **Step 6: Write the headless-contract integration test**

`crates/mega-agent/tests/headless.rs` — assert the exit codes and that `--output-format json` emits one parseable JSON object on stdout. Drive it with a stubbed provider selected by an env var (`MEGA_AGENT_PROVIDER=stub`), so the test stays offline.

- [ ] **Step 7: Re-run the eval and record the null result**

```bash
cargo build --release -p mega-agent && cargo run -p mega-agent --bin eval -- crates/mega-agent/suites/self-*.json
```

Both arms now exist. **Expected: `delta resolve_rate` ≈ 0** — Arm B has the kernel but none of the accuracy levers. Store the output; it is the Phase 0 exit evidence and the baseline for Tasks 7–8.

A large positive delta here means the two arms are not comparable (different model, different turn cap, different prompt) — find the asymmetry before continuing. A large negative delta means the kernel is worse than a 200-line loop, which is a real finding and blocks Phase 2.

- [ ] **Step 8: Verify and commit**

```bash
pnpm verify
```

```bash
git add crates/mega-agent/src/kernel.rs crates/mega-agent/src/tools crates/mega-agent/src/main.rs crates/mega-agent/tests/headless.rs crates/mega-agent/src/lib.rs crates/mega-agent/src/event.rs crates/mega-agent/Cargo.toml
git commit -m "feat(agent): add kernel state machine and headless mode"
```

---

## Task 9: The edit-apply ladder

Spec §7. The largest single source of lost points in every harness, and the first lever with a number attached: `apply_success_rate` ≥ 98%.

**Files:**
- Create: `crates/mega-agent/src/tools/edit.rs`
- Modify: `crates/mega-agent/src/tools/mod.rs`, `crates/mega-agent/src/event.rs`

**Interfaces:**
- Consumes: `Tool` (Task 8), `Event::{EditApplied, EditRejected}` (Task 6).
- Produces: `mega_agent::tools::edit::{apply_edit, EditOutcome, Rung}`.
  `apply_edit(content: &str, search: &str, replace: &str) -> EditOutcome`.
  `enum EditOutcome { Applied { text: String, rung: Rung }, Rejected { reason: String } }`.
  `enum Rung { Exact, WhitespaceNormalized, AnchoredFuzzy }`.

- [ ] **Step 1: Write the failing tests — one per rung, plus the two rejections**

`crates/mega-agent/src/tools/edit.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn applied(o: EditOutcome) -> (String, Rung) {
        match o {
            EditOutcome::Applied { text, rung } => (text, rung),
            EditOutcome::Rejected { reason } => panic!("expected applied, got: {reason}"),
        }
    }

    #[test]
    fn rung_1_exact() {
        let (text, rung) = applied(apply_edit("let a = 1;\nlet b = 2;\n", "let a = 1;", "let a = 9;"));
        assert_eq!(text, "let a = 9;\nlet b = 2;\n");
        assert_eq!(rung, Rung::Exact);
    }

    #[test]
    fn rung_2_reindents_when_only_leading_whitespace_differs() {
        let file = "fn f() {\n        let a = 1;\n}\n";
        let (text, rung) = applied(apply_edit(file, "  let a = 1;", "  let a = 9;"));
        assert_eq!(rung, Rung::WhitespaceNormalized);
        assert_eq!(text, "fn f() {\n        let a = 9;\n}\n", "re-indented to the file's depth");
    }

    #[test]
    fn rung_3_anchors_on_a_unique_line() {
        let file = "// header\nconst token = readToken();\nconst x = 1;\n";
        let (_, rung) = applied(apply_edit(file, "const  token =  readToken()", "const token = readToken2()"));
        assert_eq!(rung, Rung::AnchoredFuzzy);
    }

    #[test]
    fn ambiguity_is_rejected_rather_than_guessed() {
        let file = "log(x);\nlog(x);\n";
        match apply_edit(file, "log(x);", "log(y);") {
            EditOutcome::Rejected { reason } => assert!(reason.contains("2 matches")),
            EditOutcome::Applied { .. } => panic!("a coin flip is not an edit"),
        }
    }

    #[test]
    fn rejection_returns_the_real_surrounding_content() {
        let file = "alpha\nbeta\ngamma\n";
        match apply_edit(file, "does not exist anywhere", "x") {
            EditOutcome::Rejected { reason } => {
                // §7.4: a failed edit that returns the current text is one
                // corrected turn; one that returns an error string is a
                // guessing loop.
                assert!(reason.contains("alpha") && reason.contains("gamma"));
            }
            EditOutcome::Applied { .. } => panic!("nothing should have matched"),
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

```bash
cargo test -p mega-agent --lib tools::edit
```

Expected: FAIL to compile — `cannot find function apply_edit`.

- [ ] **Step 3: Implement the ladder**

Stop at the first rung that hits:

1. **Exact** — `content.match_indices(search)`. Exactly one match applies; two or more reject with `"{n} matches"`; zero falls through.
2. **Whitespace-normalized** — compare `search` and each candidate window with leading/trailing whitespace stripped per line. On a unique hit, re-indent `replace` to the matched block's actual leading whitespace before writing.
3. **Anchored fuzzy** — take the longest non-blank line of `search` as the anchor. It must appear exactly once in the file; if it appears zero or ≥ 2 times, reject. Around that anchor, compare the block with all runs of whitespace collapsed; accept above a 0.9 similarity ratio.
4. **Reject**, returning: the reason, the count of near-matches, and the ±10 lines around the best candidate (or the first 40 lines if there is none).

`ponytail:` similarity is a normalized-token overlap ratio, not Levenshtein. Upgrade to edit distance only if the eval shows rung-3 misses — the metric is already wired to tell you.

- [ ] **Step 4: Run to verify the tests pass**

```bash
cargo test -p mega-agent --lib tools::edit
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the tool layer with its metric**

Register `edit` in `tools/mod.rs`. Every call emits exactly one `Event::EditApplied { path, rung }` or `Event::EditRejected { path, reason }` — Task 6's `read_journal` already counts both, so `apply_success_rate` starts reporting with no further work.

Both go through the kernel's `Box<dyn Events>` (Task 8), which in production is the supervisor pipe. The edit tool runs inside the sandbox, so it has no route to the journal file and must not try to open one.

The event's `rung` field is a `String` (Task 6 declared it that way), so give `Rung` a `Display` impl rendering `exact` / `whitespace_normalized` / `anchored_fuzzy` and emit `rung.to_string()`. Do not change the event field to the enum: `read_journal` parses journals written by older builds, and a type change there breaks stored baselines.

- [ ] **Step 6: Measure the lever**

```bash
cargo build --release -p mega-agent && cargo run -p mega-agent --bin eval -- crates/mega-agent/suites/self-*.json
```

Record `apply_success_rate` for Arm B. **DoD floor is 98%** (§4.2). Below it, the ladder is wrong — do not proceed to Task 10 with a failing floor, and do not raise the floor to meet the number.

- [ ] **Step 7: Commit**

```bash
git add crates/mega-agent/src/tools crates/mega-agent/src/event.rs
git commit -m "feat(agent): add edit-apply ladder with apply rate"
```

---

## Task 10: The fence daemon route, fence-compiled profiles, and the bash tool

Spec §11.2, §11.5, §16. Task 4 built the box; this task decides what goes in the deny list and puts model-controlled shell inside it.

**Files:**
- Create: `crates/mega-agent/src/daemon.rs`, `crates/mega-agent/src/tools/bash.rs`
- Create: `crates/mega-agent/tests/no_secret_leak.rs`
- Create: `packages/daemon/src/handlers-agent.ts`
- Modify: `packages/daemon/src/server.ts` (route dispatch), `packages/daemon/package.json` (add `@megasaver/fence` dependency), `crates/mega-agent/src/supervisor.rs`

**Interfaces:**
- Consumes: `Tool` (Task 8); `Profile::compile` (Task 4); `spawn_agent` (Task 4).
- Produces:
  - `mega_agent::daemon::DaemonClient` — `discover(store_root) -> anyhow::Result<DaemonClient>` (reads `daemon.json`, verifies `pid` is live before trusting the port, per `packages/daemon/src/client.ts:40`), `fence_check(&[String]) -> anyhow::Result<Vec<FenceVerdict>>`.
  - New daemon route `POST /agent/fence-check` → `{ verdicts: [{ path, verdict, entry? }] }`.
  - `mega_agent::supervisor::launch(store_root, worktree, exe, args)` — calls `fence_check`, folds the blocked paths into `Profile::compile`, then `spawn_agent`.

**Who calls the daemon, and when.** The **supervisor** does, once, at spawn time — before the agent child exists. The verdicts become the profile's deny list, the child enters that profile at startup, and no fence route is ever called from inside the sandbox. This is why the agent needs no network (§3.3) and why the fence costs nothing per turn.

- [ ] **Step 1: Add the daemon fence route (TypeScript, TDD)**

Write `packages/daemon/test/handlers-agent.test.ts` first: a request with a lockfile path returns `verdict: "block"`, a request with an ordinary source path returns `"allowed"`, and a request whose `paths` is not an array returns status 400. Then implement `packages/daemon/src/handlers-agent.ts` following the `handlers.ts` pattern exactly — a `.strict()` Zod schema at the boundary, returning `{ status, json }` — composing `loadFenceFile` + `compileFence` + `evaluateFenceWrite` from `@megasaver/fence`. Add the path to the POST allow-list in `packages/daemon/src/server.ts`.

```bash
pnpm --filter @megasaver/daemon test
```

- [ ] **Step 2: Write the failing launch test**

`crates/mega-agent/tests/fence_to_profile.rs`. The seam that matters is not the HTTP call — it is that a `block` verdict actually reaches the deny list. Test it with a stub client so the assertion is offline and deterministic:

```rust
use mega_agent::daemon::FenceVerdict;
use mega_agent::supervisor::deny_list_from;

#[test]
fn blocked_verdicts_become_the_profile_deny_list() {
    let verdicts = vec![
        FenceVerdict { path: "pnpm-lock.yaml".into(), verdict: "block".into() },
        FenceVerdict { path: "src/main.rs".into(), verdict: "allowed".into() },
    ];
    let deny = deny_list_from(&verdicts, std::path::Path::new("/w"));
    assert_eq!(deny, vec![std::path::PathBuf::from("/w/pnpm-lock.yaml")]);
}

#[test]
fn an_unknown_verdict_string_is_treated_as_blocked() {
    // Fail closed. A daemon that grows a third verdict name must not silently
    // widen what the agent may write while this crate is still on the old enum.
    let verdicts = vec![FenceVerdict { path: "x".into(), verdict: "quarantined".into() }];
    assert_eq!(deny_list_from(&verdicts, std::path::Path::new("/w")).len(), 1);
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cargo test -p mega-agent --test fence_to_profile
```

Expected: FAIL to compile — `unresolved import mega_agent::daemon`.

- [ ] **Step 4: Implement the client and the fold**

`crates/mega-agent/src/daemon.rs` — `DaemonClient::discover` reads `<store_root>/daemon/daemon.json`, checks the recorded `pid` is live before trusting the port (a stale record otherwise hands the bearer token to whatever process next grabbed that port), and holds the token in memory only (§11.5). `fence_check` POSTs to `/agent/fence-check` with `Authorization: Bearer <token>`.

In `supervisor.rs`:

```rust
/// Anything not explicitly `allowed` is denied. Fail closed: a verdict this
/// build does not recognise is a reason to withhold write access, not to grant it.
pub fn deny_list_from(verdicts: &[FenceVerdict], worktree: &Path) -> Vec<PathBuf> {
    verdicts
        .iter()
        .filter(|v| v.verdict != "allowed")
        .map(|v| worktree.join(&v.path))
        .collect()
}

pub fn launch(
    store_root: &Path,
    worktree: &Path,
    exe: &Path,
    args: &[String],
) -> anyhow::Result<std::process::Child> {
    let client = DaemonClient::discover(store_root)?;
    let verdicts = client.fence_check(&list_worktree_paths(worktree)?)?;
    let profile = Profile::compile(
        SandboxMode::WorkspaceWrite,
        worktree,
        &deny_list_from(&verdicts, worktree),
    )?;
    Ok(spawn_agent(exe, args, &profile)?)
}
```

- [ ] **Step 5: Run to verify pass**

```bash
cargo test -p mega-agent --test fence_to_profile
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Add the bash tool**

`crates/mega-agent/src/tools/bash.rs` — a `Tool` that runs `sh -c <cmd>` in the worktree with a timeout. It does **not** wrap anything in a sandbox: the agent process is already inside one (Task 4), and children inherit it. That is the whole point of the process-level design — a bash tool with no sandbox code in it cannot have a sandbox bug in it.

The tool-level fence check stays as a fast, friendly rejection with a good error message, using the deny list the supervisor already computed and passed in at spawn. It is a UX affordance, not the enforcement; the kernel is the enforcement.

- [ ] **Step 7: Write the secret-leak test (§11.5)**

`crates/mega-agent/tests/no_secret_leak.rs`. The constraint is stated in three places in the spec and enforced nowhere until this test exists:

```rust
#[test]
fn no_secret_reaches_the_event_journal_or_argv() {
    const CANARY: &str = "sk-canary-do-not-log-4f2b9c";

    let dir = tempfile::tempdir().unwrap();
    let events = dir.path().join("ev.ndjson");

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_mega-agent"))
        .current_dir(dir.path())
        .env("MEGA_AGENT_PROVIDER", "stub")
        .env("MEGA_AGENT_API_KEY", CANARY)
        .env("MEGA_AGENT_EVENTS", &events)
        .args(["-p", "do nothing", "--output-format", "json"])
        .output()
        .expect("harness runs");

    let journal = std::fs::read_to_string(&events).unwrap_or_default();
    assert!(!journal.contains(CANARY), "api key reached the event journal");
    assert!(!String::from_utf8_lossy(&status.stdout).contains(CANARY), "api key reached stdout");
    assert!(!String::from_utf8_lossy(&status.stderr).contains(CANARY), "api key reached stderr");
}
```

Extend it with the same canary for the daemon bearer token once `DaemonClient` is wired: write a fake `daemon.json` with a canary token into a scratch store root, point the harness at it, and assert the token appears in neither the journal nor either output stream.

`argv` is covered by construction rather than by assertion — every secret in this plan arrives through the environment, and no step passes one as an argument. If a later phase adds a `--api-key` flag, this test does not catch it; reject the flag in review.

- [ ] **Step 8: Verify and commit**

```bash
pnpm verify
```

```bash
git add crates/mega-agent/src/daemon.rs crates/mega-agent/src/supervisor.rs crates/mega-agent/src/tools/bash.rs crates/mega-agent/tests/fence_to_profile.rs crates/mega-agent/tests/no_secret_leak.rs packages/daemon/src packages/daemon/test packages/daemon/package.json
git commit -m "feat(agent): compile fence verdicts into the sandbox profile"
```

- [ ] **Step 9: Add a changeset**

`packages/daemon` gained a public route, so per `docs/conventions/definition-of-done.md` item 9:

```bash
pnpm changeset
```

Select `@megasaver/daemon`, minor, describing the `/agent/fence-check` route.

---

# Phase 1 exit — what must be true

Per spec §16. Do not claim Phase 1 complete before all of these hold:

- [ ] `pnpm verify` green, Rust tasks included.
- [ ] `cargo test --workspace` green, including all six sandbox-escape tests (with their positive controls), the four RPC frame tests, the secret-leak test, and the five edit-ladder tests.
- [ ] Eval run stored, both arms present, `apply_success_rate` ≥ 98%, `cache_read_ratio` not regressed vs. the Task 8 Step 7 baseline.
- [ ] Eval journal's two arms agree on `endpoint`, `model`, and `suite_hash` (§4.4) — a delta computed across a mismatch is not evidence.
- [ ] The §3.3 supervisor/agent trust boundary reviewed by `architect` and `security-reviewer` — it is a new privilege split and the supervisor is on the privileged side of it. (The §11.1 loopback carve-out that used to sit here is gone: it was resolved 2026-08-19 by removing it, not by pinning a port.)
- [ ] `architect`, `critic`, `security-reviewer`, `verifier` passes and the `tracer` evidence loop — author and reviewer never the same context.
- [ ] `wiki/index.md`, `entities/mega-agent`, and `wiki/log.md` updated.

Spec §13 items 1–7 were confirmed by the operator on 2026-08-19, and item 6 was executed the same day: `docs/conventions/mission.md` gained a "First-party agent" section and `pnpm conventions:sync --write` regenerated `CLAUDE.md`, `AGENTS.md`, and `.cursor/rules/mega-context.mdc`. Nothing on this checklist is waiting on an operator decision.

# Not in this plan

Spec §17 Phases 2–4, each to be planned separately once the eval loop can price them: diagnostics feedback (§8), repo map, compaction (§6.3), checkpoints (§11.3), failed-attempt recall (§6.5), the TUI (§10.3), the mesh client and integration queue (§5), `--candidates N --select-by verify` (§9), MCP client / hooks / skills (§12.3), and session persistence, resume, and fork (§12.2 — which consumes the existing `2026-08-11-conversation-fork-time-travel-design.md` rather than inventing a parallel mechanism).
