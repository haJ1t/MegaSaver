import { execFileSync } from "node:child_process";
import type { ApplySaver } from "./transform.js";

// Runs the REAL shipped saver the way Claude Code does — spawn the hook binary,
// PostToolUse payload on stdin, decision JSON on stdout. Measuring a
// reimplementation would prove nothing about the product.
export type RunHook = (payloadJson: string) => string;

// Tool outputs replayed through this hook run to hundreds of KB (raw Bash/Read/
// Grep output before compression); the Node default maxBuffer (1MB) risks
// truncating the hook's stdout on a big one. A truncated decision fails JSON.parse
// and silently becomes a passthrough (see the catch below), which would bias the
// benchmark toward "no effect" — so the ceiling is set generously above the
// observed floor (BASH_COMPRESS_FLOOR is 24_000 bytes; real raw payloads run well
// past that).
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

// `mega hooks saver` takes no --store flag (apps/cli/src/commands/hooks/saver.ts
// calls runSaverHookFromProcess() with no args); it always resolves its store via
// resolveStorePath(readStoreEnv(undefined)) (apps/cli/src/store.ts). That function
// checks XDG_DATA_HOME before HOME on every platform (win32 is a separate branch
// entirely), so overriding XDG_DATA_HOME is sufficient — and the only knob — to
// point the hook's first-sight ledger and auto-pause verdict at an isolated
// store instead of the operator's real ~/.local/share/megasaver.
function defaultRun(megaBin: string, cwd: string, storeRoot: string): RunHook {
  return (payloadJson) =>
    execFileSync(megaBin, ["hooks", "saver"], {
      input: payloadJson,
      cwd,
      env: { ...process.env, XDG_DATA_HOME: storeRoot },
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
    });
}

export function makeSpawnedSaver(input: {
  megaBin: string;
  cwd: string;
  sessionId: string;
  storeRoot: string;
  run?: RunHook;
}): ApplySaver {
  const run = input.run ?? defaultRun(input.megaBin, input.cwd, input.storeRoot);

  return (rawToolResult) => {
    const payload = JSON.stringify({
      session_id: input.sessionId,
      cwd: input.cwd,
      tool_name: "Bash",
      tool_input: { command: "replay" },
      tool_response: { stdout: rawToolResult, stderr: "" },
    });
    let out: string;
    try {
      out = run(payload);
    } catch {
      return null; // hook failed → treat as passthrough, same as production
    }
    try {
      const parsed = JSON.parse(out) as {
        hookSpecificOutput?: { updatedToolOutput?: { stdout?: unknown } };
      };
      const stdout = parsed.hookSpecificOutput?.updatedToolOutput?.stdout;
      return typeof stdout === "string" ? stdout : null;
    } catch {
      return null;
    }
  };
}
