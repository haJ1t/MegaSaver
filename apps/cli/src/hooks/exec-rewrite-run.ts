import { readFileSync, realpathSync } from "node:fs";
import { nodeResolverDeps, resolveWorkspaceTokenSaverSettings } from "@megasaver/context-gate";
import { z } from "zod";
import { resolveInvokedCliPath } from "../commands/hooks/install.js";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { classifyExecRewrite } from "./exec-rewrite-command.js";

const preToolUsePayloadSchema = z
  .object({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    tool_input: z.unknown(),
  })
  .passthrough();

// intent-run.ts SAFE_SEGMENT: the id is interpolated into a shell string and
// later into store paths — reject anything not path/shell-inert.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// LD10: the launcher and store paths are never shell-quoted; a path must be
// shell-inert (SAFE_TOKEN-class) or the rewrite declines entirely.
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

export type BuildExecRewriteHookInput = {
  payload: unknown;
  storeRoot: string;
  cliPath?: string;
  storeFlag?: string;
};

// Contract identical to buildGuardHookOutput: NEVER throws — every failure
// returns "" so a PreToolUse hook can never break a tool call (the original
// command runs untouched).
export function buildExecRewriteHookOutput(input: BuildExecRewriteHookInput): string {
  try {
    const parsed = preToolUsePayloadSchema.safeParse(input.payload);
    if (!parsed.success) return "";
    const { session_id: sessionId, cwd, tool_name: tool } = parsed.data;
    if (tool !== "Bash") return "";
    if (!SAFE_SEGMENT.test(sessionId)) return "";
    const ti =
      typeof parsed.data.tool_input === "object" && parsed.data.tool_input !== null
        ? (parsed.data.tool_input as Record<string, unknown>)
        : {};
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const command = ti["command"];
    if (typeof command !== "string" || command === "") return "";
    const classified = classifyExecRewrite(command);
    if (classified === null) return "";
    // LD9 gate (b): workspace saver enablement. Workspace identity is
    // canonical-path keyed — canonicalize the payload cwd here so the gate
    // agrees with exec-live, whose getcwd is always the resolved real path
    // (macOS /var vs /private/var). Fallback to the raw spelling on failure.
    let canonicalCwd = cwd;
    try {
      canonicalCwd = realpathSync(cwd);
    } catch {
      // Identity, never behavior.
    }
    const settings = resolveWorkspaceTokenSaverSettings(
      input.storeRoot,
      canonicalCwd,
      nodeResolverDeps(),
    );
    if (!settings.enabled) return "";
    // LD10: SAFE_TOKEN-only paths, decline otherwise (no quoting anywhere).
    const launcher = input.cliPath === undefined ? "mega" : input.cliPath;
    if (!SAFE_TOKEN.test(launcher)) return "";
    const storeFlag = input.storeFlag;
    if (storeFlag !== undefined && !SAFE_TOKEN.test(storeFlag)) return "";
    const store = storeFlag === undefined ? "" : ` --store ${storeFlag}`;
    // LD11: thread the tool's own timeout (ms) as the exec-live ceiling.
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const toolTimeout = ti["timeout"];
    const timeout =
      typeof toolTimeout === "number" && Number.isFinite(toolTimeout) && toolTimeout > 0
        ? ` --timeout ${Math.ceil(toolTimeout / 1000)}`
        : "";
    // Tokens are SAFE_TOKEN-classed (LD5), the session id SAFE_SEGMENT-checked,
    // the launcher/store SAFE_TOKEN-gated — no injection surface beyond what
    // the agent already typed.
    const rewritten = `${launcher} output exec-live --live-session ${sessionId}${store}${timeout} -- ${[
      classified.command,
      ...classified.args,
    ].join(" ")}`;
    // LD2: updatedInput ONLY — never permissionDecision; the permission system
    // evaluates the rewritten command itself. FULL-REPLACEMENT contract: echo
    // every unchanged tool_input field (e.g. `description`) alongside the
    // rewritten command.
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...ti, command: rewritten },
      },
    });
  } catch {
    return "";
  }
}

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// Always exits 0; empty stdout on any failure (PreToolUse "no output" = no
// rewrite, tool call proceeds untouched). Wired by `mega hooks install`.
export function runExecRewriteHookFromProcess(storeFlag?: string): void {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const cliPath = resolveInvokedCliPath(process.argv[1]);
    const text = buildExecRewriteHookOutput({
      payload,
      storeRoot,
      ...(cliPath !== undefined ? { cliPath } : {}),
      ...(storeFlag !== undefined ? { storeFlag } : {}),
    });
    if (text !== "") process.stdout.write(text);
  } catch {
    // Swallow — fail-open.
  }
}
