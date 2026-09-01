import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { HARNESS_CATALOG } from "@megasaver/harness-detect";
import type { ClaudeSessionMeta } from "../claude-sessions/types.js";

const requireForNodeBuiltins = createRequire(import.meta.url);

const HARNESS_MAP = new Map(HARNESS_CATALOG.map((h) => [h.id, h]));

// --- Title helpers --- """Extract a human prompt snippet from Codex/Pi/...".
const CODEX_NOISE_RE =
  /recommended_plugins|AGENTS\.md instructions|# AGENTS\.md|model_switch|environment_context|current_date.*timezone/i;
const TITLE_MAX = 88; // short, dedup-friendly

export function isCodexNoiseText(s: string): boolean {
  const t = s.trim();
  if (t.length < 10) return true;
  if (
    t.startsWith("<environment_context") ||
    t.startsWith("<app-context") ||
    t.startsWith("<recommended_plugins")
  )
    return true;
  if (t.length > 800 && (t.startsWith("<") || t.startsWith("#"))) return true;
  return CODEX_NOISE_RE.test(t);
}

export function cleanTitleText(raw: string): string {
  // Collapse whitespace/newlines, trim, clamp.
  let s = raw.replace(/\s+/g, " ").trim();
  if (s.length > TITLE_MAX) s = `${s.slice(0, TITLE_MAX - 1).trimEnd()}…`;
  return s;
}

export function extractCodexTitleFromText(txt: string): string | null {
  // Scan first ~256 KB, line by line, find first non-noise user response_item.
  const head = txt.slice(0, 256 * 1024);
  for (const line of head.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const rec = obj as Record<string, unknown>;
    const type = rec["type"];
    if (type !== "response_item") continue;
    const payload = (rec["payload"] ?? rec) as Record<string, unknown>;
    if (payload["role"] !== "user") continue;
    const content = payload["content"];
    let piece = "";
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === "object" &&
          typeof (block as Record<string, unknown>)["text"] === "string"
        ) {
          piece += (block as Record<string, unknown>)["text"] as string;
        } else if (
          block &&
          typeof block === "object" &&
          typeof (block as Record<string, unknown>)["input_text"] === "string"
        ) {
          piece += (block as Record<string, unknown>)["input_text"] as string;
        }
      }
    } else if (typeof content === "string") piece = content;
    else if (typeof payload["text"] === "string") piece = payload["text"] as string;
    const cleaned = piece.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (isCodexNoiseText(cleaned)) continue;
    return cleanTitleText(cleaned);
  }
  return null;
}

export function extractPiTitleFromText(txt: string): string | null {
  const head = txt.slice(0, 256 * 1024);
  for (const line of head.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const rec = obj as Record<string, unknown>;
    if (rec["type"] !== "message") continue;
    const msg = rec["message"] as Record<string, unknown> | undefined;
    if (!msg || msg["role"] !== "user") continue;
    const content = msg["content"];
    let piece = "";
    if (Array.isArray(content)) {
      for (const c of content) {
        if (
          c &&
          typeof c === "object" &&
          typeof (c as Record<string, unknown>)["text"] === "string"
        )
          piece += `${(c as Record<string, unknown>)["text"] as string} `;
      }
    } else if (typeof content === "string") piece = content;
    const cleaned = piece.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (cleaned.length < 8) continue;
    // Pi has only real user prompts in this slot, no AGENTS noise.
    return cleanTitleText(cleaned);
  }
  return null;
}

