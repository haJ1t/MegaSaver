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

type SessionTitle = {
  title: string;
  cwd: string;
  lastActivityAt: number;
  isArchived: boolean;
  model: string;
  permissionMode: string;
};

// Claude Code's desktop app stores one metadata file per session it surfaces,
// nested under <metaDir>/<workspace>/<window>/local_*.json, each carrying the
// AI-generated `title` keyed by `cliSessionId` (the transcript's session id).
// This is the authoritative source for the names the app shows — and, because
// automated sub-sessions (claude-mem observers/summarizers, sub-agent/warmup
// runs) get no such metadata, joining against it also filters them out.
async function readSessionTitles(metaDir: string): Promise<Map<string, SessionTitle>> {
  const titles = new Map<string, SessionTitle>();
  let entries: string[];
  try {
    entries = await readdir(metaDir, { recursive: true });
  } catch {
    return titles;
  }
  await Promise.all(
    entries.map(async (rel) => {
      const base = rel.split(sep).pop() ?? "";
      if (!base.startsWith("local_") || !base.endsWith(".json")) return;
      try {
        const obj = JSON.parse(await readFile(join(metaDir, rel), "utf8")) as {
          cliSessionId?: unknown;
          title?: unknown;
          cwd?: unknown;
          lastActivityAt?: unknown;
          isArchived?: unknown;
          model?: unknown;
          permissionMode?: unknown;
        };
        if (typeof obj.cliSessionId !== "string" || typeof obj.title !== "string") return;
        const lastActivityAt = typeof obj.lastActivityAt === "number" ? obj.lastActivityAt : 0;
        const existing = titles.get(obj.cliSessionId);
        if (existing && existing.lastActivityAt >= lastActivityAt) return;
        titles.set(obj.cliSessionId, {
          title: obj.title,
          cwd: typeof obj.cwd === "string" ? obj.cwd : "",
          lastActivityAt,
          isArchived: obj.isArchived === true,
          model: typeof obj.model === "string" ? obj.model : "",
          permissionMode: typeof obj.permissionMode === "string" ? obj.permissionMode : "",
        });
      } catch {
        // skip unreadable / partially-written metadata file
      }
    }),
  );
  return titles;
}

// First `cwd` seen in a transcript — the session's project path.
function firstCwd(chunk: string): string {
  for (const line of chunk.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const obj = JSON.parse(line) as { cwd?: unknown };
      if (typeof obj.cwd === "string") return obj.cwd;
    } catch {
      // partial/non-JSON line — keep scanning
    }
  }
  return "";
}

export async function listSessions(
  root: string,
  metaDir: string,
  opts: { limit: number; offset: number },
): Promise<ClaudeSessionMeta[]> {
  const titles = await readSessionTitles(metaDir);
  if (titles.size === 0) return [];

  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }
  // Index transcripts the desktop app surfaces (those with metadata) by id.
  const located = new Map<string, { dir: string; path: string }>();
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(join(root, dir));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const id = entry.slice(0, -".jsonl".length);
      if (!titles.has(id) || located.has(id)) continue;
      located.set(id, { dir, path: join(root, dir, entry) });
    }
  }

  const stated = await Promise.all(
    [...located].map(async ([id, f]) => {
      const meta = titles.get(id) as SessionTitle;
      try {
        const s = await stat(f.path);
        return {
          dir: f.dir,
          id,
          mtimeMs: s.mtimeMs,
          size: s.size,
          title: meta.title,
          projectLabel: meta.cwd,
          isArchived: meta.isArchived,
          model: meta.model,
          permissionMode: meta.permissionMode,
          lastActivityAt: meta.lastActivityAt,
        } satisfies ClaudeSessionMeta;
      } catch {
        return null;
      }
    }),
  );
  return stated
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(opts.offset, opts.offset + opts.limit);
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
  const projectLabel = firstCwd(text.slice(0, META_SCAN_BYTES));
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
