import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CAPSULE_FILENAME } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import {
  type WorkStateCapsule,
  capsulePath,
  renderCapsuleContext,
  workStateCapsuleSchema,
} from "./capsule.js";
import { SAFE_SEGMENT } from "./intent-run.js";

const sessionStartPayloadSchema = z
  .object({ session_id: z.string().min(1), cwd: z.string().min(1), source: z.string() })
  .passthrough();

export const RECAP_FALLBACK_WINDOW_MS = 15 * 60_000;

function readCapsuleAt(path: string): WorkStateCapsule | null {
  try {
    const parsed = workStateCapsuleSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Exact session first; else the newest capsule in this workspace captured
// within the window (ASSUMPTION: post-compact session_id may differ — spec
// Error handling; the window bounds wrong-session injection).
export function loadCapsule(
  storeRoot: string,
  workspaceKey: string,
  liveSessionId: string,
  now: () => number,
): WorkStateCapsule | null {
  if (SAFE_SEGMENT.test(liveSessionId)) {
    const exact = readCapsuleAt(capsulePath(storeRoot, workspaceKey, liveSessionId));
    if (exact !== null) return exact;
  }
  let dirs: string[];
  try {
    dirs = readdirSync(join(storeRoot, "content", workspaceKey));
  } catch {
    return null;
  }
  let best: WorkStateCapsule | null = null;
  for (const dir of dirs) {
    const candidate = readCapsuleAt(
      join(storeRoot, "content", workspaceKey, dir, CAPSULE_FILENAME),
    );
    if (candidate === null) continue;
    const age = now() - Date.parse(candidate.capturedAt);
    if (Number.isNaN(age) || age < 0 || age > RECAP_FALLBACK_WINDOW_MS) continue;
    if (best === null || candidate.capturedAt > best.capturedAt) best = candidate;
  }
  return best;
}

// Pure-ish core, extracted for tests. Contract: NEVER throws — every failure
// returns "" so the SessionStart hook can never block a session.
export function buildRecapHookOutput(input: {
  payload: unknown;
  storeRoot: string;
  now: () => number;
}): string {
  try {
    const parsed = sessionStartPayloadSchema.safeParse(input.payload);
    if (!parsed.success || parsed.data.source !== "compact") return "";
    const workspaceKey = encodeWorkspaceKey(parsed.data.cwd);
    const found = loadCapsule(input.storeRoot, workspaceKey, parsed.data.session_id, input.now);
    if (found === null) return "";
    return renderCapsuleContext(found);
  } catch {
    return "";
  }
}

export function renderRecapStdout(text: string): string {
  if (text === "") return "";
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
  });
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure ("no output" = no injection).
export async function runRecapHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const s = renderRecapStdout(
      buildRecapHookOutput({ payload, storeRoot, now: () => Date.now() }),
    );
    if (s !== "") process.stdout.write(s);
  } catch {
    // Swallow — fail-open.
  }
}
