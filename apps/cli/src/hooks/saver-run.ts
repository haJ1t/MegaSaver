import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type RecordOverlayOutputInput,
  type RecordOverlayOutputResult,
  recordAndFilterOverlayOutput,
} from "@megasaver/core";
import { getRunningDaemon } from "@megasaver/daemon";
import { tokenSaverModeSchema } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { readSessionIntent } from "./intent-run.js";
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

const DAEMON_TIMEOUT_MS = 1500; // ponytail: short timeout; a hung socket must not stall the hook

/** Try to forward to the running daemon's /excerpt; fall back to in-process on any failure.
 *  Exported for tests. Never throws — every failure mode returns in-process result. */
export function makeRecord(storeRoot: string): SaverDeps["record"] {
  return async (input: RecordOverlayOutputInput): Promise<RecordOverlayOutputResult> => {
    try {
      const handle = await getRunningDaemon({ storeRoot });
      if (handle !== null) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
        try {
          const {
            storeRoot: _sr,
            evidenceStoreRoot: _esr,
            now: _now,
            newId: _nid,
            ...daemonBody
          } = input;
          // ponytail: daemon excerptHandler supplies storeRoot itself; do NOT add evidenceStoreRoot
          const res = await handle.request("POST", "/excerpt", daemonBody, controller.signal);
          clearTimeout(timer);
          if (res.ok) {
            return (await res.json()) as RecordOverlayOutputResult;
          }
        } catch {
          clearTimeout(timer);
        }
      }
    } catch {
      // fall through to in-process
    }
    return recordAndFilterOverlayOutput(input);
  };
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
    const deps: SaverDeps = { storeRoot, readSettings, readSessionIntent, record: makeRecord(storeRoot) };
    const decision = await buildSaverDecision(payload, deps);
    const s = renderSaverStdout(decision);
    if (s !== "") process.stdout.write(s);
  } catch {
    // Swallow — best-effort; original output reaches the model.
  }
}
