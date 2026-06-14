# Claude Code Live Sessions Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only GUI view that lists Claude Code desktop sessions from `~/.claude/projects` (most-recent first) and live-streams the selected transcript via SSE.

**Architecture:** A new bridge module (`apps/gui/bridge/claude-sessions/`) reads + normalizes the on-disk JSONL transcripts; three bridge routes expose list / snapshot / live-stream; a new GUI view renders a two-pane list+transcript and consumes the stream over `EventSource`. Strictly read-only — no writes to `~/.claude/projects` and no mutation of the MegaSaver store.

**Tech Stack:** TypeScript (strict, ESM, NodeNext — import with `.js` extensions), node `http` + `fs/promises` + `fs.watchFile`, Vitest, React 18, Tailwind. Spec: `docs/superpowers/specs/2026-06-14-claude-code-live-sessions-viewer-design.md`.

**Risk (§12):** HIGH — reads user files at scale. Read-only mitigates data-loss, but path-traversal validation is security-critical. Required reviewers: `code-reviewer` AND `critic`; execute in a git worktree.

**Scope refinements vs spec (locked here):**
- Only `user` and `assistant` turn lines are rendered. `system` lines are skipped (shape not reliably verified) along with `attachment` / `queue-operation` / `last-prompt`.
- Live tail uses `fs.watchFile` (polling, deterministic cross-platform) with a size-delta read, which satisfies the spec's "re-read from last offset" robustness note.

---

## File Structure

**Create (bridge):**
- `apps/gui/bridge/claude-sessions/types.ts` — shared types (`Block`, `NormalizedMessage`, `ClaudeSessionMeta`, `ClaudeTranscript`).
- `apps/gui/bridge/claude-sessions/parse.ts` — pure `normalizeLine(raw) → NormalizedMessage | null`.
- `apps/gui/bridge/claude-sessions/reader.ts` — `safeSessionPath`, `listSessions`, `readTranscript`, `tailTranscript`.
- `apps/gui/bridge/routes/claude-sessions.ts` — `handleListClaudeSessions`, `handleGetClaudeSession`, `handleStreamClaudeSession`.

**Modify (bridge):**
- `apps/gui/bridge/route-context.ts` — add `claudeProjectsDir: string`.
- `apps/gui/bridge/handler.ts` — resolve `claudeProjectsDir`, add to ctx, dispatch the new routes.

**Modify (error codes):**
- `apps/gui/src/bridge-error-code.ts` — add `claude_session_not_found` + copy.
- `apps/gui/test/bridge-error-code.test-d.ts` — update pinned tuple + union.

**Create (GUI):**
- `apps/gui/src/lib/claude-sessions-client.ts` — fetch + `EventSource` wrappers.
- `apps/gui/src/views/claude-sessions-view.tsx` — two-pane view.

**Modify (GUI):**
- `apps/gui/src/view-id.ts` — add `claude-sessions` to `VIEW_IDS` + `VIEW_LABELS` (NOT project-scoped).
- `apps/gui/test/view-id.test-d.ts` — update pinned tuple + union.
- `apps/gui/src/app.tsx` — render branch (global, like `agent-setup`) + nav group.

**Create (tests):**
- `apps/gui/test/bridge/claude-sessions-parse.test.ts`
- `apps/gui/test/bridge/claude-sessions-reader.test.ts`
- `apps/gui/test/bridge/claude-sessions-route.test.ts`

**Modify (tests):**
- `apps/gui/test/bridge/test-helpers.ts` — allow `claudeProjectsDir` injection.

**Create (changeset):**
- `.changeset/claude-code-live-sessions.md`

---

## Task 1: Add `claude_session_not_found` error code

**Files:**
- Modify: `apps/gui/src/bridge-error-code.ts:4-21` and `:25-42`
- Modify (test): `apps/gui/test/bridge-error-code.test-d.ts`

- [ ] **Step 1: Update the type-pin test first (RED)**

In `apps/gui/test/bridge-error-code.test-d.ts`, insert `"claude_session_not_found"` as the FIRST tuple member (alphabetic: `c` < `e`) in BOTH the tuple block and the union block. The tuple block becomes:

```ts
expectTypeOf<typeof BRIDGE_ERROR_CODES>().toEqualTypeOf<
  readonly [
    "claude_session_not_found",
    "event_not_found",
    "index_unavailable",
    "internal_error",
    "mcp_setup_failed",
    "memory_entry_not_found",
    "method_not_allowed",
    "origin_forbidden",
    "project_not_found",
    "rootpath_invalid",
    "route_not_found",
    "session_already_ended",
    "session_not_found",
    "session_project_mismatch",
    "store_write_failed",
    "validation_failed",
  ]
>();
```

And the union block gains `| "claude_session_not_found"` as the first member.

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: FAIL — the test tuple no longer matches `BRIDGE_ERROR_CODES`.

- [ ] **Step 3: Add the code + copy (GREEN)**

In `apps/gui/src/bridge-error-code.ts`, add `"claude_session_not_found"` as the first entry of `BRIDGE_ERROR_CODES`:

```ts
export const BRIDGE_ERROR_CODES = [
  "claude_session_not_found",
  "event_not_found",
  ...
```

And add to `BRIDGE_ERROR_COPY` (keep alphabetic):

```ts
  claude_session_not_found: "Claude Code session not found. It may have been removed.",
  event_not_found: "Event not found, or it has no stored output.",
```

