import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import type { ClaudeTranscript, NormalizedMessage } from "./types.js";

const requireForNodeBuiltins = createRequire(import.meta.url);

const TOOL_INPUT_MAX = 2000;

function asObj(v: unknown): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null) return null;
  return v as Record<string, unknown>;
}

// ---------- OpenCode (SQLite) ----------
export async function readOpenCodeTranscript(
  homeDir: string,
  id: string,
): Promise<ClaudeTranscript | null> {
  const dbPath = join(homeDir, ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) return null;
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    const m = requireForNodeBuiltins("node:sqlite") as typeof import("node:sqlite");
    DatabaseSync = m.DatabaseSync;
  } catch {
    return null;
  }
  let db: InstanceType<typeof DatabaseSync> | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare("SELECT id, title, directory, time_updated FROM session WHERE id = ?")
      .get(id) as
      | { id: string; title: string; directory: string; time_updated: number }
      | undefined;
    if (!row) return null;
    const cwd = row.directory || "";
    const msgs = db
      .prepare(
        "SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC",
      )
      .all(id) as Array<{ id: string; data: string; time_created: number }>;
    if (msgs.length === 0) return null;
    const messages: NormalizedMessage[] = [];
    for (const mm of msgs) {
      let mdata: Record<string, unknown> = {};
      try {
        mdata = JSON.parse(mm.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const role = mdata["role"];
      if (role !== "user" && role !== "assistant") continue;
      const ts = mm.time_created ? new Date(mm.time_created).toISOString() : "";
      // parts
      const parts = db
        .prepare(
          "SELECT data, time_created FROM part WHERE message_id = ? ORDER BY time_created ASC",
        )
        .all(mm.id) as Array<{ data: string; time_created: number }>;
      const blocks: NormalizedMessage["blocks"] = [];
      for (const pr of parts) {
        let pdata: Record<string, unknown> = {};
        try {
          pdata = JSON.parse(pr.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const pType = pdata["type"];
        const textVal = pdata["text"];
        const reasoningVal = pdata["reasoning"];
        if (pType === "text" && typeof textVal === "string" && textVal.trim().length > 0) {
          blocks.push({ kind: "text", text: textVal });
        } else if (
          pType === "reasoning" &&
          typeof textVal === "string" &&
          textVal.trim().length > 0
        ) {
          blocks.push({ kind: "thinking", text: textVal });
        } else if (pType === "reasoning" && typeof reasoningVal === "string") {
          blocks.push({ kind: "thinking", text: reasoningVal });
        } else if (pType === "tool") {
          const tool = (pdata["tool"] as string) ?? "tool";
          const state = asObj(pdata["state"]);
          const input = state?.["input"] ?? pdata["input"] ?? {};
          const inputStr = typeof input === "string" ? input : JSON.stringify(input ?? {});
          blocks.push({ kind: "tool_use", text: `${tool}(${inputStr.slice(0, TOOL_INPUT_MAX)})` });
          // tool output if present
          const output = state?.["output"] ?? pdata["output"];
          if (output) {
            let outStr = typeof output === "string" ? output : JSON.stringify(output);
            outStr = outStr.slice(0, TOOL_INPUT_MAX);
            if (outStr.trim().length > 0) blocks.push({ kind: "tool_result", text: outStr });
          }
        }
        // step-start/step-finish are structural, skip
      }
      if (blocks.length === 0) continue;
      const model =
        typeof mdata["modelID"] === "string"
          ? (mdata["modelID"] as string)
          : typeof mdata["model"] === "string"
            ? (mdata["model"] as string)
            : undefined;
      const tokens = asObj(mdata["tokens"]);
      let meta = undefined;
      if (model || tokens) {
        const cache = asObj(tokens?.["cache"]);
        meta = {
          ...(model ? { model } : {}),
          ...(tokens
            ? {
                usage: {
                  inputTokens:
                    typeof tokens["input"] === "number" ? (tokens["input"] as number) : 0,
                  outputTokens:
                    typeof tokens["output"] === "number" ? (tokens["output"] as number) : 0,
                  cacheCreationInputTokens:
                    typeof cache?.["write"] === "number" ? (cache["write"] as number) : 0,
                  cacheReadInputTokens:
                    typeof cache?.["read"] === "number" ? (cache["read"] as number) : 0,
                },
              }
            : {}),
        };
      }
      messages.push({
        role: role as "user" | "assistant",
        ts,
        blocks,
        ...(meta ? { meta } : {}),
      } satisfies NormalizedMessage);
    }
    if (messages.length === 0) return null;
    const dir = cwd ? basename(cwd) : "opencode";
    // synthesize byteLength from DB rows
    let byteLength = 0;
    for (const m of msgs) byteLength += m.data.length;
    return {
      dir,
      id,
      projectLabel: cwd || row.title || "OpenCode",
      byteLength,
      messages,
    } satisfies ClaudeTranscript;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}
