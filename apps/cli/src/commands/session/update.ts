import type { SessionUpdatePatch } from "@megasaver/core";
import { agentIdSchema, riskLevelSchema, sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  invalidAgentMessage,
  invalidRiskMessage,
  mapErrorToCliMessage,
  nothingToUpdateMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { titleSchema } from "./shared.js";

export type RunSessionUpdateInput = {
  sessionId: string;
  titleFlag: string | undefined;
  riskFlag: string | undefined;
  agentFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  json?: boolean;
};

export async function runSessionUpdate(input: RunSessionUpdateInput): Promise<0 | 1> {
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

  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    parsedSessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Pre-flight nothing-to-update check.
  if (
    input.titleFlag === undefined &&
    input.riskFlag === undefined &&
    input.agentFlag === undefined
  ) {
    const cli = nothingToUpdateMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Parse and validate agent at the CLI boundary (mirrors create.ts).
  let parsedAgent: ReturnType<typeof agentIdSchema.parse> | undefined;
  if (input.agentFlag !== undefined) {
    try {
      parsedAgent = agentIdSchema.parse(input.agentFlag);
    } catch {
      const cli = invalidAgentMessage(input.agentFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Parse and validate risk at the CLI boundary (mirrors create.ts).
  let parsedRisk: ReturnType<typeof riskLevelSchema.parse> | undefined;
  if (input.riskFlag !== undefined) {
    try {
      parsedRisk = riskLevelSchema.parse(input.riskFlag);
    } catch {
      const cli = invalidRiskMessage(input.riskFlag);
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Parse and validate title at the CLI boundary (mirrors create.ts).
  // Empty string is the clear-title sentinel — skip schema for that case.
  let parsedTitle: string | undefined;
  if (input.titleFlag !== undefined && input.titleFlag !== "") {
    try {
      parsedTitle = titleSchema.parse(input.titleFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "title" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Build patch with validated values — no `as never` casts.
  const patch: SessionUpdatePatch = {};
  if (input.titleFlag !== undefined) {
    patch.title = input.titleFlag === "" ? null : (parsedTitle ?? null);
  }
  if (parsedRisk !== undefined) patch.riskLevel = parsedRisk;
  if (parsedAgent !== undefined) patch.agentId = parsedAgent;

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    const updated = registry.updateSession(parsedSessionId, patch);
    if (input.json) input.stdout(JSON.stringify(updated));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session_update", id: parsedSessionId });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const sessionUpdateCommand = defineCommand({
  meta: { name: "update", description: "Update fields on an open session." },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID).",
    },
    title: { type: "string", description: "New title (empty string clears)." },
    risk: {
      type: "string",
      description: `New risk level (${riskLevelSchema.options.join(" | ")}).`,
    },
    agent: {
      type: "string",
      description: `New agent id (${agentIdSchema.options.join(" | ")}).`,
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runSessionUpdate({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      titleFlag: typeof args.title === "string" ? args.title : undefined,
      riskFlag: typeof args.risk === "string" ? args.risk : undefined,
      agentFlag: typeof args.agent === "string" ? args.agent : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
