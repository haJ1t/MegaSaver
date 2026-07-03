import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANAGED_LABEL = "com.megasaver.proxy";
// Argv tails that classify a job/plist. The managed job runs `proxy supervise`;
// the legacy operator-installed job runs `proxy start`.
const MANAGED_TAIL = ["proxy", "supervise"];
const LEGACY_TAIL = ["proxy", "start"];

export type LaunchctlJob = { loaded: boolean; programArguments: string[] } | null;

// Injected so tests never touch real launchd. On macOS the CLI supplies a runner
// backed by `launchctl print/bootout/bootstrap/kickstart`.
export type LaunchctlRunner = {
  print(label: string): LaunchctlJob;
  bootout(label: string): void;
  bootstrap(plistPath: string): void;
  kickstart(label: string, force: boolean): void;
};

export type LaunchAgentDeps = {
  plistPath: string;
  backupDir: string;
  runner: LaunchctlRunner;
  superviseArgv: string[];
};

function xmlEscape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// Structured serializer: fixed label + argv array, no shell, no interpolation.
export function renderLaunchAgentPlist(input: {
  label: string;
  programArguments: string[];
}): string {
  const args = input.programArguments.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
</dict>
</plist>
`;
}

// Does `argv` contain `sub` as a run of consecutive elements? (The `proxy
// supervise`/`proxy start` marker sits mid-argv, before trailing flags.)
function containsRun(argv: string[], sub: string[]): boolean {
  for (let i = 0; i + sub.length <= argv.length; i++) {
    if (sub.every((s, j) => argv[i + j] === s)) return true;
  }
  return false;
}

type Kind = "managed" | "legacy" | "foreign";
function classifyArgv(argv: string[]): Kind {
  if (containsRun(argv, MANAGED_TAIL)) return "managed";
  if (containsRun(argv, LEGACY_TAIL)) return "legacy";
  return "foreign";
}

// Read a plist file's ProgramArguments (best-effort) to classify it by argv.
function classifyPlistFile(path: string): "absent" | Kind {
  if (!existsSync(path)) return "absent";
  let xml: string;
  try {
    xml = readFileSync(path, "utf8");
  } catch {
    return "foreign";
  }
  const argv = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] ?? "");
  return classifyArgv(argv);
}

function backup(plistPath: string, backupDir: string): void {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  renameSync(plistPath, join(backupDir, `com.megasaver.proxy.${randomUUID()}.plist`));
}

function install(deps: LaunchAgentDeps): void {
  mkdirSync(join(deps.plistPath, ".."), { recursive: true });
  writeFileSync(
    deps.plistPath,
    renderLaunchAgentPlist({ label: MANAGED_LABEL, programArguments: deps.superviseArgv }),
    { mode: 0o644 },
  );
  deps.runner.bootstrap(deps.plistPath);
}

export type EnsureServiceResult =
  | { status: "legacy_service_present"; instruction: string }
  | { status: "installed" }
  | { status: "already_managed" }
  | { status: "blocked"; reason: string };

// MegaSaver never stops a process it did not start. A loaded legacy job is
// refused with a manual bootout instruction; the operator retries after removing
// it. An unloaded legacy plist FILE (not a running process) may be backed up and
// replaced. A foreign job/plist is never touched.
export function ensureManagedService(deps: LaunchAgentDeps): EnsureServiceResult {
  const job = deps.runner.print(MANAGED_LABEL);
  if (job !== null) {
    const kind = classifyArgv(job.programArguments);
    if (kind === "legacy")
      return {
        status: "legacy_service_present",
        instruction: `A legacy MegaSaver proxy service is loaded. Stop it, then retry: launchctl bootout gui/$UID/${MANAGED_LABEL}`,
      };
    if (kind === "managed") return { status: "already_managed" };
    return { status: "blocked", reason: "foreign launchd job under the managed label" };
  }
  // Not loaded — decide from the on-disk plist file.
  const file = classifyPlistFile(deps.plistPath);
  if (file === "foreign")
    return { status: "blocked", reason: "foreign plist under the managed label" };
  if (file === "legacy") backup(deps.plistPath, deps.backupDir);
  install(deps);
  return { status: "installed" };
}

export type UninstallResult = { status: "uninstalled" } | { status: "blocked"; reason: string };

// Removes ONLY a managed job/plist. A dormant managed job is booted out and its
// plist moved to backup (never deleted). A foreign or unknown shape is refused.
export function uninstallManagedService(deps: LaunchAgentDeps): UninstallResult {
  const job = deps.runner.print(MANAGED_LABEL);
  if (job !== null) {
    if (classifyArgv(job.programArguments) !== "managed")
      return { status: "blocked", reason: "loaded job is not the managed service" };
    deps.runner.bootout(MANAGED_LABEL);
  }
  const file = classifyPlistFile(deps.plistPath);
  if (file === "foreign")
    return { status: "blocked", reason: "foreign plist under the managed label" };
  if (file === "managed" || file === "legacy") backup(deps.plistPath, deps.backupDir);
  return { status: "uninstalled" };
}

// Real macOS launchctl runner. `print` parses the ProgramArguments from
// `launchctl print`; a non-zero exit (not loaded) yields null.
export const nodeLaunchctlRunner: LaunchctlRunner = {
  print(label) {
    try {
      const out = execFileSync("launchctl", ["print", `gui/${process.getuid?.() ?? 0}/${label}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const block = out.slice(out.indexOf("arguments = {"));
      const argv = [...block.matchAll(/^\s*(\S.*)$/gm)]
        .map((m) => (m[1] ?? "").trim())
        .filter((l) => l !== "arguments = {" && l !== "}" && l !== "");
      return { loaded: true, programArguments: argv };
    } catch {
      return null;
    }
  },
  bootout(label) {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 0}/${label}`], {
      stdio: "ignore",
    });
  },
  bootstrap(plistPath) {
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath], {
      stdio: "ignore",
    });
  },
  kickstart(label, force) {
    execFileSync(
      "launchctl",
      ["kickstart", ...(force ? ["-k"] : []), `gui/${process.getuid?.() ?? 0}/${label}`],
      { stdio: "ignore" },
    );
  },
};
