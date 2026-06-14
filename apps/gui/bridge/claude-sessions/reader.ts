import { unwatchFile, watchFile } from "node:fs";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
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
export async function safeSessionPath(
  root: string,
  dir: string,
  id: string,
): Promise<string | null> {
  if (!isSafeSegment(dir) || !isSafeSegment(id)) return null;
  const base = resolve(root);
  const candidate = resolve(base, dir, `${id}.jsonl`);
  if (candidate !== join(base, dir, `${id}.jsonl`)) return null;
  if (!candidate.startsWith(base + sep)) return null;
  // Defence-in-depth: if the path exists, resolve symlinks on BOTH base and
  // candidate and re-check containment, so a symlinked dir cannot escape root.
  // A non-existent path is NOT rejected here (not-found is handled downstream).
  try {
    const [realBase, realCandidate] = await Promise.all([realpath(base), realpath(candidate)]);
    if (!realCandidate.startsWith(realBase + sep)) return null;
  } catch {
    // base or candidate doesn't exist yet — lexical checks already passed.
  }
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

// Slash-command turns arrive as `<command-name>/x</command-name>` +
// `<command-args>…</command-args>` wrappers; surface them the way Claude Code does
// (the command plus its args) instead of the raw XML.
function cleanTitle(text: string): string {
  const name = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  if (name) {
    const args = text.match(/<command-args>\s*([^<]*?)\s*<\/command-args>/);
    return [name[1], args?.[1]].filter(Boolean).join(" ").trim();
  }
  return text;
}

function deriveMeta(chunk: string): { title: string; projectLabel: string; entrypoint: string } {
  let title = "";
  let projectLabel = "";
  let entrypoint = "";
  for (const line of chunk.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (raw && typeof raw === "object") {
      const obj = raw as { cwd: unknown; entrypoint: unknown };
      if (!projectLabel && typeof obj.cwd === "string") projectLabel = obj.cwd;
      if (!entrypoint && typeof obj.entrypoint === "string") entrypoint = obj.entrypoint;
      if (!title) {
        const msg = normalizeLine(raw);
        if (msg?.role === "user") {
          title = cleanTitle(msg.blocks.map((b) => b.text).join(" ")).slice(0, 120);
        }
      }
    }
    if (title && projectLabel && entrypoint) break;
  }
  return { title, projectLabel, entrypoint };
}

// Claude Code does not surface SDK / sub-agent sessions in its own picker, so we
// hide them too. These are identifiable structurally (no file read needed):
//  - sub-agent + warmup transcripts are named `agent-*.jsonl`
//  - claude-mem observer sessions live under a synthetic `.claude-mem` project dir
// (entrypoint "sdk-cli" is a further signal, applied after the head read.)
function isHiddenAgentSession(dir: string, id: string): boolean {
  return id.startsWith("agent-") || dir.includes("claude-mem");
}

// Machine-generated prompt signatures of automated claude-mem / Claude Code
// sub-sessions (memory observers, conversation summarizers) that Claude Code does
// not show as user conversations. These markers sit at the very start of the first
// turn's message content, so a substring scan of the head detects them even when
// the full line (which can embed an entire observed/summarized session) is far
// larger than the head read and would otherwise fail to JSON-parse.
const AGENT_PROMPT_MARKERS = [
  "Hello memory agent",
  "This summary will be shown in a list",
] as const;

function looksLikeAgentPrompt(head: string): boolean {
  return AGENT_PROMPT_MARKERS.some((marker) => head.includes(marker));
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
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Read heads lazily from most-recent down, skipping SDK/agent sessions
  // (entrypoint "sdk-cli" — e.g. claude-mem observers) that Claude Code does not
  // surface as user sessions. Filtering must precede offset/limit, so we walk the
  // sorted list and read only as many files as needed to fill the page.
  const result: ClaudeSessionMeta[] = [];
  let skipped = 0;
  for (const s of sorted) {
    if (result.length >= opts.limit) break;
    if (isHiddenAgentSession(s.dir, s.id)) continue;
    const head = await readHead(s.path, META_SCAN_BYTES).catch(() => "");
    if (looksLikeAgentPrompt(head)) continue;
    const { title, projectLabel, entrypoint } = deriveMeta(head);
    if (entrypoint === "sdk-cli") continue;
    if (skipped < opts.offset) {
      skipped++;
      continue;
    }
    result.push({
      dir: s.dir,
      id: s.id,
      mtimeMs: s.mtimeMs,
      size: s.size,
      title,
      projectLabel,
    } satisfies ClaudeSessionMeta);
  }
  return result;
}

export async function readTranscript(
  root: string,
  dir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const path = await safeSessionPath(root, dir, id);
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
