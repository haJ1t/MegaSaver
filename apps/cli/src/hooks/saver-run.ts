import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type SaverDecision,
  type SaverDeps,
  type SaverSettings,
  buildSaverDecision,
} from "./saver.js";

const settingsSchema = z.object({ enabled: z.boolean(), mode: tokenSaverModeSchema });

// Reads the GUI-written activation file: <storeRoot>/stats/<wk>/workspace-token-saver.json.
function readSettings(storeRoot: string, workspaceKey: string): SaverSettings | null {
  const path = join(storeRoot, "stats", workspaceKey, "workspace-token-saver.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? { enabled: parsed.data.enabled, mode: parsed.data.mode } : null;
  } catch {
    return null;
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Pure stdout renderer: the PostToolUse envelope on compress, "" on passthrough
// (no JSON = the model keeps the original output). Extracted so the envelope is
// testable without mocking fd 0.
export function renderSaverStdout(decision: SaverDecision): string {
  if (!("updatedToolOutput" in decision)) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: decision.updatedToolOutput,
    },
  });
}

// Always exits 0. On any failure emits nothing → the model keeps the original
// tool output (PostToolUse "no JSON" = no change). Never blocks the tool call.
export async function runSaverHookFromProcess(): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(undefined));
    const deps: SaverDeps = { storeRoot, readSettings, record: recordAndFilterOverlayOutput };
    const decision = await buildSaverDecision(payload, deps);
    const s = renderSaverStdout(decision);
    if (s !== "") process.stdout.write(s);
  } catch {
    // Swallow — best-effort; original output reaches the model.
  }
}
