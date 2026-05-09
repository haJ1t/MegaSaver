import { type SessionUpdatePatch, sessionUpdatePatchSchema } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, nothingToUpdateMessage } from "../../errors.js";
import { ensureStoreReady, resolveStorePath } from "../../store.js";

export type RunSessionUpdateInput = {
  sessionId: string;
  titleFlag: string | undefined;
  riskFlag: string | undefined;
  agentFlag: string | undefined;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runSessionUpdate(input: RunSessionUpdateInput): Promise<0 | 1> {
  let rootDir: string;
  try {
    rootDir = resolveStorePath({
      storeFlag: input.storeFlag,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
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
    const cli = mapErrorToCliMessage(err, { kind: "session" });
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

  // Build patch. Patch validation runs inside Core's updateSession via
  // sessionUpdatePatchSchema, so we just construct an unvalidated object here.
  const patch: Record<string, unknown> = {};
  if (input.titleFlag !== undefined) {
    patch.title = input.titleFlag === "" ? null : input.titleFlag;
  }
  if (input.riskFlag !== undefined) patch.riskLevel = input.riskFlag;
  if (input.agentFlag !== undefined) patch.agentId = input.agentFlag;

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);
    registry.updateSession(parsedSessionId, patch as SessionUpdatePatch);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "session_update" });
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
    // Keep in sync with riskLevelSchema in @megasaver/shared.
    risk: {
      type: "string",
      description: "New risk level (low | medium | high | critical).",
    },
    // Keep in sync with agentIdSchema in @megasaver/shared.
    agent: {
      type: "string",
      description: "New agent id (claude-code | codex | cursor | generic-cli).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runSessionUpdate({
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      titleFlag: typeof args.title === "string" ? args.title : undefined,
      riskFlag: typeof args.risk === "string" ? args.risk : undefined,
      agentFlag: typeof args.agent === "string" ? args.agent : undefined,
      storeFlag: typeof args.store === "string" ? args.store : undefined,
      cwd: process.cwd(),
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      home: process.env["HOME"] ?? "",
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      xdgDataHome: process.env["XDG_DATA_HOME"],
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});

// Re-export schema for consumers that need it at the CLI boundary.
export { sessionUpdatePatchSchema };