// Lightweight generic for other JSONL harnesses: first user text encountered.
export function extractGenericTitleFromText(txt: string): string | null {
  const head = txt.slice(0, 128 * 1024);
  for (const line of head.split(String.fromCharCode(10))) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const tryTexts: string[] = [];
      const p = (obj["payload"] ?? obj) as Record<string, unknown>;
      if (typeof p["text"] === "string") tryTexts.push(p["text"] as string);
      if (Array.isArray(p["content"] as unknown)) {
        for (const b of p["content"] as unknown[])
          if (b && typeof (b as Record<string, unknown>)["text"] === "string")
            tryTexts.push((b as Record<string, unknown>)["text"] as string);
      }
      const msg = obj["message"] as Record<string, unknown> | undefined;
      if (msg && Array.isArray(msg["content"]))
        for (const b of msg["content"] as unknown[])
          if (b && typeof (b as Record<string, unknown>)["text"] === "string")
            tryTexts.push((b as Record<string, unknown>)["text"] as string);
      for (const cand of tryTexts) {
        const c = cand.replace(/\s+/g, " ").trim();
        if (c.length >= 8 && !isCodexNoiseText(c)) return cleanTitleText(c);
      }
    } catch {}
  }
  return null;
}

export interface MultiHarnessScanOptions {
  limit?: number | undefined;
  offset?: number | undefined;
  harness?: string | undefined;
  storeRoot?: string | undefined;
  homeDir?: string | undefined;
}

