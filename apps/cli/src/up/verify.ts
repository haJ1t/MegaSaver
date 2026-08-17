import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { hookCommandMatches } from "@megasaver/connector-claude-code";
import { readHeartbeatView } from "@megasaver/context-gate";
import { readDiscovery } from "@megasaver/daemon";

export type UpVerifyDeps = {
  spawn: (
    cmd: string,
    stdinJson: string,
    timeoutMs: number,
  ) => { status: number | null; stdout?: string; error?: string };
  now: () => number;
};

export type UpVerifyResult = {
  saver:
    | { kind: "observed"; detail: string }
    | { kind: "failed"; detail: string }
    | { kind: "not-probeable"; detail: string };
  passive: string[];
  daemon: string;
};

function findSaverCommand(settingsPath: string): string | null {
  if (!existsSync(settingsPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8"));
    const post = raw.hooks?.PostToolUse;
    if (!Array.isArray(post)) return null;
    for (const entry of post) {
      if (Array.isArray(entry.hooks)) {
        for (const h of entry.hooks) {
          if (typeof h.command === "string" && hookCommandMatches(h.command, "saver")) {
            return h.command;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function newestTs(map: Record<string, string> | undefined): string | null {
  if (map === undefined) return null;
  let newest: string | null = null;
  for (const val of Object.values(map)) {
    if (newest === null || Date.parse(val) > Date.parse(newest)) {
      newest = val;
    }
  }
  return newest;
}

export function runUpVerify(input: {
  settingsPath: string;
  storeRoot: string;
  cwd: string;
  deps: UpVerifyDeps;
}): UpVerifyResult {
  const passive = [
    "intent:    installed, not yet observed — run a Claude Code session; check `mega hooks status`",
    "warmup:    installed, not yet observed — run a Claude Code session; check `mega hooks status`",
    "capsule:   installed, not yet observed — run a Claude Code session; check `mega hooks status`",
    "guard:     installed, not yet observed — run a Claude Code session; check `mega hooks status`",
  ];

  let daemon = "not running (in-process fallback — by design)";
  try {
    const disc = readDiscovery(input.storeRoot);
    if (disc !== null) {
      daemon = `running (pid ${disc.pid}, port ${disc.port})`;
    }
  } catch {
    // daemon read failure is non-fatal
  }

  const saverCmd = findSaverCommand(input.settingsPath);
  if (saverCmd === null) {
    return {
      saver: { kind: "not-probeable", detail: "no registered saver hook found" },
      passive,
      daemon,
    };
  }

  const beforeView = readHeartbeatView(input.storeRoot, input.deps.now());
  const beforeInv = beforeView.latest?.ts ?? null;
  const beforeComp = newestTs(beforeView.completions);

  const payload = JSON.stringify({
    session_id: `up-verify-${randomUUID()}`,
    tool_name: "Bash",
    cwd: input.cwd,
    tool_response: { stdout: "x".repeat(200), stderr: "" },
  });

  const res = input.deps.spawn(saverCmd, payload, 5000);
  if (res.status !== 0) {
    return {
      saver: {
        kind: "failed",
        detail: `probe exit ${res.status ?? "timeout"}${res.error ? ` (${res.error})` : ""} — run: mega hooks install`,
      },
      passive,
      daemon,
    };
  }

  const afterView = readHeartbeatView(input.storeRoot, input.deps.now());
  const afterInv = afterView.latest?.ts ?? null;
  const afterComp = newestTs(afterView.completions);

  const invAdvanced =
    afterInv !== null && (beforeInv === null || Date.parse(afterInv) > Date.parse(beforeInv));
  const compAdvanced =
    afterComp !== null && (beforeComp === null || Date.parse(afterComp) > Date.parse(beforeComp));

  if (invAdvanced && compAdvanced) {
    return {
      saver: {
        kind: "observed",
        detail: `heartbeat advanced (${afterInv})`,
      },
      passive,
      daemon,
    };
  }

  return {
    saver: {
      kind: "failed",
      detail: invAdvanced
        ? "exit 0 but no completion heartbeat — check store wiring (run: mega hooks install)"
        : "exit 0 but no heartbeat advance — check store wiring (run: mega hooks install)",
    },
    passive,
    daemon,
  };
}
