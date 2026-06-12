import { ruleSeveritySchema } from "@megasaver/core";
import { failedAttemptIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../store.js";
import { toStringArray } from "./fail/shared.js";

export type RunLearnFromFailureInput = {
  idFlag: string;
  titleFlag: string;
  ruleFlag: string;
  severityFlag: string;
  confidenceFlag?: string | undefined;
  appliesToFlags?: unknown;
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

export async function runLearnFromFailure(input: RunLearnFromFailureInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  let failureId: ReturnType<typeof failedAttemptIdSchema.parse>;
  try {
    failureId = failedAttemptIdSchema.parse(input.idFlag);
  } catch {
    input.stderr(`error: invalid failed attempt id "${input.idFlag}"`);
    return 1;
  }
  const severity = ruleSeveritySchema.safeParse(input.severityFlag);
  if (!severity.success) {
    input.stderr(`error: invalid severity "${input.severityFlag}"`);
    return 1;
  }
  try {
    const { registry } = await ensureStoreReady(rootDir);
    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const appliesTo = toStringArray(input.appliesToFlags);
    const { rule, failure } = registry.convertFailureToRule(
      failureId,
      {
        title: input.titleFlag,
        rule: input.ruleFlag,
        severity: severity.data,
        ...(input.confidenceFlag !== undefined ? { confidence: input.confidenceFlag } : {}),
        ...(appliesTo.length > 0 ? { appliesTo } : {}),
      } as Parameters<typeof registry.convertFailureToRule>[1],
      { now, newId },
    );
    input.stdout(input.json ? JSON.stringify({ ruleId: rule.id, failureId: failure.id }) : `rule ${rule.id} (from failure ${failure.id})`);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const learnCommand = defineCommand({
  meta: { name: "learn", description: "Learn reusable rules from failures." },
  subCommands: {
    "from-failure": defineCommand({
      meta: { name: "from-failure", description: "Convert a failed attempt into a project rule." },
      args: {
        id: { type: "positional", required: true, description: "Failed attempt id (UUID)." },
        title: { type: "string", required: true, description: "Rule title." },
        rule: { type: "string", required: true, description: "Rule body." },
        severity: { type: "string", required: true, description: "info | warning | critical." },
        confidence: { type: "string", description: "low | medium | high." },
        "applies-to": { type: "string", description: "Path/glob (repeatable); defaults to the failure's related files." },
        store: { type: "string", description: "Override store directory." },
        json: { type: "boolean", default: false, description: "Emit JSON output." },
      },
      async run({ args }) {
        const code = await runLearnFromFailure({
          idFlag: typeof args.id === "string" ? args.id : "",
          titleFlag: typeof args.title === "string" ? args.title : "",
          ruleFlag: typeof args.rule === "string" ? args.rule : "",
          severityFlag: typeof args.severity === "string" ? args.severity : "",
          confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
          appliesToFlags: args["applies-to"],
          ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
          stdout: (line) => console.log(line),
          stderr: (line) => console.error(line),
          json: !!args.json,
        });
        if (code !== 0) process.exitCode = code;
      },
    }),
  },
});