export async function scanAllHarnessSessions(
  options: MultiHarnessScanOptions = {},
): Promise<ClaudeSessionMeta[]> {
  const home = options.homeDir || process.env["HOME"] || process.env["USERPROFILE"] || "";
  const sessions: ClaudeSessionMeta[] = [];
  const seenIds = new Set<string>();

  const add = (s: ClaudeSessionMeta) => {
    if (!seenIds.has(s.id)) {
      seenIds.add(s.id);
      sessions.push(s);
    }
  };

  // 1. OpenAI Codex (~/.codex/sessions)
  if (home) {
    const codexDir = join(home, ".codex", "sessions");
    // Codex rolls the file per continuation (same session_id, new rollout-* file).
    // First-encounter wins would keep the stale start file; we need freshest mtime.
    const codexSeen = new Set<string>();
    const codexPending: ClaudeSessionMeta[] = [];
    const codexAdd = (s: ClaudeSessionMeta): void => {
      // Buffer; dedupe later by newest mtime
      if (!codexSeen.has(s.id)) {
        codexSeen.add(s.id);
        codexPending.push(s);
      } else {
        const idx = codexPending.findIndex((x) => x.id === s.id);
        const existing = idx !== -1 ? codexPending[idx] : undefined;
        if (existing && s.mtimeMs > existing.mtimeMs) codexPending[idx] = s;
      }
    };
    await scanJsonlTree(codexDir, "codex", "OpenAI Codex", codexAdd, new Set<string>());
    // Now commit, skipping any already in global seenIds (e.g. from other harnesses)
    for (const s of codexPending) add(s);
  }

  // 2. Pi Agent (~/.pi/agent/sessions/)
  if (home) {
    const piDir = join(home, ".pi", "agent", "sessions");
    if (existsSync(piDir)) {
      try {
        const folders = await readdir(piDir);
        for (const folder of folders) {
          const fp = join(piDir, folder);
          try {
            const st = await stat(fp);
            if (st.isDirectory()) {
              const files = await readdir(fp);
              for (const f of files) {
                if (f.endsWith(".jsonl")) {
                  const full = join(fp, f);
                  try {
                    const fst = await stat(full);
                    const txt = await readFile(full, "utf8");
                    const nl = txt.indexOf(String.fromCharCode(10));
                    const firstLine = txt.slice(0, nl === -1 ? undefined : nl);
                    let id = f.replace(".jsonl", "");
                    let cwd = "";
                    let time = fst.mtimeMs;
                    try {
                      const parsed = JSON.parse(firstLine) as {
                        id?: string;
                        cwd?: string;
                        timestamp?: string;
                      };
                      if (parsed.id) id = parsed.id;
                      if (parsed.cwd) cwd = parsed.cwd;
                      if (parsed.timestamp) time = Date.parse(parsed.timestamp) || time;
                    } catch {}

                    const folderName = cwd ? basename(cwd) : "MegaSaver";
                    const piTitle =
                      extractPiTitleFromText(txt) || `Pi Agent session in ${folderName}`;
                    // Prefer Pi's internal timestamp for sorting; keep mtime fallback
                    add({
                      dir: cwd ? basename(cwd) : "pi",
                      id,
                      mtimeMs: time,
                      size: fst.size,
                      title: piTitle,
                      projectLabel: cwd || "Pi Agent",
                      isArchived: false,
                      model: "pi",
                      permissionMode: "default",
                      lastActivityAt: time,
                      harness: "pi",
                      harnessName: "Pi Agent",
                    });
                  } catch {}
                }
              }
            }
          } catch {}
        }
      } catch {}
    }
  }

  // 3. OpenCode — read real sessions from SQLite db (~/.local/share/opencode/opencode.db)
  //    Fallback to prompt-history.jsonl only when DB is absent/unreadable.
  if (home) {
    let opencodeFromDb = 0;
    const opencodeDbPath = join(home, ".local", "share", "opencode", "opencode.db");
    if (existsSync(opencodeDbPath)) {
      try {
        const sqliteModule = requireForNodeBuiltins("node:sqlite") as {
          DatabaseSync: typeof import("node:sqlite").DatabaseSync;
        };
        const db = new sqliteModule.DatabaseSync(opencodeDbPath, { readOnly: true });
        try {
          const rows = db
            .prepare(
              "SELECT id, title, directory, time_updated FROM session ORDER BY time_updated DESC",
            )
            .all() as Array<{ id: string; title: string; directory: string; time_updated: number }>;
          for (const row of rows) {
            if (!row.id || seenIds.has(row.id)) continue;
            const dir = row.directory || "";
            const folder = dir ? basename(dir) : "workspace";
            add({
              dir: folder,
              id: row.id,
              mtimeMs: row.time_updated,
              size: 1024,
              title: row.title || `OpenCode session in ${folder}`,
              projectLabel: dir || "OpenCode",
              isArchived: false,
              model: "opencode",
              permissionMode: "default",
              lastActivityAt: row.time_updated,
              harness: "opencode",
              harnessName: "OpenCode",
            });
            opencodeFromDb++;
          }
        } finally {
          db.close();
        }
      } catch {}
    }
    if (opencodeFromDb === 0) {
      const opencodeState = join(home, ".local", "state", "opencode");
      if (existsSync(opencodeState)) {
        const hist = join(opencodeState, "prompt-history.jsonl");
        if (existsSync(hist)) {
          try {
            const st = await stat(hist);
            const txt = await readFile(hist, "utf8");
            const lines = txt.split(String.fromCharCode(10)).filter((l) => l.trim().length > 0);
            if (lines.length > 0) {
              const last = JSON.parse(lines[lines.length - 1] as string) as { input?: string };
              const first = JSON.parse(lines[0] as string) as { input?: string };
              const promptText = (last.input || first.input || "OpenCode Session").slice(0, 45);
              add({
                dir: "opencode",
                id: "opencode-prompt-history",
                mtimeMs: st.mtimeMs,
                size: st.size,
                title: `OpenCode: ${promptText}`,
                projectLabel: join(home, "Desktop", "MegaSaver"),
                isArchived: false,
                model: "opencode",
                permissionMode: "default",
                lastActivityAt: st.mtimeMs,
                harness: "opencode",
                harnessName: "OpenCode",
              });
            }
          } catch {}
        }
      }
    }
  }

  // 4. GitHub Copilot CLI (~/.copilot/session-state/)
  if (home) {
    const copilotDir = join(home, ".copilot", "session-state");
    if (existsSync(copilotDir)) {
      try {
        const entries = await readdir(copilotDir);
        for (const sid of entries) {
          const full = join(copilotDir, sid);
          try {
            const st = await stat(full);
            let copilotTitle = "GitHub Copilot CLI session";
            try {
              // Best-effort: derive a short title from any json inside the dir blob if it is a file
              if (!st.isDirectory()) {
                const raw = await readFile(full, "utf8");
                const g = extractGenericTitleFromText(raw);
                if (g) copilotTitle = `GitHub Copilot: ${g}`;
              }
            } catch {}
            add({
              dir: "copilot",
              id: sid,
              mtimeMs: st.mtimeMs,
              size: 1024,
              title: copilotTitle,
              projectLabel: "GitHub Copilot",
              isArchived: false,
              model: "copilot",
              permissionMode: "default",
              lastActivityAt: st.mtimeMs,
              harness: "copilot",
              harnessName: "GitHub Copilot CLI",
            });
          } catch {}
        }
      } catch {}
    }
  }

  // 5. Gemini CLI / Antigravity (~/.gemini/)
  if (home) {
    await scanSimpleHarnessDir(join(home, ".gemini"), "gemini", "Gemini CLI", add, seenIds);
    await scanSimpleHarnessDir(
      join(home, ".gemini", "antigravity"),
      "antigravity",
      "Google Antigravity",
      add,
      seenIds,
    );
  }

  // 6. Aider (~/.aider/)
  if (home) {
    await scanSimpleHarnessDir(join(home, ".aider"), "aider", "Aider", add, seenIds);
  }

  // 7. Continue (~/.continue/sessions/)
  if (home) {
    const continueDir = join(home, ".continue", "sessions");
    await scanJsonlTree(continueDir, "continue", "Continue", add, seenIds);
  }

  // 8. Goose (~/.config/goose/ & ~/.goose/)
  if (home) {
    await scanSimpleHarnessDir(
      join(home, ".config", "goose"),
      "goose",
      "Goose (Block)",
      add,
      seenIds,
    );
    await scanSimpleHarnessDir(join(home, ".goose"), "goose", "Goose (Block)", add, seenIds);
  }

  // 9. Cursor, Windsurf, Trae, Zed
  if (home) {
    if (process.platform === "darwin") {
      await scanIdeStorage(
        join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
        "cursor",
        "Cursor",
        add,
        seenIds,
      );
      await scanIdeStorage(
        join(home, "Library", "Application Support", "Windsurf", "User", "workspaceStorage"),
        "windsurf",
        "Windsurf",
        add,
        seenIds,
      );
      await scanIdeStorage(
        join(home, "Library", "Application Support", "Trae", "User", "workspaceStorage"),
        "trae",
        "Trae",
        add,
        seenIds,
      );
      await scanSimpleHarnessDir(
        join(home, "Library", "Application Support", "Zed"),
        "zed",
        "Zed",
        add,
        seenIds,
      );
    } else {
      await scanIdeStorage(
        join(home, ".config", "Cursor", "User", "workspaceStorage"),
        "cursor",
        "Cursor",
        add,
        seenIds,
      );
      await scanIdeStorage(
        join(home, ".config", "Windsurf", "User", "workspaceStorage"),
        "windsurf",
        "Windsurf",
        add,
        seenIds,
      );
      await scanSimpleHarnessDir(join(home, ".config", "zed"), "zed", "Zed", add, seenIds);
    }
  }

  // 10. Other Popular CLI Agents (Crush, Amp, Qwen, DeepSeek, Devin, Hermes, OpenHands, gptme, Grok, Mentat, etc.)
  if (home) {
    const cliHarnesses: Array<{ id: string; name: string; dirs: string[] }> = [
      {
        id: "crush",
        name: "Crush (Charm)",
        dirs: [join(home, ".config", "crush"), join(home, ".crush")],
      },
      {
        id: "amp",
        name: "Amp (Sourcegraph)",
        dirs: [join(home, ".config", "amp"), join(home, ".amp")],
      },
      {
        id: "amazon-q",
        name: "Amazon Q Developer CLI",
        dirs: [join(home, ".aws", "amazon-q"), join(home, ".amazon-q")],
      },
      { id: "qwen", name: "Qwen Code", dirs: [join(home, ".qwen"), join(home, ".config", "qwen")] },
      {
        id: "deepseek",
        name: "DeepSeek CLI",
        dirs: [join(home, ".deepseek"), join(home, ".config", "deepseek")],
      },
      { id: "devin", name: "Devin CLI", dirs: [join(home, ".devin")] },
      { id: "hermes", name: "Hermes", dirs: [join(home, ".hermes", "sessions")] },
      { id: "openhands", name: "OpenHands", dirs: [join(home, ".openhands")] },
      { id: "gptme", name: "gptme", dirs: [join(home, ".config", "gptme"), join(home, ".gptme")] },
      { id: "grok", name: "Grok CLI", dirs: [join(home, ".grok")] },
      { id: "mentat", name: "Mentat", dirs: [join(home, ".mentat")] },
      {
        id: "cody",
        name: "Sourcegraph Cody",
        dirs: [join(home, ".sourcegraph"), join(home, ".cody")],
      },
      { id: "cline", name: "Cline", dirs: [join(home, ".cline")] },
      { id: "roo-code", name: "Roo Code", dirs: [join(home, ".roo-code")] },
      { id: "kilo-code", name: "Kilo Code", dirs: [join(home, ".kilo")] },
      { id: "qodo", name: "Qodo Gen", dirs: [join(home, ".qodo")] },
      {
        id: "avante",
        name: "avante.nvim",
        dirs: [join(home, ".local", "share", "nvim", "avante")],
      },
      { id: "plandex", name: "Plandex", dirs: [join(home, ".plandex")] },
      { id: "openclaw", name: "OpenClaw", dirs: [join(home, ".openclaw")] },
      {
        id: "droid",
        name: "Factory Droid",
        dirs: [join(home, ".factory", "droid"), join(home, ".droid")],
      },
      { id: "warp", name: "Warp", dirs: [join(home, ".warp")] },
      { id: "iflow", name: "iFlow CLI", dirs: [join(home, ".iflow")] },
      { id: "bits", name: "Bits (bitmagic)", dirs: [join(home, ".bits")] },
      { id: "tabby", name: "Tabby", dirs: [join(home, ".tabby")] },
      { id: "refact", name: "Refact.ai", dirs: [join(home, ".refact")] },
      { id: "gpt-engineer", name: "GPT Engineer", dirs: [join(home, ".gpt-engineer")] },
    ];

    for (const h of cliHarnesses) {
      for (const d of h.dirs) {
        await scanSimpleHarnessDir(d, h.id, h.name, add, seenIds);
      }
    }
  }

  // 11. MegaSaver Mesh Presence & Overlay Stats
  if (options.storeRoot) {
    const presenceDir = join(options.storeRoot, "mesh", "presence");
    try {
      if (existsSync(presenceDir)) {
        const entries = await readdir(presenceDir);
        for (const file of entries) {
          if (!file.endsWith(".json")) continue;
          const id = file.slice(0, -".json".length);
          if (seenIds.has(id)) continue;
          try {
            const raw = await readFile(join(presenceDir, file), "utf8");
            const parsed = JSON.parse(raw) as {
              liveSessionId?: string;
              agent?: string;
              status?: string;
              lastSeenAt?: string;
              workspaceKey?: string;
              cwd?: string;
              branch?: string;
            };
            const sid = parsed.liveSessionId ?? id;
            if (seenIds.has(sid)) continue;
            const agentId = parsed.agent ?? "claude-code";
            const desc = HARNESS_MAP.get(agentId as import("@megasaver/shared").AgentId);
            const harnessName = desc?.name ?? agentId;
            const cwd = parsed.cwd ?? "";
            const folderName = cwd ? basename(cwd) : "workspace";
            const timeMs = parsed.lastSeenAt ? Date.parse(parsed.lastSeenAt) : Date.now();
            // Claude Code stores transcripts under dash-encoded cwd
            // ("/Users/ozger/Desktop/verifywise" -> "-Users-ozger-Desktop-verifywise"),
            // NOT under the hash workspaceKey. Emitting the hash as `dir`
            // makes readTranscript look for ~/.claude/projects/<hash>/<id>.jsonl
            // (ENOENT) and every detail route 404s.
            const claudeDir =
              cwd.length > 0
                ? `-${cwd.slice(1).replace(/\//g, "-")}`
                : (parsed.workspaceKey ?? "default");
            const dirForSession =
              agentId === "claude-code" ? claudeDir : (parsed.workspaceKey ?? "default");

            add({
              dir: dirForSession,
              id: sid,
              mtimeMs: timeMs,
              size: 1024,
              title: `${harnessName} session in ${folderName}${parsed.branch ? ` (${parsed.branch})` : ""}`,
              projectLabel: cwd,
              isArchived: false,
              model: desc?.category ?? "cli",
              permissionMode: "default",
              lastActivityAt: timeMs,
              harness: agentId,
              harnessName,
            });
          } catch {}
        }
      }
    } catch {}
  }

  return sessions;
}

