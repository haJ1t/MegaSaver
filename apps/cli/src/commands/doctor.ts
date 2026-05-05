import { defineCommand } from "citty";

export type Check = {
  key: string;
  value: string;
  pass: boolean;
  reason?: string;
};

export function checkNode(version: string = process.versions.node): Check {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  const value = `v${version}`;
  if (major >= 22) {
    return { key: "node", value, pass: true };
  }
  return { key: "node", value, pass: false, reason: "need ≥22" };
}

export function checkPlatform(platform: NodeJS.Platform = process.platform): Check {
  return { key: "platform", value: platform, pass: true };
}

export function checkCwd(cwd: string = process.cwd()): Check {
  return { key: "cwd", value: cwd, pass: true };
}

export function runChecks(): Check[] {
  return [checkNode(), checkPlatform(), checkCwd()];
}

export function renderReport(checks: Check[]): string {
  const lines = checks.map((c) => {
    const status = c.pass ? "PASS" : "FAIL";
    const reason = c.reason ? ` (${c.reason})` : "";
    return `${c.key} ${c.value} ${status}${reason}`;
  });
  const passCount = checks.filter((c) => c.pass).length;
  const failCount = checks.length - passCount;
  return `${lines.join("\n")}\n\n${passCount} PASS / ${failCount} FAIL`;
}

export function exitCodeFor(checks: Check[]): 0 | 1 {
  return checks.some((c) => !c.pass) ? 1 : 0;
}

export const doctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description: "Environment diagnostics.",
  },
  args: {},
  run() {
    const checks = runChecks();
    console.log(renderReport(checks));
    const code = exitCodeFor(checks);
    if (code !== 0) {
      process.exitCode = code;
    }
  },
});
