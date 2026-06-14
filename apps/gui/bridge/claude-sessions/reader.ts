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
      const obj = raw as { cwd: unknown };
      if (!projectLabel && typeof obj.cwd === "string") projectLabel = obj.cwd;
      if (!title) {
        const msg = normalizeLine(raw);
        if (msg?.role === "user") {
          title = msg.blocks
            .map((b) => b.text)
            .join(" ")
            .slice(0, 120);
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
