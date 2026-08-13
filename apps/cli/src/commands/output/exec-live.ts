import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  type RunCommandSpawn,
  nodeResolverDeps,
  resolveWorkspaceTokenSaverSettings,
  runChild,
} from "@megasaver/context-gate";
import type { RecordOverlayOutputInput, RecordOverlayOutputResult } from "@megasaver/core";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { classifyExecRewrite } from "../../hooks/exec-rewrite-command.js";
import { readSessionIntent } from "../../hooks/intent-run.js";
import { makeRecord } from "../../hooks/saver-run.js";
import { minBytesFor } from "../../hooks/saver.js";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DEFAULT_TIMEOUT_SEC = 600; // LD11: >= Claude Code Bash tool max — the tool's own timeout stays the governing bound
const DEFAULT_MAX_BYTES = 100_000_000; // LD15: kill-vs-truncate deviation documented in spec
// LD16: the client truncates Bash output at ~30 000 chars (saver.ts B9) and
// the recovery footer is the LAST bytes of the delivered text — a compressed
// delivery above the cap would lose its recovery pointer with it. Fall back to
// raw byte-identical delivery when compressed+footer exceeds this ceiling
// (evidence stays persisted via storeRawOutput; the model sees native
// truncation, never truncated-compressed-without-pointer).
export const EXEC_LIVE_MAX_DELIVERED_CHARS = 28_000;
// intent-run.ts SAFE_SEGMENT: path-safe live session ids only.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=,-]+$/;

// LD13 boundary: the joined-string classification is tokenization-equivalent
// for hook-emitted input, but a manual caller could pass one argv element
// containing whitespace — the classifier would split it into safe tokens the
// child never received. Reject non-SAFE_TOKEN elements so the spawned argv is
// exactly what the classifier approved.
function argvIsGrammarSafe(command: string, args: readonly string[]): boolean {
  return [command, ...args].every((token) => SAFE_TOKEN.test(token));
}

export function parseExecLiveNumericArgs(
  timeout: unknown,
  maxBytes: unknown,
): {
  timeoutSec?: number;
  maxBytes?: number;
} {
  const timeoutSec = typeof timeout === "string" && timeout !== "" ? Number(timeout) : undefined;
  const maxBytesArg =
    typeof maxBytes === "string" && maxBytes !== "" ? Number(maxBytes) : undefined;
  return {
    // A non-positive bound would kill the child instantly (runChild's timer) —
    // a value the CLI must reject, not pass through (LD6 parity).
    ...(timeoutSec !== undefined && Number.isFinite(timeoutSec) && timeoutSec > 0
      ? { timeoutSec }
      : {}),
    ...(maxBytesArg !== undefined && Number.isFinite(maxBytesArg) && maxBytesArg > 0
      ? { maxBytes: maxBytesArg }
      : {}),
  };
}

export type RunOutputExecLiveInput = {
  liveSessionId: string;
  command: string;
  args: readonly string[];
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  originPid: string;
  // Raw text sink — implementations must NOT append a newline (byte parity).
  stdout: (text: string) => void;
  stderr: (line: string) => void;
  timeoutSec?: number;
  maxBytes?: number;
  spawn?: RunCommandSpawn;
  runChildImpl?: typeof runChild;
  record?: (input: RecordOverlayOutputInput) => Promise<RecordOverlayOutputResult>;
};

export function execLiveCommandFromPositionals(positionals: readonly unknown[]): {
  command: string;
  commandArgs: string[];
} {
  const rest = positionals.map(String);
  return { command: rest[0] ?? "", commandArgs: rest.slice(1) };
}

