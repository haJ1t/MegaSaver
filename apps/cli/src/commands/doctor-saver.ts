import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, accessSync, existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { hookCommandMatches } from "@megasaver/connector-claude-code";
import { readHeartbeatView } from "@megasaver/context-gate";
import { readDiscovery } from "@megasaver/daemon";
import { readStoreEnv, resolveStorePath } from "../store.js";
import type { Check } from "./doctor.js";
import { resolveClaudeCodeSettingsPath } from "./hooks/settings-path.js";

export type DoctorSaverDeps = {
  settingsPath?: string; // default ~/.claude/settings.json
  storeRoot?: string; // default: the CLI's resolved store
  spawn?: (
    cmd: string,
    stdinJson: string,
    timeoutMs: number,
  ) => { status: number | null; stdout?: string; error?: string };
  now?: () => number;
  cliVersion?: string; // default: the running CLI's own version (E22.2)
};

const SELF_TEST_TIMEOUT_MS = 10_000;
// E22.3: invocation and completion are stamped microseconds apart in the same
// decide() call, so any latest-invocation newer than the latest-completion by
// more than this grace means the most recent activity never finished.
const LIVENESS_GAP_GRACE_MS = 5 * 60_000;
const REPAIR_HINT = "run: mega hooks install";

function newestTs(map: Record<string, string> | undefined): string | null {
  let newest: string | null = null;
  for (const ts of Object.values(map ?? {})) {
    if (newest === null || Date.parse(ts) > Date.parse(newest)) newest = ts;
  }
  return newest;
}

function defaultSpawn(
  cmd: string,
  stdinJson: string,
  timeoutMs: number,
): { status: number | null; stdout?: string; error?: string } {
  const r =
    process.platform === "win32"
      ? spawnSync(cmd, { shell: true, input: stdinJson, timeout: timeoutMs, encoding: "utf8" })
      : spawnSync("sh", ["-c", cmd], { input: stdinJson, timeout: timeoutMs, encoding: "utf8" });
  return {
    status: r.status,
    ...(typeof r.stdout === "string" ? { stdout: r.stdout } : {}),
    ...(r.error !== undefined ? { error: r.error.message } : {}),
  };
}

// Same version source as main.ts: the standalone bundle inlines
// __MEGA_CLI_VERSION__ at build time; the regular dist/cli.js bundle reads the
// sibling package.json ("../package.json" from dist/). Unresolvable (e.g.
// under vitest, where import.meta.url points into src/) → undefined, and the
// version sub-check is skipped — tests inject cliVersion explicitly.
declare const __MEGA_CLI_VERSION__: string | undefined;
function runningCliVersion(): string | undefined {
  if (typeof __MEGA_CLI_VERSION__ !== "undefined") return __MEGA_CLI_VERSION__;
  try {
    return (createRequire(import.meta.url)("../package.json") as { version: string }).version;
  } catch {
    return undefined;
  }
}

type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit";

function readSettingsSafe(settingsPath: string): unknown {
  if (!existsSync(settingsPath)) return null;
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    return null;
  }
}

function registeredCommand(settings: unknown, event: HookEvent, subcommand: string): string | null {
  if (typeof settings !== "object" || settings === null) return null;
  const entries = (settings as { hooks?: Record<string, unknown> }).hooks?.[event];
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const hooks = (entry as { hooks?: unknown }).hooks;
    if (!Array.isArray(hooks)) continue;
    for (const h of hooks) {
      const command = (h as { command?: unknown })?.command;
      if (typeof command === "string" && hookCommandMatches(command, subcommand)) return command;
    }
  }
  return null;
}

function firstToken(command: string): string {
  if (command.startsWith('"')) {
    const end = command.indexOf('"', 1);
    return end === -1 ? command : command.slice(1, end);
  }
  return command.split(/\s+/)[0] ?? "";
}

function bakedStore(command: string): string | null {
  const m = command.match(/--store\s+(?:"([^"]+)"|(\S+))/);
  return m === null ? null : (m[1] ?? m[2] ?? null);
}