- [ ] **Step 4: Run typecheck to verify it passes**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/bridge-error-code.ts apps/gui/test/bridge-error-code.test-d.ts
git commit -m "feat(gui): add claude_session_not_found bridge error code"
```

---

## Task 2: Types + parser (`parse.ts`)

**Files:**
- Create: `apps/gui/bridge/claude-sessions/types.ts`
- Create: `apps/gui/bridge/claude-sessions/parse.ts`
- Test: `apps/gui/test/bridge/claude-sessions-parse.test.ts`

- [ ] **Step 1: Write the types file**

`apps/gui/bridge/claude-sessions/types.ts`:

```ts
export type BlockKind = "text" | "thinking" | "tool_use" | "tool_result";

export type Block = { kind: BlockKind; text: string };

export type NormalizedMessage = {
  role: "user" | "assistant";
  ts: string;
  blocks: Block[];
};

export type ClaudeSessionMeta = {
  dir: string;
  id: string;
  mtimeMs: number;
  size: number;
  title: string;
  projectLabel: string;
};

export type ClaudeTranscript = {
  dir: string;
  id: string;
  projectLabel: string;
  byteLength: number;
  messages: NormalizedMessage[];
};
```

- [ ] **Step 2: Write the failing parser test (RED)**

`apps/gui/test/bridge/claude-sessions-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeLine } from "../../bridge/claude-sessions/parse.js";

