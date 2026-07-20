import { execFileSync } from "node:child_process";
import type { ApplySaver } from "./transform.js";

// Runs the REAL shipped saver the way Claude Code does — spawn the hook binary,
// PostToolUse payload on stdin, decision JSON on stdout. Measuring a
// reimplementation would prove nothing about the product.
export type RunHook = (payloadJson: string) => string;

// The mode changes compression floors (modeToBudget in @megasaver/shared), so it
// is what the benchmark varies — never a hardcoded default.
export type SaverMode = "safe" | "balanced" | "aggressive";

// Tool outputs replayed through this hook run to hundreds of KB (raw Bash/Read/
// Grep output before compression); the Node default maxBuffer (1MB) risks
// truncating the hook's stdout on a big one. A truncated decision fails
// JSON.parse — which now THROWS rather than degrading to a passthrough, but the
// ceiling is still set generously above the observed floor (BASH_COMPRESS_FLOOR
// is 24_000 bytes; real raw payloads run well past that).
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;

// `mega hooks saver` takes no --store flag (apps/cli/src/commands/hooks/saver.ts
// calls runSaverHookFromProcess() with no args); it always resolves its store via
// resolveStorePath(readStoreEnv(undefined)) (apps/cli/src/store.ts). That function
// checks XDG_DATA_HOME before HOME on every platform (win32 is a separate branch
// entirely), so overriding XDG_DATA_HOME is sufficient — and the only knob — to
// point the hook's first-sight ledger and auto-pause verdict at an isolated
// store instead of the operator's real ~/.local/share/megasaver.
function megaEnv(storeRoot: string): NodeJS.ProcessEnv {
  return { ...process.env, XDG_DATA_HOME: storeRoot };
}

function defaultRun(megaBin: string, cwd: string, storeRoot: string): RunHook {
  return (payloadJson) =>
    execFileSync(megaBin, ["hooks", "saver"], {
      input: payloadJson,
      cwd,
      env: megaEnv(storeRoot),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
    });
}

// An isolated store is a FRESH store, and a fresh store has no saver settings —
// the hook resolves to "disabled (safe) — source missing" and passes everything
// through. Without this seeding step the megasaver arm is silently a second
// baseline and the harness reports costRatio ≈ 1.00 as a clean "no effect"
// measurement. Seeding is therefore not enough on its own: the enable is read
// back through the hook's OWN resolution path (`session saver resolve`, from the
// replay cwd) and a mismatch aborts.
export function prepareSaverStore(input: {
  megaBin: string;
  cwd: string;
  storeRoot: string;
  mode: SaverMode;
}): void {
  const run = (args: readonly string[]): string =>
    execFileSync(input.megaBin, [...args], {
      cwd: input.cwd,
      env: megaEnv(input.storeRoot),
      encoding: "utf8",
      maxBuffer: MAX_BUFFER_BYTES,
    });

  try {
    run(["session", "saver", "default", "enable", "--mode", input.mode, "--json"]);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `prepareSaverStore: could not enable the saver in ${input.storeRoot}: ${reason}`,
      { cause },
    );
  }

  let resolved: { enabled?: unknown; mode?: unknown };
  try {
    resolved = JSON.parse(run(["session", "saver", "resolve", "--json"]));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `prepareSaverStore: could not read back the saver activation in ${input.storeRoot}: ${reason}`,
      { cause },
    );
  }
  if (resolved.enabled !== true || resolved.mode !== input.mode) {
    throw new Error(
      `prepareSaverStore: saver is not active in ${input.storeRoot} for cwd ${input.cwd} — resolved enabled=${String(resolved.enabled)} mode=${String(resolved.mode)}, expected enabled=true mode=${input.mode}`,
    );
  }
}

export function makeSpawnedSaver(input: {
  megaBin: string;
  cwd: string;
  sessionId: string;
  storeRoot: string;
  run?: RunHook;
}): ApplySaver {
  const run = input.run ?? defaultRun(input.megaBin, input.cwd, input.storeRoot);

  return (rawToolResult, ctx) => {
    const payload = JSON.stringify({
      session_id: input.sessionId,
      cwd: input.cwd,
      tool_name: ctx.toolName,
      tool_input: ctx.toolInput,
      // A bare string is one of the shapes readOutputShape accepts (apps/cli/src/
      // hooks/saver.ts) and it is the honest one here: a recording preserves a
      // single blob of tool_result text with no stdout/stderr split to
      // reconstruct. Shape only decides where the hook FINDS the text — the
      // decision itself turns on tool_name (floor + sourceKind) and tool_input
      // (chunk-set label) — so a bare string measures the same compression a
      // shape-faithful payload would, and can never be misread as empty.
      tool_response: rawToolResult,
    });
    // No try/catch: a spawn failure, a non-zero exit or a maxBuffer overrun means
    // the saver was never consulted. Swallowing it into `null` is what let an
    // inert megasaver arm masquerade as "the saver has no effect".
    const out = run(payload);
    if (out.trim() === "") return null; // genuine passthrough: the hook emits nothing
    let parsed: { hookSpecificOutput?: { updatedToolOutput?: unknown } };
    try {
      parsed = JSON.parse(out);
    } catch (cause) {
      throw new Error(
        `makeSpawnedSaver: unparseable hook decision for ${ctx.toolName} (${ctx.toolUseId}): ${out.slice(0, 200)}`,
        { cause },
      );
    }
    const updated = parsed.hookSpecificOutput?.updatedToolOutput;
    if (updated === undefined) return null;
    if (typeof updated !== "string") {
      throw new Error(
        `makeSpawnedSaver: hook returned a non-string updatedToolOutput for ${ctx.toolName} (${ctx.toolUseId}) — a bare-string tool_response must round-trip as a bare string`,
      );
    }
    return updated;
  };
}