// LD6 semantics-parity invariant: the child ALWAYS runs and its exit code is
// ALWAYS mirrored; everything mega-internal (store resolve, settings, record,
// daemon) sits inside one try/catch whose fallback is raw byte-identical
// delivery. The rewrite may improve delivery, never behavior.
export async function runOutputExecLive(input: RunOutputExecLiveInput): Promise<number> {
  // LD13: the flat-token allowlist is a structural invariant of THIS delivery
  // path, not a caller honor-system — runChild performs no policy check.
  const classified = classifyExecRewrite([input.command, ...input.args].join(" "));
  if (classified === null || !argvIsGrammarSafe(input.command, input.args)) {
    input.stderr("error: refused: command not allowlisted");
    return 1;
  }
  const run = input.runChildImpl ?? runChild;
  // Process creation stays in core: runChild defaults its own spawn.
  // Conditional spread, not `spawn: input.spawn` — exactOptionalPropertyTypes
  // rejects an explicit undefined (exec.ts:110 precedent).
  const outcome = await run({
    ...(input.spawn !== undefined ? { spawn: input.spawn } : {}),
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    originPid: input.originPid,
    timeoutMs: (input.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1_000,
    maxBytes: input.maxBytes ?? DEFAULT_MAX_BYTES,
  });
  if (!outcome.ok) {
    input.stderr(`error: command_failed: ${outcome.detail}`);
    return 1;
  }
  const { raw, terminated, childExitCode } = outcome.capture;

  let delivered = raw;
  try {
    if (SAFE_SEGMENT.test(input.liveSessionId)) {
      const storeRoot = resolveStorePath({
        storeFlag: input.storeFlag,
        cwd: input.cwd,
        home: input.home,
        xdgDataHome: input.xdgDataHome,
        platform: input.platform,
        localAppData: input.localAppData,
      });
      // Workspace identity is canonical-path keyed (cache-advice-run pattern):
      // getcwd always returns the resolved real path (/private/var/... on
      // macOS) while the hook-side payload cwd may keep a symlinked spelling
      // (/var/...); without canonicalization the two sides derive different
      // workspace keys and the settings gate silently fails closed.
      let canonicalCwd = input.cwd;
      try {
        canonicalCwd = await realpath(input.cwd);
      } catch {
        // Fall back to the raw spelling — identity, never behavior.
      }
      const settings = resolveWorkspaceTokenSaverSettings(
        storeRoot,
        canonicalCwd,
        nodeResolverDeps(),
      );
      if (settings.enabled) {
        const workspaceKey = encodeWorkspaceKey(canonicalCwd);
        const record = input.record ?? makeRecord(storeRoot);
        const intent = readSessionIntent(storeRoot, workspaceKey, input.liveSessionId);
        const result = await record({
          storeRoot,
          evidenceStoreRoot: storeRoot,
          workspaceKey,
          liveSessionId: input.liveSessionId,
          raw,
          sourceKind: "command",
          label: [input.command, ...input.args].join(" "),
          mode: settings.mode,
          storeRawOutput: true, // LD7 failure-tee: this path replaced the only copy
          includeFooter: true, // F30 recovery footer, accounted inside record
          compressFloorBytes: minBytesFor("Bash", settings.mode),
          origin: "exec-rewrite", // LD8 honest stats
          newId: () => `cs-${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`, // LD14: identical re-runs mint the same chunk-set id (saver.ts:425 pattern)
          ...(intent !== undefined ? { intent } : {}),
        });
        // Non-compressed decisions already return the raw byte-identical
        // (record-output.ts:260-271); pin `raw` locally so a drift there can
        // never change what the agent receives.
        if (
          result.decision === "compressed" &&
          result.returnedText.length <= EXEC_LIVE_MAX_DELIVERED_CHARS
        ) {
          delivered = result.returnedText;
        }
      }
    }
  } catch {
    delivered = raw; // LD6 parity fallback
  }

  input.stdout(delivered);
  if (terminated !== undefined) {
    input.stderr(`error: command_failed: terminated: ${terminated}`);
    return 1;
  }
  const exitCode = childExitCode ?? 0;
  if (exitCode !== 0) input.stderr(`note: command exited ${exitCode}`);
  return exitCode;
}

export const outputExecLiveCommand = defineCommand({
  meta: {
    name: "exec-live",
    description: "Run a rewritten agent command and deliver filtered output (hook target).",
  },
  args: {
    "live-session": {
      type: "string",
      required: true,
      description: "Live session id from the PreToolUse payload.",
    },
    store: { type: "string", description: "Override store directory." },
    timeout: {
      type: "string",
      description:
        "Max child wall-clock seconds (default 600; hook threads the tool's own timeout).",
    },
    "max-bytes": { type: "string", description: "Max bytes of child output captured." },
  },
  async run({ args }) {
    // ASSUMPTION: with no named positionals defined, citty's args._ is exactly
    // the post-`--` token list (exec.ts:18-24 documents that consumed
    // positionals ALSO land in _, which is why exec reads [1]; here there are
    // none, so [0] is the command). Covered by execLiveCommandFromPositionals
    // unit tests; verify once against a real `mega output exec-live` run in
    // the Task 8 smoke.
    const { command, commandArgs } = execLiveCommandFromPositionals(args._ ?? []);
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    const inherited = process.env["MEGASAVER_ORIGIN_PID"];
    const { timeoutSec, maxBytes } = parseExecLiveNumericArgs(args.timeout, args["max-bytes"]);
    const code = await runOutputExecLive({
      liveSessionId: typeof args["live-session"] === "string" ? args["live-session"] : "",
      command,
      args: commandArgs,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      originPid: inherited && inherited !== "" ? inherited : String(process.pid),
      stdout: (text) => process.stdout.write(text), // write(), no added newline
      stderr: (line) => console.error(line),
      ...(timeoutSec !== undefined ? { timeoutSec } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    });
    if (code !== 0) process.exitCode = code;
  },
});
