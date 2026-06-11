import { type MemoryEntry, memoryEntrySchema, memoryScopeSchema } from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import {
  invalidScopeMessage,
  mapErrorToCliMessage,
  projectNotFoundMessage,
  scopeProjectWithSessionMessage,
  scopeSessionWithoutSessionMessage,
  sessionAlreadyEndedMessage,
  sessionNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";
import { projectNameSchema } from "../shared/schemas.js";
import { contentSchema } from "./shared.js";

export type RunMemoryCreateInput = {
  projectName: string;
  scopeFlag: string;
  contentFlag: string;
  sessionFlag: string | undefined;
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

export async function runMemoryCreate(input: RunMemoryCreateInput): Promise<0 | 1> {
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

  // Scope validation (closed enum, custom error wording).
  const scopeResult = memoryScopeSchema.safeParse(input.scopeFlag);
  if (!scopeResult.success) {
    const cli = invalidScopeMessage(input.scopeFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const scope = scopeResult.data;

  // Cross-field guard.
  if (scope === "project" && input.sessionFlag !== undefined) {
    const cli = scopeProjectWithSessionMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }
  if (scope === "session" && input.sessionFlag === undefined) {
    const cli = scopeSessionWithoutSessionMessage();
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Session id parse (only if --scope session).
  let parsedSessionId: ReturnType<typeof sessionIdSchema.parse> | null = null;
  if (input.sessionFlag !== undefined) {
    try {
      parsedSessionId = sessionIdSchema.parse(input.sessionFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
  }

  // Content validation (control char + min(1)).
  let content: string;
  try {
    content = contentSchema.parse(input.contentFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
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

    if (parsedSessionId !== null) {
      const session = registry.getSession(parsedSessionId);
      if (!session) {
        const cli = sessionNotFoundMessage(parsedSessionId);
        input.stderr(cli.message);
        return cli.exitCode;
      }
      // Re-parse boundary: session.endedAt is trusted from Core's schema.
      if (session.endedAt !== null) {
        const cli = sessionAlreadyEndedMessage(parsedSessionId, session.endedAt);
        input.stderr(cli.message);
        return cli.exitCode;
      }
    }

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? (() => new Date().toISOString());
    const id = readTestEnv("MEGA_TEST_MEMORY_ENTRY_ID") ?? newId();
    const createdAt = readTestEnv("MEGA_TEST_NOW") ?? now();

    // Parse-on-handoff boundary: re-parse here because the connector block
    // renderer writes entry.content verbatim into agent config files.
    // Phase 1 (DIMMEM) enriched the schema with required typed fields. Until
    // `mega memory create` grows --type/--title flags (follow-up), default to
    // a neutral typed shape so the create path produces valid typed memories.
    const entry: MemoryEntry = memoryEntrySchema.parse({
      id,
      projectId: project.id,
      sessionId: parsedSessionId,
      scope,
      type: "todo",
      title: content,
      content,
      keywords: [],
      confidence: "medium",
      source: "manual",
      createdAt,
      updatedAt: createdAt,
    });

    registry.createMemoryEntry(entry);
    input.stdout(input.json ? JSON.stringify(entry) : entry.id);
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryCreateCommand = defineCommand({
  meta: { name: "create", description: "Create a memory entry on a project." },
  args: {
    projectName: {
      type: "positional",
      required: true,
      description: "Project name (must already exist).",
    },
    scope: {
      type: "string",
      required: true,
      description: `Memory scope (${memoryScopeSchema.options.join(" | ")}).`,
    },
    content: {
      type: "string",
      required: true,
      description: "Memory content (non-empty, single-line).",
    },
    session: {
      type: "string",
      description: "Session id (UUID); required when --scope session.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryCreate({
      projectName: typeof args.projectName === "string" ? args.projectName : "",
      scopeFlag: typeof args.scope === "string" ? args.scope : "",
      contentFlag: typeof args.content === "string" ? args.content : "",
      sessionFlag: typeof args.session === "string" ? args.session : undefined,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
