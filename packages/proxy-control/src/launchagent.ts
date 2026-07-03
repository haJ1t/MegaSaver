import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

function expectedManagedPlist(superviseArgv: string[]): string {
  return renderLaunchAgentPlist({ label: MANAGED_LABEL, programArguments: superviseArgv });
}

// Classify a plist FILE. An exact byte match against our own rendering is the
// precise "managed" signal (it is a file we wrote); anything else falls back to
// argv-tail classification so a legacy plist can still be recognized and backed
// up while a foreign one is left untouched.
function classifyPlistFile(path: string, expectedManaged: string): "absent" | Kind {
  if (!existsSync(path)) return "absent";
  let xml: string;
  try {
    xml = readFileSync(path, "utf8");
  } catch {
    return "foreign";
  }
  if (xml === expectedManaged) return "managed";
  const argv = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] ?? "");
  return classifyArgv(argv);
}

// Move the current plist aside and return a restore closure. The restore is used
// to undo the move if a subsequent install step fails — a legacy plist must never
// be silently lost to a failed bootstrap.
function backup(plistPath: string, backupDir: string): () => void {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const dest = join(backupDir, `com.megasaver.proxy.${randomUUID()}.plist`);
  renameSync(plistPath, dest);
  return () => {
    try {
      renameSync(dest, plistPath);
    } catch {
      /* best-effort restore */
    }
  };
}

// Write the managed plist, verify it read back byte-for-byte (a partial write or
// tamper is caught before we bootstrap), then load it. Any failure is surfaced as
// `blocked` so the caller can restore a backed-up legacy plist.
function install(deps: LaunchAgentDeps, expected: string): EnsureServiceResult {
  mkdirSync(join(deps.plistPath, ".."), { recursive: true });
  // Refuse to write THROUGH a symlink at the plist path (consistency with the
  // store/settings writers) — a planted link must not redirect the write. Use
  // lstat DIRECTLY (never existsSync, which follows the link and would miss a
  // DANGLING symlink pointing outside the dir); ENOENT just means a fresh create.
  try {
    if (lstatSync(deps.plistPath).isSymbolicLink())
      return { status: "blocked", reason: "refusing symlinked plist path" };
  } catch {
    /* ENOENT (no file) → safe to create; any lstat error → fall through to the write */
  }
  try {
    writeFileSync(deps.plistPath, expected, { mode: 0o644 });
  } catch {
    return { status: "blocked", reason: "failed to write the managed plist" };
  }
  let onDisk: string;
  try {
    onDisk = readFileSync(deps.plistPath, "utf8");
  } catch {
    onDisk = "";
  }
  if (onDisk !== expected)
    return { status: "blocked", reason: "managed plist failed write verification" };
  try {
    deps.runner.bootstrap(deps.plistPath);
  } catch {
    return { status: "blocked", reason: "launchd bootstrap failed" };
  }
  return { status: "installed" };
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
  const expected = expectedManagedPlist(deps.superviseArgv);
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
  const file = classifyPlistFile(deps.plistPath, expected);
  if (file === "foreign")
    return { status: "blocked", reason: "foreign plist under the managed label" };
  // Back up a legacy plist, but keep a restore handle: if the install/bootstrap
  // fails we must put the operator's legacy plist back, not strand them.
  const restore = file === "legacy" ? backup(deps.plistPath, deps.backupDir) : null;
  const result = install(deps, expected);
  if (result.status !== "installed" && restore) restore();
  return result;
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
  const file = classifyPlistFile(deps.plistPath, expectedManagedPlist(deps.superviseArgv));
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