async function scanJsonlTree(
  dir: string,
  harnessId: string,
  harnessName: string,
  add: (s: ClaudeSessionMeta) => void,
  seenIds: Set<string>,
  depth = 0,
): Promise<void> {
  if (depth > 4 || !existsSync(dir)) return;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const item of entries) {
    const full = join(dir, item);
    try {
      const st = await stat(full);
      if (st.isDirectory()) {
        await scanJsonlTree(full, harnessId, harnessName, add, seenIds, depth + 1);
      } else if (item.endsWith(".jsonl") || item.endsWith(".json")) {
        const sid = item.replace(/\.(jsonl|json)$/, "");
        if (seenIds.has(sid)) continue;
        const txt = await readFile(full, "utf8");
        const nl = txt.indexOf(String.fromCharCode(10));
        const firstLine = txt.slice(0, nl === -1 ? undefined : nl);
        let payload: Record<string, unknown> = {};
        // For Codex, file mtime IS the last-activity time (file is appended as the agent works).
        // Do NOT overwrite with the session_meta timestamp (session start) which would make live
        // sessions appear 2 days old. Keep st.mtimeMs as canonical, only use parsed timestamp for
        // harness types where the file is not continuously appended.
        let timeVal = st.mtimeMs;
        let cwdFromFile = "";
        try {
          const p = JSON.parse(firstLine);
          payload = (p.payload as Record<string, unknown>) ?? p ?? {};
          // Only adopt parsed timestamp when the file has no meaningful mtime difference or for non-Codex harnesses:
          if (harnessId !== "codex" && typeof p.timestamp === "string") {
            const parsed = Date.parse(p.timestamp);
            if (parsed && Math.abs(parsed - st.mtimeMs) < 60000) timeVal = parsed;
          }
          if (typeof p.cwd === "string") cwdFromFile = p.cwd;
          if (!cwdFromFile && typeof (p as Record<string, unknown>)["cwd"] === "string")
            cwdFromFile = (p as Record<string, unknown>)["cwd"] as string;
          if (!cwdFromFile && payload && typeof payload["cwd"] === "string")
            cwdFromFile = payload["cwd"] as string;
        } catch {}
        // Deep-scan cwd for Codex files where session_meta is not the first line (e.g. compacted sessions)
        if (!cwdFromFile && harnessId === "codex") {
          // cheap second pass: look for session_meta line in the head
          for (const l of txt.slice(0, 64 * 1024).split(String.fromCharCode(10))) {
            const t = l.trim();
            if (!t) continue;
            try {
              const o = JSON.parse(t) as Record<string, unknown>;
              if (
                o["type"] === "session_meta" &&
                (o["payload"] as Record<string, unknown>)?.["cwd"]
              ) {
                cwdFromFile = (o["payload"] as Record<string, unknown>)["cwd"] as string;
                break;
              }
              if (typeof o["cwd"] === "string" && o["type"] === "session_meta") {
                cwdFromFile = o["cwd"] as string;
                break;
              }
            } catch {}
          }
        }
        const realId = (payload["session_id"] as string) ?? (payload["id"] as string) ?? sid;
        if (seenIds.has(realId)) continue;
        const cwd = cwdFromFile || (payload["cwd"] as string) || "";
        const folder = cwd ? basename(cwd) : "workspace";
        let title: string;
        if (harnessId === "codex") {
          title = extractCodexTitleFromText(txt) || `${harnessName} session in ${folder}`;
        } else {
          title = extractGenericTitleFromText(txt) || `${harnessName} session in ${folder}`;
        }
        add({
          dir: cwd ? basename(cwd) : harnessId,
          id: realId,
          mtimeMs: timeVal,
          size: st.size,
          title,
          projectLabel: cwd || harnessName,
          isArchived: false,
          model: harnessId,
          permissionMode: "default",
          lastActivityAt: timeVal,
          harness: harnessId,
          harnessName,
        });
      }
    } catch {}
  }
}