describe("normalizeLine", () => {
  it("normalizes a user string line", () => {
    const msg = normalizeLine({
      type: "user",
      timestamp: "2026-06-14T10:00:00.000Z",
      message: { role: "user", content: "hello there" },
    });
    expect(msg).toEqual({
      role: "user",
      ts: "2026-06-14T10:00:00.000Z",
      blocks: [{ kind: "text", text: "hello there" }],
    });
  });

  it("normalizes an assistant line with thinking, text and tool_use blocks", () => {
    const msg = normalizeLine({
      type: "assistant",
      timestamp: "2026-06-14T10:00:01.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think", signature: "x" },
          { type: "text", text: "the answer" },
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
        ],
      },
    });
    expect(msg?.role).toBe("assistant");
    expect(msg?.blocks).toEqual([
      { kind: "thinking", text: "let me think" },
      { kind: "text", text: "the answer" },
      { kind: "tool_use", text: 'Bash({"command":"ls"})' },
    ]);
  });

  it("returns null for attachment, queue-operation, last-prompt, system lines", () => {
    expect(normalizeLine({ type: "attachment" })).toBeNull();
    expect(normalizeLine({ type: "queue-operation" })).toBeNull();
    expect(normalizeLine({ type: "last-prompt", lastPrompt: "x" })).toBeNull();
    expect(normalizeLine({ type: "system", content: "x" })).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(normalizeLine(null)).toBeNull();
    expect(normalizeLine("nope")).toBeNull();
    expect(normalizeLine({ noType: true })).toBeNull();
    expect(normalizeLine({ type: "user" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-parse`
Expected: FAIL — `Cannot find module .../parse.js`.

- [ ] **Step 4: Write the parser (GREEN)**

`apps/gui/bridge/claude-sessions/parse.ts`:

```ts
import type { Block, BlockKind, NormalizedMessage } from "./types.js";

const TOOL_INPUT_MAX = 2000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function blocksFromContent(content: unknown): Block[] {
  if (typeof content === "string") {
    return content.length > 0 ? [{ kind: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: Block[] = [];
  for (const raw of content) {
    if (!isObject(raw)) continue;
    const type = raw.type;
    if (type === "text" && typeof raw.text === "string") {
      blocks.push({ kind: "text", text: raw.text });
    } else if (type === "thinking" && typeof raw.thinking === "string") {
      blocks.push({ kind: "thinking", text: raw.thinking });
    } else if (type === "tool_use") {
      const name = typeof raw.name === "string" ? raw.name : "tool";
      const input = JSON.stringify(raw.input ?? {}).slice(0, TOOL_INPUT_MAX);
      blocks.push({ kind: "tool_use", text: `${name}(${input})` });
    } else if (type === "tool_result") {
      const text = typeof raw.content === "string" ? raw.content : JSON.stringify(raw.content ?? "");
      blocks.push({ kind: "tool_result", text: text.slice(0, TOOL_INPUT_MAX) });
    }
  }
  return blocks;
}

// Raw (already JSON-parsed) transcript line → normalized message, or null when
// the line is not a renderable turn (attachment / queue-operation / last-prompt
// / system / malformed). Only user + assistant turns are surfaced.
export function normalizeLine(raw: unknown): NormalizedMessage | null {
  if (!isObject(raw)) return null;
  const type = raw.type;
  if (type !== "user" && type !== "assistant") return null;
  const message = raw.message;
  if (!isObject(message)) return null;
  const blocks = blocksFromContent(message.content);
  if (blocks.length === 0) return null;
  const ts = typeof raw.timestamp === "string" ? raw.timestamp : "";
  const role: NormalizedMessage["role"] = type;
  return { role, ts, blocks } satisfies NormalizedMessage;
}

export type { Block, BlockKind, NormalizedMessage };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-parse`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/gui/bridge/claude-sessions/types.ts apps/gui/bridge/claude-sessions/parse.ts apps/gui/test/bridge/claude-sessions-parse.test.ts
git commit -m "feat(gui): claude-session transcript line normalizer"
```

---

## Task 3: Reader — path safety + list + snapshot

**Files:**
- Create: `apps/gui/bridge/claude-sessions/reader.ts`
- Test: `apps/gui/test/bridge/claude-sessions-reader.test.ts`

- [ ] **Step 1: Write the failing reader test (RED)**

`apps/gui/test/bridge/claude-sessions-reader.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listSessions,
  readTranscript,
  safeSessionPath,
} from "../../bridge/claude-sessions/reader.js";

const DIR = "-Users-me-proj";

function userLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "user", content: text },
  });
}
function asstLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("claude-sessions reader", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "cc-projects-"));
    mkdirSync(join(root, DIR), { recursive: true });
    const a = join(root, DIR, "aaaa.jsonl");
    const b = join(root, DIR, "bbbb.jsonl");
    writeFileSync(a, `${userLine("first prompt", "2026-06-14T10:00:00.000Z")}\n`);
    writeFileSync(
      b,
      `${userLine("second prompt", "2026-06-14T11:00:00.000Z")}\n${asstLine("hi", "2026-06-14T11:00:01.000Z")}\n`,
    );
    // Make `bbbb` newer so it sorts first.
    utimesSync(a, new Date("2026-06-14T10:00:00Z"), new Date("2026-06-14T10:00:00Z"));
    utimesSync(b, new Date("2026-06-14T11:00:00Z"), new Date("2026-06-14T11:00:00Z"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists sessions most-recent first with title + projectLabel", async () => {
    const sessions = await listSessions(root, { limit: 50, offset: 0 });
    expect(sessions.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
    expect(sessions[0]?.title).toBe("second prompt");
    expect(sessions[0]?.projectLabel).toBe("/Users/me/proj");
  });

  it("paginates with limit + offset", async () => {
    const page = await listSessions(root, { limit: 1, offset: 1 });
    expect(page.map((s) => s.id)).toEqual(["aaaa"]);
  });

  it("returns [] when the root does not exist", async () => {
    const missing = await listSessions(join(root, "nope"), { limit: 50, offset: 0 });
    expect(missing).toEqual([]);
  });

  it("reads a transcript into normalized messages with byteLength", async () => {
    const t = await readTranscript(root, DIR, "bbbb");
    expect(t?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t?.projectLabel).toBe("/Users/me/proj");
    expect(t?.byteLength).toBeGreaterThan(0);
  });

  it("returns null for an unknown session id", async () => {
    expect(await readTranscript(root, DIR, "zzzz")).toBeNull();
  });

  it("rejects path traversal in safeSessionPath", () => {
    expect(safeSessionPath(root, "..", "aaaa")).toBeNull();
    expect(safeSessionPath(root, DIR, "../../etc/passwd")).toBeNull();
    expect(safeSessionPath(root, "a/b", "aaaa")).toBeNull();
    expect(safeSessionPath(root, DIR, "aaaa")).toBe(join(root, DIR, "aaaa.jsonl"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-reader`
Expected: FAIL — `Cannot find module .../reader.js`.

- [ ] **Step 3: Write the reader (GREEN)**

`apps/gui/bridge/claude-sessions/reader.ts`:

```ts
import { watchFile, unwatchFile } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { normalizeLine } from "./parse.js";
import type { ClaudeSessionMeta, ClaudeTranscript, NormalizedMessage } from "./types.js";

const META_SCAN_BYTES = 64 * 1024;

function isSafeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value !== "." &&
    value !== ".."
  );
}

// Resolve <root>/<dir>/<id>.jsonl, rejecting any traversal. Returns null when
// `dir`/`id` are unsafe or escape the projects root. Security-critical: both
// segments arrive from the URL.
export function safeSessionPath(root: string, dir: string, id: string): string | null {
  if (!isSafeSegment(dir) || !isSafeSegment(id)) return null;
  const base = resolve(root);
  const candidate = resolve(base, dir, `${id}.jsonl`);
  if (candidate !== join(base, dir, `${id}.jsonl`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  return candidate;
}

function parseLines(text: string): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = normalizeLine(raw);
    if (msg) messages.push(msg);
  }
  return messages;
}

function deriveMeta(chunk: string): { title: string; projectLabel: string } {
  let title = "";
  let projectLabel = "";
  for (const line of chunk.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      if (!projectLabel && typeof obj.cwd === "string") projectLabel = obj.cwd;
      if (!title) {
        const msg = normalizeLine(raw);
        if (msg?.role === "user") {
          title = msg.blocks.map((b) => b.text).join(" ").slice(0, 120);
        }
      }
    }
    if (title && projectLabel) break;
  }
  return { title, projectLabel };
}

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function listSessions(
  root: string,
  opts: { limit: number; offset: number },
): Promise<ClaudeSessionMeta[]> {
  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  const files: { dir: string; id: string; path: string }[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      files.push({ dir, id: entry.slice(0, -".jsonl".length), path: join(root, dir, entry) });
    }
  }
  const stated = await Promise.all(
    files.map(async (f) => {
      try {
        const s = await stat(f.path);
        return { ...f, mtimeMs: s.mtimeMs, size: s.size };
      } catch {
        return null;
      }
    }),
  );
  const sorted = stated
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(opts.offset, opts.offset + opts.limit);

  return Promise.all(
    sorted.map(async (s) => {
      const head = await readHead(s.path, META_SCAN_BYTES).catch(() => "");
      const { title, projectLabel } = deriveMeta(head);
      return {
        dir: s.dir,
        id: s.id,
        mtimeMs: s.mtimeMs,
        size: s.size,
        title,
        projectLabel,
      } satisfies ClaudeSessionMeta;
    }),
  );
}

export async function readTranscript(
  root: string,
  dir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const path = safeSessionPath(root, dir, id);
  if (!path) return null;
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const messages = parseLines(text);
  const projectLabel = deriveMeta(text.slice(0, META_SCAN_BYTES)).projectLabel;
  return {
    dir,
    id,
    projectLabel,
    byteLength: Buffer.byteLength(text, "utf8"),
    messages,
  } satisfies ClaudeTranscript;
}
```

Note: `tailTranscript` is added in Task 4 — leave it out for now (the imports `watchFile`/`unwatchFile` are unused until then; if biome flags them, add them in Task 4 instead). To keep this task lint-clean, drop the `watchFile, unwatchFile` import line for now and re-add it in Task 4.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-reader`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/claude-sessions/reader.ts apps/gui/test/bridge/claude-sessions-reader.test.ts
git commit -m "feat(gui): claude-session reader — list, snapshot, path safety"
```

---

## Task 4: Reader — live tail

**Files:**
- Modify: `apps/gui/bridge/claude-sessions/reader.ts`
- Test: `apps/gui/test/bridge/claude-sessions-reader.test.ts` (append a test)

- [ ] **Step 1: Add the failing tail test (RED)**

Append to `apps/gui/test/bridge/claude-sessions-reader.test.ts` (inside the `describe`), and add `appendFileSync` to the `node:fs` import at the top:

```ts
  it("tails appended lines via tailTranscript", async () => {
    const path = join(root, DIR, "bbbb.jsonl");
    const t = await readTranscript(root, DIR, "bbbb");
    const received: string[] = [];
    const stop = tailTranscript(path, t?.byteLength ?? 0, (m) => {
      received.push(m.blocks.map((b) => b.text).join(""));
    });
    appendFileSync(path, `${asstLine("a fresh reply", "2026-06-14T11:05:00.000Z")}\n`);
    await new Promise((r) => setTimeout(r, 700));
    stop();
    expect(received).toContain("a fresh reply");
  });
```

Add `tailTranscript` to the import from `reader.js` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-reader`
Expected: FAIL — `tailTranscript is not a function`.

- [ ] **Step 3: Implement `tailTranscript` (GREEN)**

Re-add the import at the top of `reader.ts`:

```ts
import { unwatchFile, watchFile } from "node:fs";
```

Append to `apps/gui/bridge/claude-sessions/reader.ts`:

```ts
// Poll the file for growth (watchFile is deterministic across platforms) and
// emit each newly appended renderable turn. A trailing partial line is buffered
// and retried on the next tick. Returns a disposer.
export function tailTranscript(
  path: string,
  startOffset: number,
  onMessage: (message: NormalizedMessage) => void,
): () => void {
  let offset = startOffset;
  let buffer = "";
  let reading = false;

  async function drain(): Promise<void> {
    if (reading) return;
    reading = true;
    try {
      const s = await stat(path);
      if (s.size <= offset) return;
      const handle = await open(path, "r");
      try {
        const len = s.size - offset;
        const buf = Buffer.alloc(len);
        await handle.read(buf, 0, len, offset);
        offset = s.size;
        buffer += buf.toString("utf8");
      } finally {
        await handle.close();
      }
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length > 0) {
          try {
            const msg = normalizeLine(JSON.parse(line));
            if (msg) onMessage(msg);
          } catch {
            // Incomplete/corrupt line — skip; later writes re-emit complete data.
          }
        }
        nl = buffer.indexOf("\n");
      }
    } catch {
      // File vanished or unreadable — stop emitting; disposer still cleans up.
    } finally {
      reading = false;
    }
  }

  const listener = (): void => {
    void drain();
  };
  watchFile(path, { interval: 250 }, listener);
  void drain();

  return () => {
    unwatchFile(path, listener);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-reader`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/claude-sessions/reader.ts apps/gui/test/bridge/claude-sessions-reader.test.ts
git commit -m "feat(gui): claude-session live tail via watchFile"
```

---

## Task 5: Wire `claudeProjectsDir` into the bridge context

**Files:**
- Modify: `apps/gui/bridge/route-context.ts` (RouteContext type)
- Modify: `apps/gui/bridge/handler.ts:28-40` (options) and `:105-162` (resolve + ctx)
- Modify: `apps/gui/test/bridge/test-helpers.ts:51-73`

- [ ] **Step 1: Add `claudeProjectsDir` to RouteContext**

In `apps/gui/bridge/route-context.ts`, inside the `RouteContext` type, after `storeRoot: string;` add:

```ts
  // Absolute path to ~/.claude/projects (overridable in tests). Read-only source
  // for the Claude Code live-sessions routes.
  claudeProjectsDir: string;
```

- [ ] **Step 2: Resolve it in the handler**

In `apps/gui/bridge/handler.ts`, add imports at the top:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
```

Add to `BridgeHandlerOptions` (after `mcpOps?`):

```ts
  /** Override for tests; defaults to ~/.claude/projects. */
  claudeProjectsDir?: string;
```

Inside `createBridgeHandler`, after `const storePath = opts.storePath ?? "";` add:

```ts
  const claudeProjectsDir = opts.claudeProjectsDir ?? join(homedir(), ".claude", "projects");
```

In the `ctx` object literal (after `storeRoot: storePath,`) add:

```ts
      claudeProjectsDir,
```

- [ ] **Step 3: Allow injection in the test helper**

In `apps/gui/test/bridge/test-helpers.ts`, add `claudeProjectsDir?: string` to the `startTestBridge` seed param type, and pass it through:

```ts
export async function startTestBridge(seed?: {
  projects?: Project[];
  sessions?: Session[];
  memoryEntries?: MemoryEntry[];
  store?: StoreSeed;
  claudeProjectsDir?: string;
}): Promise<TestServer> {
```

and change the handler construction:

```ts
  const handler = createBridgeHandler({
    registry,
    storePath,
    ...(seed?.claudeProjectsDir ? { claudeProjectsDir: seed.claudeProjectsDir } : {}),
  });
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: PASS (no behavior change yet; routes added next).

- [ ] **Step 5: Commit**

```bash
git add apps/gui/bridge/route-context.ts apps/gui/bridge/handler.ts apps/gui/test/bridge/test-helpers.ts
git commit -m "feat(gui): thread claudeProjectsDir through bridge context"
```

---

## Task 6: Routes — list + snapshot

**Files:**
- Create: `apps/gui/bridge/routes/claude-sessions.ts`
- Modify: `apps/gui/bridge/handler.ts` (import + dispatch)
- Test: `apps/gui/test/bridge/claude-sessions-route.test.ts`

- [ ] **Step 1: Write the failing route test (RED)**

`apps/gui/test/bridge/claude-sessions-route.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestBridge, type TestServer } from "./test-helpers.js";

const DIR = "-Users-me-proj";

function userLine(text: string, ts: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: ts,
    cwd: "/Users/me/proj",
    message: { role: "user", content: text },
  });
}

describe("claude-sessions routes", () => {
  let server: TestServer;
  let ccRoot: string;

  beforeEach(async () => {
    ccRoot = mkdtempSync(join(tmpdir(), "cc-route-"));
    mkdirSync(join(ccRoot, DIR), { recursive: true });
    const a = join(ccRoot, DIR, "aaaa.jsonl");
    const b = join(ccRoot, DIR, "bbbb.jsonl");
    writeFileSync(a, `${userLine("older", "2026-06-14T10:00:00.000Z")}\n`);
    writeFileSync(b, `${userLine("newer", "2026-06-14T11:00:00.000Z")}\n`);
    utimesSync(a, new Date("2026-06-14T10:00:00Z"), new Date("2026-06-14T10:00:00Z"));
    utimesSync(b, new Date("2026-06-14T11:00:00Z"), new Date("2026-06-14T11:00:00Z"));
    server = await startTestBridge({ claudeProjectsDir: ccRoot });
  });

  afterEach(async () => {
    if (server) await server.close();
    rmSync(ccRoot, { recursive: true, force: true });
  });

  it("GET /api/claude-sessions lists most-recent first", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body.map((s) => s.id)).toEqual(["bbbb", "aaaa"]);
  });

  it("GET /api/claude-sessions?limit=1 paginates", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions?limit=1`);
    const body = (await res.json()) as { id: string }[];
    expect(body).toHaveLength(1);
    expect(body[0]?.id).toBe("bbbb");
  });

  it("GET /api/claude-sessions/:dir/:id returns a transcript", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/bbbb`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: { role: string }[]; projectLabel: string };
    expect(body.messages[0]?.role).toBe("user");
    expect(body.projectLabel).toBe("/Users/me/proj");
  });

  it("GET unknown session → 404 claude_session_not_found", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/zzzz`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("claude_session_not_found");
  });

  it("GET with path traversal → 400 validation_failed", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/${encodeURIComponent("../../x")}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("validation_failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-route`
Expected: FAIL — routes return 404 `route_not_found`.

- [ ] **Step 3: Write the list + snapshot handlers (GREEN)**

`apps/gui/bridge/routes/claude-sessions.ts`:

```ts
import { handleCaughtError } from "../error-mapping.js";
import type { RouteContext } from "../route-context.js";
import {
  listSessions,
  readTranscript,
  safeSessionPath,
} from "../claude-sessions/reader.js";
import { intParam } from "./_query.js";

export async function handleListClaudeSessions(ctx: RouteContext): Promise<void> {
  try {
    const offset = intParam(ctx.query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = intParam(ctx.query.get("limit"), 50, 1, 200);
    const sessions = await listSessions(ctx.claudeProjectsDir, { limit, offset });
    ctx.sendJson(ctx.res, 200, sessions, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}

export async function handleGetClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  if (safeSessionPath(ctx.claudeProjectsDir, dir, id) === null) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
    return;
  }
  try {
    const transcript = await readTranscript(ctx.claudeProjectsDir, dir, id);
    if (!transcript) {
      ctx.sendError(
        ctx.res,
        404,
        "claude_session_not_found",
        `Claude Code session not found: ${dir}/${id}`,
        ctx.origin,
      );
      return;
    }
    ctx.sendJson(ctx.res, 200, transcript, ctx.origin);
  } catch (err) {
    handleCaughtError(ctx.res, ctx.origin, err, ctx.sendError);
  }
}
```

- [ ] **Step 4: Dispatch the routes in `handler.ts`**

Add the import (with the other route imports):

```ts
import {
  handleGetClaudeSession,
  handleListClaudeSessions,
} from "./routes/claude-sessions.js";
```

In `handleRequest`, before the `/api/memory` block, add:

```ts
    if (path === "/api/claude-sessions") {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      await handleListClaudeSessions(ctx);
      return;
    }

    const claudeMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)(\/stream)?$/);
    if (claudeMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      const dir = decodeURIComponent(claudeMatch[1] as string);
      const id = decodeURIComponent(claudeMatch[2] as string);
      // Stream handler is added in Task 7; until then only snapshot is wired.
      await handleGetClaudeSession(ctx, dir, id);
      return;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-route`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/gui/bridge/routes/claude-sessions.ts apps/gui/bridge/handler.ts apps/gui/test/bridge/claude-sessions-route.test.ts
git commit -m "feat(gui): claude-sessions list + snapshot routes"
```

---

## Task 7: Route — SSE live stream

**Files:**
- Modify: `apps/gui/bridge/routes/claude-sessions.ts` (add stream handler)
- Modify: `apps/gui/bridge/handler.ts` (route `/stream` to it)
- Test: `apps/gui/test/bridge/claude-sessions-route.test.ts` (append a test)

- [ ] **Step 1: Add the failing stream test (RED)**

Append inside the `describe` in `apps/gui/test/bridge/claude-sessions-route.test.ts`:

```ts
  it("GET /:dir/:id/stream opens an SSE stream with a snapshot event", async () => {
    const res = await fetch(`${server.baseUrl}/api/claude-sessions/${DIR}/bbbb/stream`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    const { value } = await (reader as ReadableStreamDefaultReader<Uint8Array>).read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: snapshot");
    await (reader as ReadableStreamDefaultReader<Uint8Array>).cancel();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-route`
Expected: FAIL — `/stream` currently falls into the snapshot handler (JSON, not event-stream).

- [ ] **Step 3: Implement the SSE handler (GREEN)**

Add to `apps/gui/bridge/routes/claude-sessions.ts`. Extend the reader import to include `tailTranscript`:

```ts
import {
  listSessions,
  readTranscript,
  safeSessionPath,
  tailTranscript,
} from "../claude-sessions/reader.js";
```

Then append:

```ts
const HEARTBEAT_MS = 15000;

export async function handleStreamClaudeSession(
  ctx: RouteContext,
  dir: string,
  id: string,
): Promise<void> {
  const path = safeSessionPath(ctx.claudeProjectsDir, dir, id);
  if (path === null) {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid session path.", ctx.origin);
    return;
  }
  const snapshot = await readTranscript(ctx.claudeProjectsDir, dir, id);
  if (!snapshot) {
    ctx.sendError(
      ctx.res,
      404,
      "claude_session_not_found",
      `Claude Code session not found: ${dir}/${id}`,
      ctx.origin,
    );
    return;
  }

  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-security-policy": "default-src 'self'",
    vary: "origin",
  };
  if (ctx.origin) headers["access-control-allow-origin"] = ctx.origin;
  ctx.res.writeHead(200, headers);

  const send = (event: string, data: unknown): void => {
    ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("snapshot", { projectLabel: snapshot.projectLabel, messages: snapshot.messages });

  const heartbeat = setInterval(() => ctx.res.write(": ping\n\n"), HEARTBEAT_MS);
  const dispose = tailTranscript(path, snapshot.byteLength, (message) => send("message", message));

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    dispose();
    ctx.res.end();
  };
  ctx.req.on("close", cleanup);
  ctx.req.on("aborted", cleanup);
}
```

- [ ] **Step 4: Route `/stream` in `handler.ts`**

Update the import to add `handleStreamClaudeSession`:

```ts
import {
  handleGetClaudeSession,
  handleListClaudeSessions,
  handleStreamClaudeSession,
} from "./routes/claude-sessions.js";
```

Replace the snapshot-only branch from Task 6 with:

```ts
    const claudeMatch = path.match(/^\/api\/claude-sessions\/([^/]+)\/([^/]+?)(\/stream)?$/);
    if (claudeMatch) {
      if (method !== "GET") return methodNotAllowed(res, method, origin);
      const dir = decodeURIComponent(claudeMatch[1] as string);
      const id = decodeURIComponent(claudeMatch[2] as string);
      if (claudeMatch[3] === "/stream") {
        await handleStreamClaudeSession(ctx, dir, id);
      } else {
        await handleGetClaudeSession(ctx, dir, id);
      }
      return;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @megasaver/gui test -- claude-sessions-route`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/gui/bridge/routes/claude-sessions.ts apps/gui/bridge/handler.ts apps/gui/test/bridge/claude-sessions-route.test.ts
git commit -m "feat(gui): claude-sessions SSE live-stream route"
```

---

## Task 8: GUI API client

**Files:**
- Create: `apps/gui/src/lib/claude-sessions-client.ts`

(No new unit test — exercised through the view smoke test + manual verification. The client is a thin fetch/EventSource wrapper.)

- [ ] **Step 1: Write the client**

`apps/gui/src/lib/claude-sessions-client.ts`:

```ts
import type { BridgeError } from "../components/states.js";

export type Block = {
  kind: "text" | "thinking" | "tool_use" | "tool_result";
  text: string;
};
export type NormalizedMessage = {
  role: "user" | "assistant";
  ts: string;
  blocks: Block[];
};
export type ClaudeSessionMeta = {
  dir: string;
  id: string;
  mtimeMs: number;
  size: number;
  title: string;
  projectLabel: string;
};
export type ClaudeTranscriptSnapshot = {
  projectLabel: string;
  messages: NormalizedMessage[];
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (response.ok) return (await response.json()) as T;
  let body: BridgeError;
  try {
    body = (await response.json()) as BridgeError;
  } catch {
    body = { error: `Bridge request failed with status ${response.status}`, code: "internal_error" };
  }
  throw body;
}

export function fetchClaudeSessions(limit = 50, offset = 0): Promise<ClaudeSessionMeta[]> {
  return getJson<ClaudeSessionMeta[]>(`/api/claude-sessions?limit=${limit}&offset=${offset}`);
}

export type StreamHandlers = {
  onSnapshot: (snapshot: ClaudeTranscriptSnapshot) => void;
  onMessage: (message: NormalizedMessage) => void;
  onError: () => void;
};

// Opens an EventSource against the live-stream route. Caller MUST call the
// returned disposer (close()) when switching sessions or unmounting.
export function openClaudeSessionStream(
  dir: string,
  id: string,
  handlers: StreamHandlers,
): () => void {
  const url = `/api/claude-sessions/${encodeURIComponent(dir)}/${encodeURIComponent(id)}/stream`;
  const source = new EventSource(url);
  source.addEventListener("snapshot", (e) => {
    handlers.onSnapshot(JSON.parse((e as MessageEvent).data) as ClaudeTranscriptSnapshot);
  });
  source.addEventListener("message", (e) => {
    handlers.onMessage(JSON.parse((e as MessageEvent).data) as NormalizedMessage);
  });
  source.addEventListener("error", () => handlers.onError());
  return () => source.close();
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/gui/src/lib/claude-sessions-client.ts
git commit -m "feat(gui): claude-sessions API client + EventSource wrapper"
```

---

## Task 9: Register the view id

**Files:**
- Modify: `apps/gui/src/view-id.ts:4-27`
- Modify: `apps/gui/test/view-id.test-d.ts`

- [ ] **Step 1: Update the type-pin test first (RED)**

In `apps/gui/test/view-id.test-d.ts`, insert `"claude-sessions"` after `"agent-setup"` in BOTH the tuple and the union (alphabetic: `claude-sessions` < `context`). Tuple becomes:

```ts
      readonly [
        "agent-setup",
        "claude-sessions",
        "context",
        "index",
        "memory",
        "overview",
        "rules",
        "sessions",
        "tasks",
        "tools",
      ]
```

Union gains `| "claude-sessions"` after `"agent-setup"`.

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: FAIL — `VIEW_IDS` does not match the pinned tuple.

- [ ] **Step 3: Add the view id (GREEN)**

In `apps/gui/src/view-id.ts`, add `"claude-sessions"` after `"agent-setup"` in `VIEW_IDS`, and add the label. Do NOT add it to `PROJECT_SCOPED_VIEWS` (it is global, across all Claude Code projects):

```ts
export const VIEW_IDS = [
  "agent-setup",
  "claude-sessions",
  "context",
  ...
```

```ts
export const VIEW_LABELS: Record<ViewId, string> = {
  "agent-setup": "Agent setup",
  "claude-sessions": "Claude sessions",
  context: "Context",
  ...
```

- [ ] **Step 4: Run typecheck to verify it passes**

Run: `pnpm --filter @megasaver/gui typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gui/src/view-id.ts apps/gui/test/view-id.test-d.ts
git commit -m "feat(gui): register claude-sessions view id"
```

---

## Task 10: The view component + app wiring

**Files:**
- Create: `apps/gui/src/views/claude-sessions-view.tsx`
- Modify: `apps/gui/src/app.tsx` (import, nav group, render branch)

- [ ] **Step 1: Write the view component**

`apps/gui/src/views/claude-sessions-view.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  type ClaudeSessionMeta,
  type NormalizedMessage,
  fetchClaudeSessions,
  openClaudeSessionStream,
} from "../lib/claude-sessions-client.js";

const LIST_POLL_MS = 4000;
const LIVE_WINDOW_MS = 8000;

function relativeTime(mtimeMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - mtimeMs);
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ClaudeSessionsView(): JSX.Element {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState<BridgeError | null>(null);
  const [selected, setSelected] = useState<ClaudeSessionMeta | null>(null);
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [streamError, setStreamError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);

  function loadList(): void {
    fetchClaudeSessions(50, 0)
      .then((list) => {
        setSessions(list);
        setListState("ready");
      })
      .catch((err: unknown) => {
        setListError(err as BridgeError);
        setListState("error");
      });
  }

  useEffect(() => {
    loadList();
    const t = setInterval(() => {
      loadList();
      setNowMs(Date.now());
    }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    setStreamError(false);
    const dispose = openClaudeSessionStream(selected.dir, selected.id, {
      onSnapshot: (snap) => setMessages(snap.messages),
      onMessage: (msg) => setMessages((prev) => [...prev, msg]),
      onError: () => setStreamError(true),
    });
    return dispose;
  }, [selected]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (listState === "loading") return <LoadingState label="Loading Claude Code sessions…" />;
  if (listState === "error" && listError) return <ErrorState error={listError} onRetry={loadList} />;

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="flex flex-col w-72 shrink-0 border-r border-border overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted">
            No Claude Code sessions found in ~/.claude/projects.
          </p>
        )}
        {sessions.map((s) => {
          const live = nowMs - s.mtimeMs < LIVE_WINDOW_MS;
          const active = selected?.dir === s.dir && selected?.id === s.id;
          return (
            <button
              key={`${s.dir}/${s.id}`}
              type="button"
              onClick={() => setSelected(s)}
              aria-current={active ? "true" : undefined}
              className={[
                "flex flex-col gap-0.5 px-3 py-2 text-left border-b border-border/50 cursor-pointer",
                active ? "bg-accent/15" : "hover:bg-surface-elevated",
              ].join(" ")}
            >
              <span className="flex items-center gap-1.5 text-xs text-text-secondary truncate">
                {live && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-label="live" />
                )}
                <span className="truncate">{s.projectLabel || s.dir}</span>
              </span>
              <span className="text-xs text-text-primary truncate">{s.title || s.id}</span>
              <span className="text-[10px] text-text-muted">{relativeTime(s.mtimeMs, nowMs)}</span>
            </button>
          );
        })}
      </aside>

      <section ref={scrollRef} className="flex flex-col flex-1 min-h-0 overflow-y-auto px-4 py-3 gap-3">
        {!selected && <p className="text-sm text-text-muted py-8">Pick a session to view its transcript.</p>}
        {streamError && <p className="text-xs text-danger">Live stream interrupted. Reselect the session to retry.</p>}
        {selected &&
          messages.map((m, i) => (
            <div key={`${m.ts}-${i}`} className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-text-muted">{m.role}</span>
              {m.blocks.map((b, j) => (
                <pre
                  key={j}
                  className={[
                    "whitespace-pre-wrap break-words text-xs leading-relaxed rounded-md px-3 py-2 border border-border",
                    b.kind === "thinking"
                      ? "text-text-muted italic bg-surface"
                      : b.kind === "tool_use" || b.kind === "tool_result"
                        ? "text-text-secondary bg-surface-elevated font-mono"
                        : "text-text-primary bg-surface",
                  ].join(" ")}
                >
                  {b.text}
                </pre>
              ))}
            </div>
          ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `app.tsx`**

Add the import (with the other view imports):

```ts
import { ClaudeSessionsView } from "./views/claude-sessions-view.js";
```

Add a nav group to `NAV_GROUPS` (after the Tools group):

```ts
  { heading: "Claude Code", views: ["claude-sessions"] },
```

Change the main-content render branch so `claude-sessions` renders globally (like `agent-setup`, no project gate). Replace:

```tsx
          {view === "agent-setup" ? (
            <AgentSetupDoctor activeProjectId={activeProjectId} />
          ) : (
```

with:

```tsx
          {view === "agent-setup" ? (
            <AgentSetupDoctor activeProjectId={activeProjectId} />
          ) : view === "claude-sessions" ? (
            <ClaudeSessionsView />
          ) : (
```

- [ ] **Step 3: Verify typecheck + existing tests pass**

Run: `pnpm --filter @megasaver/gui typecheck && pnpm --filter @megasaver/gui test`
Expected: PASS (all suites, including the smoke `boot.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add apps/gui/src/views/claude-sessions-view.tsx apps/gui/src/app.tsx
git commit -m "feat(gui): Claude Code live sessions view + nav entry"
```

---

## Task 11: Verify, smoke-test, changeset

**Files:**
- Create: `.changeset/claude-code-live-sessions.md`

- [ ] **Step 1: Full repo verification**

Run: `pnpm verify`
Expected: PASS — `biome check`, `tsc --noEmit` (project refs), `vitest run` (all packages), `conventions:check`.
If `biome check` flags formatting, run `pnpm lint:fix` and re-run `pnpm verify`.

- [ ] **Step 2: Manual live smoke (evidence — DoD item 5)**

```bash
pnpm --filter @megasaver/gui dev
```

Then in a browser at the printed Local URL (e.g. http://localhost:5173):
1. Open the **Claude Code → Claude sessions** view.
2. Confirm the list is populated, most-recent first, with a green live dot on the active session.
3. Select the most-recent session; confirm the transcript renders.
4. In a separate Claude Code session, send a message; confirm a new bubble appears in the GUI within ~1s without reload.

Capture the terminal output + a note of the observed live append as evidence.

- [ ] **Step 3: Add a changeset**

Only if a published package's public API changed. The GUI app is private (`apps/gui`), so a changeset is **not** required by the release flow. Skip unless `pnpm changeset status` indicates otherwise. If required:

`.changeset/claude-code-live-sessions.md`:

```md
---
"@megasaver/gui": minor
---

Add a read-only Claude Code live sessions viewer: lists ~/.claude/projects
sessions most-recent first and live-streams the selected transcript via SSE.
```

- [ ] **Step 4: Commit (if changeset added)**

```bash
git add .changeset/claude-code-live-sessions.md
git commit -m "chore: changeset for claude-code live sessions viewer"
```

- [ ] **Step 5: External review (DoD items 6–7)**

Per §4/§12 (HIGH risk): request `code-reviewer` AND `critic` passes in a fresh context (author ≠ reviewer). Focus the security review on `safeSessionPath` (path traversal) and the SSE cleanup path (no leaked watchers/timers on disconnect).

---

## Self-Review

**Spec coverage:**
- List recent-first, all projects, paginated → Task 3 (`listSessions`) + Task 6 (list route, default limit 50).
- Read-only → no write handles anywhere; reader opens files `"r"` only.
- Live real-time tail (SSE) → Task 4 (`tailTranscript`) + Task 7 (SSE route) + Task 8/10 (EventSource view).
- Parser normalization (thinking/text/tool_use, skip attachment/queue-operation/last-prompt) → Task 2.
- Path-traversal rejection → Task 3 (`safeSessionPath`) + Task 6 test + Task 7.
- Error handling: missing root → `[]` (Task 3); deleted/partial line → skip + tail tolerates partial (Task 2/4); traversal → 400; client disconnect → cleanup (Task 7).
- GUI two-pane list/detail + live dot → Task 10.
- Tests (parser, reader+pagination+traversal, route incl. SSE) → Tasks 2/3/4/6/7.

**Deviations from spec (intentional, noted in header):** `system` lines skipped; `last-prompt` not surfaced as an in-progress hint (YAGNI for v1); tail via `fs.watchFile` polling instead of `fs.watch` (more robust, satisfies the re-read-from-offset risk note).

**Type consistency:** `normalizeLine`, `safeSessionPath`, `listSessions(root,{limit,offset})`, `readTranscript(root,dir,id)→{...,byteLength}`, `tailTranscript(path,startOffset,onMessage)→dispose` are used identically across reader, routes, and tests. Server `ClaudeSessionMeta`/`NormalizedMessage`/`Block` shapes mirror the GUI client's local copies (duplication is the established api-client pattern). SSE events `snapshot`/`message` match between Task 7 (server) and Task 8 (client listeners).

**Placeholder scan:** none — every step contains complete code or an exact command.
