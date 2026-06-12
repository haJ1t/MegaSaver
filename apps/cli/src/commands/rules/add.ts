import { type ProjectRule, projectRuleSchema, ruleConfidenceSchema, ruleSeveritySchema } from "@megasaver/core";
import { titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, projectNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { toStringArray } from "./shared.js";

export type RunRulesAddInput = {
  projectName: string;
  titleFlag: string;
  ruleFlag: string;
  severityFlag: string;
  confidenceFlag?: string | undefined;
  appliesToFlags?: unknown;
  evidenceFlags?: unknown;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
  newId?: () => string;
  now?: () => string;
};

export async function runRulesAdd(input: RunRulesAddInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
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
  const severity = ruleSeveritySchema.safeParse(input.severityFlag);
  if (!severity.success) {
    input.stderr(`error: invalid severity "${input.severityFlag}"`);
    return 1;
  }
  const confidence = ruleConfidenceSchema.safeParse(input.confidenceFlag ?? "medium");
  if (!confidence.success) {
    input.stderr(`error: invalid confidence "${input.confidenceFlag ?? ""}"`);
    return 1;
  }
  let title: string;
  try {
    title = titleSchema.parse(input.titleFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "title" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const project = registry.listProjects().find((p) => p.name === projectName);
    if (!project) {
      const cli = projectNotFoundMessage(projectName);
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_PROJECT_RULE_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();
    const rule: ProjectRule = projectRuleSchema.parse({
      id,
      projectId: project.id,
      title,
      rule: input.ruleFlag,
      appliesTo: toStringArray(input.appliesToFlags),
      evidence: toStringArray(input.evidenceFlags),
      severity: severity.data,
      confidence: confidence.data,
      createdFrom: "manual",
      createdAt,
      updatedAt: createdAt,
    });
    const created = registry.createProjectRule(rule);
    input.stdout(input.json ? JSON.stringify(created) : created.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const rulesAddCommand = defineCommand({
  meta: { name: "add", description: "Add a project rule." },
  args: {
    projectName: { type: "positional", required: true, description: "Project name." },
    title: { type: "string", required: true, description: "Rule title." },
    rule: { type: "string", required: true, description: "Rule body." },
    severity: { type: "string", required: true, description: "info | warning | critical." },
    confidence: { type: "string", description: "low | medium | high; default medium." },
    "applies-to": { type: "string", description: "Path/glob (repeatable)." },
    evidence: { type: "string", description: "Evidence line (repeatable)." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runRulesAdd({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      titleFlag: typeof args.title === "string" ? args.title : "",
      ruleFlag: typeof args.rule === "string" ? args.rule : "",
      severityFlag: typeof args.severity === "string" ? args.severity : "",
      confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
      appliesToFlags: args["applies-to"],
      evidenceFlags: args.evidence,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