const SIMPLE_DIR_DENYLIST = new Set([
  "node_modules",
  "agents",
  "skills",
  "bin",
  "cache",
  "logs",
  "cron",
  "hooks",
  "memories",
  "sessions",
  "plugins",
  "image_cache",
  "audio_cache",
  "hermes-agent",
  "bootstrap-cache",
  "desktop",
  "desktop-plugins",
  ".git",
]);

const SIMPLE_FILE_DENYLIST_SUFFIXES = [
  ".db",
  ".db-shm",
  ".db-wal",
  ".etag",
  ".lock",
  ".yaml",
  ".yml",
  ".md",
  ".txt",
  ".env",
];

async function scanSimpleHarnessDir(
  dir: string,
  harnessId: string,
  harnessName: string,
  add: (s: ClaudeSessionMeta) => void,
  seenIds: Set<string>,
): Promise<void> {
  if (!existsSync(dir)) return;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (SIMPLE_DIR_DENYLIST.has(e.name)) continue;
      // Skip obvious non-session files (db, lock, yaml, md etc). Real sessions
      // are usually jsonl/json under a sessions subdir; top-level dir scans are
      // heuristics so we must not turn every config file into a session.
      const lower = e.name.toLowerCase();
      if (!e.isDirectory() && SIMPLE_FILE_DENYLIST_SUFFIXES.some((suf) => lower.endsWith(suf)))
        continue;
      if (lower === "package.json" || lower === "package-lock.json") continue;
      const full = join(dir, e.name);
      try {
        const st = await stat(full);
        // For regular files, only treat .jsonl/.json as potential sessions; dirs are ok.
        if (!e.isDirectory() && !e.name.endsWith(".jsonl") && !e.name.endsWith(".json")) continue;
        const sid = `${harnessId}-${e.name}`;
        if (seenIds.has(sid)) continue;
        add({
          dir: harnessId,
          id: sid,
          mtimeMs: st.mtimeMs,
          size: st.size,
          title: `${harnessName} (${e.name})`,
          projectLabel: dir,
          isArchived: false,
          model: harnessId,
          permissionMode: "default",
          lastActivityAt: st.mtimeMs,
          harness: harnessId,
          harnessName,
        });
      } catch {}
    }
  } catch {}
}

