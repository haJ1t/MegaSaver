import {
  readClaudeCodeHookStatus,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import { diagnoseMemoryHealth } from "@megasaver/core";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { projectNameSchema } from "../shared/schemas.js";
import { buildHookCoverageFindings, buildSyncFreshnessFindings } from "./doctor-sources.js";

export const BRAIN_DOCTOR_JSON_SCHEMA_VERSION = 1;

export type RunBrainDoctorInput = {
  projectName: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  settingsPath: string;
  now: () => string;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runBrainDoctor(input: RunBrainDoctorInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform,
      localAppData: input.localAppData,
    });
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let projectName: string;
  try {
    projectName = projectNameSchema.parse(input.projectName);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "name" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry } = await ensureStoreReady(rootDir);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const entries = registry.listMemoryEntries(project.id);
    const nowStr = input.now();
    const { findings: memoryFindings, summary } = diagnoseMemoryHealth(entries, nowStr);

    const hookStatus = readClaudeCodeHookStatus({ settingsPath: input.settingsPath });
    const hookFindings = buildHookCoverageFindings(hookStatus, input.settingsPath);
    const syncFindings = buildSyncFreshnessFindings({ storeRoot: rootDir, projectName });

    const findings = [...memoryFindings, ...hookFindings, ...syncFindings];

    if (input.jsonFlag) {
      const report = {
        schemaVersion: BRAIN_DOCTOR_JSON_SCHEMA_VERSION,
        project: projectName,
        generatedAt: nowStr,
        summary,
        findings,
      };
      input.stdout(JSON.stringify(report));
      return 0;
    }

    // human table: summary + aligned rows
    input.stdout(
      `project: ${projectName} total:${summary.total} recallable:${summary.recallableNow} suggested:${summary.suggested} stale:${summary.staleFlagged}`,
    );
    input.stdout(`generatedAt: ${nowStr}`);
    if (findings.length === 0) {
      input.stdout("no findings — brain is healthy");
      return 0;
    }
    input.stdout("severity | check                 | evidence              | repair");
    input.stdout(
      "---------|-----------------------|-----------------------|------------------------------",
    );
    for (const f of findings) {
      const ev = f.evidence.entryIds?.[0] ?? f.evidence.files?.[0] ?? "";
      const sev = f.severity.padEnd(8);
      const chk = f.check.padEnd(21);
      const evidence = String(ev).padEnd(36);
      // Append project name to project-level repairs (those containing <project> placeholder or known project commands)
      let repair = f.repair;
      if (repair.includes("<project>")) repair = repair.replace("<project>", projectName);
      else if (repair.startsWith("mega memory sweep") && !repair.includes(projectName))
        repair = `${repair} ${projectName}`;
      else if (repair.startsWith("mega memory review") && !repair.includes(projectName))
        repair = `${repair} ${projectName}`;
      else if (repair.startsWith("mega brain sync init") && !repair.includes(projectName))
        repair = `${repair}`;
      // repairs that already contain project name stay as is
      input.stdout(`${sev} | ${chk} | ${evidence} | ${repair}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

function readTestNow(): () => string {
  // biome-ignore lint/complexity/useLiteralKeys: MEGA_TEST_NOW index signature
  const v = process.env["MEGA_TEST_NOW"];
  if (typeof v === "string" && v.length > 0) return () => v;
  return () => new Date().toISOString();
}

export const brainDoctorCommand = defineCommand({
  meta: {
    name: "doctor",
    description:
      "Report brain health — stale/decayed, contradictions, lineage, backlog, hooks, sync.",
  },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON report." },
  },
  async run({ args }) {
    const settingsPath = resolveClaudeCodeSettingsPath(process.env);
    const code = await runBrainDoctor({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      jsonFlag: args.json === true,
      settingsPath,
      now: readTestNow(),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