// E22: doctor verifies the saver instead of trusting settings presence. WARN =
// pass:true + "warn:"-prefixed reason (never fails the exit code); FAIL =
// pass:false. No auto-fix — every finding prints its repair command.
export function runSaverChecks(deps: DoctorSaverDeps = {}): Check[] {
  const settingsPath = deps.settingsPath ?? resolveClaudeCodeSettingsPath();
  const storeRoot = deps.storeRoot ?? resolveStorePath(readStoreEnv(undefined));
  const spawn = deps.spawn ?? defaultSpawn;
  const now = deps.now ?? Date.now;
  const checks: Check[] = [];

  const settings = readSettingsSafe(settingsPath);
  const logCmd = registeredCommand(settings, "PreToolUse", "log");
  const saverCmd = registeredCommand(settings, "PostToolUse", "saver");
  const intentCmd = registeredCommand(settings, "UserPromptSubmit", "intent");

  // E22.1 registration — a missing saver is a FAIL; a missing telemetry/intent
  // hook or a bare PATH-dependent command is a warning.
  if (saverCmd === null) {
    checks.push({
      key: "saver-hooks-registered",
      value: "saver hook missing",
      pass: false,
      reason: REPAIR_HINT,
    });
  } else {
    const present = [logCmd, saverCmd, intentCmd].filter((c) => c !== null).length;
    const bare = firstToken(saverCmd) === "mega";
    checks.push({
      key: "saver-hooks-registered",
      value: `${present}/3`,
      pass: true,
      ...(present < 3
        ? { reason: `warn: log/intent hook missing — ${REPAIR_HINT}` }
        : bare
          ? { reason: `warn: bare "mega" command is PATH-dependent — ${REPAIR_HINT}` }
          : {}),
    });
  }

  if (saverCmd !== null) {
    // E22.2 binary — only checkable when the registered command is a path.
    const bin = firstToken(saverCmd);
    if (bin === "mega") {
      checks.push({ key: "saver-hook-binary", value: "skipped (bare command)", pass: true });
    } else {
      let ok = existsSync(bin);
      if (ok) {
        try {
          accessSync(bin, constants.X_OK);
        } catch {
          ok = false;
        }
      }
      checks.push(
        ok
          ? { key: "saver-hook-binary", value: bin, pass: true }
          : {
              key: "saver-hook-binary",
              value: `${bin} missing or not executable`,
              pass: false,
              reason: REPAIR_HINT,
            },
      );

      // E22.2 version sub-check: the registered binary's --version vs the
      // running CLI. WARN only — an upgrade lag is not a broken hook. Skipped
      // for bare commands (outer branch), when the CLI's own version is
      // unresolvable, or when the probe yields no output (a dead binary
      // already FAILed above).
      const cliVersion = deps.cliVersion ?? runningCliVersion();
      if (ok && cliVersion !== undefined) {
        const probe = spawn(`"${bin}" --version`, "", SELF_TEST_TIMEOUT_MS);
        const reported = probe.status === 0 ? (probe.stdout ?? "").trim() : "";
        if (reported !== "") {
          checks.push(
            reported === cliVersion
              ? { key: "saver-hook-version", value: reported, pass: true }
              : {
                  key: "saver-hook-version",
                  value: `hook ${reported} != cli ${cliVersion}`,
                  pass: true,
                  reason: `warn: version mismatch — ${REPAIR_HINT}`,
                },
          );
        }
      }
    }

    // E29 split-brain — the store baked into the command vs the CLI's store.
    // No bake means the hook resolves its own env default; only an explicit
    // divergent bake is a provable mismatch.
    const baked = bakedStore(saverCmd);
    checks.push(
      baked !== null && baked !== storeRoot
        ? {
            key: "saver-hook-store",
            value: `hook ${baked} != cli ${storeRoot}`,
            pass: true,
            reason: `warn: split-brain — ${REPAIR_HINT}`,
          }
        : { key: "saver-hook-store", value: baked ?? "default", pass: true },
    );
  }

  // E22.3 liveness from the heartbeat ledger.
  const view = readHeartbeatView(storeRoot, now());
  if (view.latest === null) {
    checks.push({
      key: "saver-liveness",
      value: "never fired",
      pass: true,
      reason: `warn: no invocation recorded — ${REPAIR_HINT}, then run any tool`,
    });
  } else {
    const failures = view.failures ?? {};
    const failing = Object.entries(failures).filter(([wk, f]) => {
      const completion = view.completions?.[wk];
      return (
        f.count > 0 && (completion === undefined || Date.parse(completion) <= Date.parse(f.lastAt))
      );
    });
    const totalFailures = Object.values(failures).reduce((n, f) => n + f.count, 0);
    const first = failing[0];
    // Per-workspace invocation-vs-completion gap: a recent invocation with no
    // (or a far-older) completion is a crash/timeout signal — the hook fired
    // but never finished. computeView already prunes stale invocations, so any
    // survivor here is recent enough that a missing completion is real.
    const gap = Object.entries(view.workspaces)
      .map(([wk, invIso]) => {
        const comp = view.completions?.[wk];
        return { wk, inv: Date.parse(invIso), comp: comp !== undefined ? Date.parse(comp) : null };
      })
      .find(({ inv, comp }) => comp === null || inv - comp > LIVENESS_GAP_GRACE_MS);
    if (first !== undefined) {
      const [wk, f] = first;
      checks.push({
        key: "saver-liveness",
        value: `failing (last ${f.lastKind} @ ${f.lastAt}, workspace ${wk})`,
        pass: false,
        reason: "no completion since the last failure — see: mega session saver resolve",
      });
    } else if (gap !== undefined) {
      const detail =
        gap.comp === null
          ? "with no completion"
          : `${gap.inv - gap.comp}ms ahead of last completion`;
      checks.push({
        key: "saver-liveness",
        value: `invocations not completing (crash/timeout signal, workspace ${gap.wk})`,
        pass: false,
        reason: `invocation ${detail} — run: mega doctor after the next tool call, or mega hooks install`,
      });
    } else if (totalFailures > 0) {
      checks.push({
        key: "saver-liveness",
        value: `last invocation ${view.latest.ts}`,
        pass: true,
        reason: `warn: ${totalFailures} past hook failure(s), since recovered`,
      });
    } else {
      checks.push({
        key: "saver-liveness",
        value: `last invocation ${view.latest.ts}`,
        pass: true,
      });
    }
  }

  // E22.4 self-test — spawn the EXACT registered command with a synthetic
  // payload against the real store; assert exit 0 AND a heartbeat bump.
  // The tiny stdout stays under every floor, so the store is never grown
  // beyond the invocation heartbeat; GC retention prunes selftest residue.
  //
  // Accepted side effect: this runs the real hook against the real store under
  // process.cwd(), so recordInvocation writes a persistent heartbeat under
  // encodeWorkspaceKey(process.cwd()). Hence after any `mega doctor` run, this
  // workspace's PASSIVE "last invocation" freshness (liveness / `resolve`) is
  // no longer null — it reflects doctor's own self-test, not just the user's
  // agent. Deliberate: the ACTIVE self-test (exit-0 + heartbeat-advance) is the
  // authoritative, honest-every-run signal and only fires once the hook is
  // proven registered; only the between-run passive hint is affected. A
  // sentinel-key fix was judged not worth the cost.
  if (saverCmd !== null) {
    const beforeView = readHeartbeatView(storeRoot, now());
    const before = beforeView.latest?.ts ?? null;
    const beforeComp = newestTs(beforeView.completions);
    const payload = JSON.stringify({
      session_id: `doctor-selftest-${randomUUID()}`,
      tool_name: "Bash",
      cwd: process.cwd(),
      tool_response: { stdout: "x".repeat(200), stderr: "" },
    });
    const r = spawn(saverCmd, payload, SELF_TEST_TIMEOUT_MS);
    if (r.status !== 0) {
      checks.push({
        key: "saver-self-test",
        value: `exit ${r.status ?? "timeout"}${r.error !== undefined ? ` (${r.error})` : ""}`,
        pass: false,
        reason: REPAIR_HINT,
      });
    } else {
      const afterView = readHeartbeatView(storeRoot, now());
      const after = afterView.latest?.ts ?? null;
      const afterComp = newestTs(afterView.completions);
      const invAdvanced =
        after !== null && (before === null || Date.parse(after) > Date.parse(before));
      // A working hook records a completion on every non-throwing finish
      // (including passthrough); a stamp-then-die records only the invocation.
      const compAdvanced =
        afterComp !== null &&
        (beforeComp === null || Date.parse(afterComp) > Date.parse(beforeComp));
      checks.push(
        invAdvanced && compAdvanced
          ? { key: "saver-self-test", value: "exit 0, heartbeat advanced", pass: true }
          : {
              key: "saver-self-test",
              value: invAdvanced ? "exit 0 but no completion heartbeat" : "exit 0 but no heartbeat",
              pass: false,
              reason: invAdvanced
                ? `hook fired but never recorded a completion (crash/timeout after invocation) — check store wiring (${REPAIR_HINT})`
                : `hook ran but wrote no invocation heartbeat — check store wiring (${REPAIR_HINT})`,
            },
      );
    }
  }

  // E22.5 daemon — informational only; in-process fallback is by design.
  const disc = readDiscovery(storeRoot);
  checks.push({
    key: "saver-daemon",
    value:
      disc === null
        ? "not running (in-process fallback — by design)"
        : `running (pid ${disc.pid}, port ${disc.port})`,
    pass: true,
  });

  return checks;
}