async function scanIdeStorage(
  storageDir: string,
  harnessId: string,
  harnessName: string,
  add: (s: ClaudeSessionMeta) => void,
  seenIds: Set<string>,
): Promise<void> {
  if (!existsSync(storageDir)) return;
  try {
    const entries = await readdir(storageDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const full = join(storageDir, e.name);
      const wsJsonPath = join(full, "workspace.json");
      let folderName = e.name;
      let cwd = "";
      if (existsSync(wsJsonPath)) {
        try {
          const ws = JSON.parse(await readFile(wsJsonPath, "utf8")) as { folder?: string };
          if (ws.folder) {
            cwd = decodeURIComponent(ws.folder.replace(/^file:\/\//, ""));
            folderName = basename(cwd);
          }
        } catch {}
      }
      try {
        const st = await stat(full);
        const sid = `${harnessId}-${e.name}`;
        if (seenIds.has(sid)) continue;
        add({
          dir: folderName,
          id: sid,
          mtimeMs: st.mtimeMs,
          size: st.size,
          title: `${harnessName} in ${folderName}`,
          projectLabel: cwd || folderName,
          isArchived: false,
          model: "ide",
          permissionMode: "default",
          lastActivityAt: st.mtimeMs,
          harness: harnessId,
          harnessName,
        });
      } catch {}
    }
  } catch {}
}
