import {
  type MemoryEntry,
  POSSIBLE_SUPERSEDES_PREFIX,
  memoryConfidenceSchema,
  memoryEntrySchema,
  memoryScopeSchema,
  memorySourceSchema,
  memoryTypeSchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { type MemoryEntryId, sessionIdSchema, titleSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import {
  emptyFieldMessage,
  invalidConfidenceMessage,
  invalidExpiresMessage,
  invalidScopeMessage,
  invalidSourceMessage,
  invalidTypeMessage,
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
import { contentSchema, memoryEntryIdSchema, toStringArray } from "./shared.js";

export type RunMemoryCreateInput = {
  projectName: string;
  scopeFlag: string;
  contentFlag: string;
  sessionFlag: string | undefined;
  typeFlag?: string | undefined;
  titleFlag?: string | undefined;
  confidenceFlag?: string | undefined;
  sourceFlag?: string | undefined;
  reasonFlag?: string | undefined;
  goalFlag?: string | undefined;
  keywordFlags?: unknown;
  fileFlags?: unknown;
  expiresFlag?: string | undefined;
  supersedeFlag?: string | undefined;
  autoSupersedeFlag?: boolean | undefined;
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
  if (input.supersedeFlag !== undefined && input.autoSupersedeFlag === false) {
    input.stderr("error: --supersede and --no-auto-supersede are mutually exclusive");
    return 1;
  }

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

  // Typed DIMMEM fields. type/confidence/source default to a neutral shape so
  // the legacy two-flag form (--scope/--content) keeps working; all are
  // closed enums validated at the boundary.
  const typeResult = memoryTypeSchema.safeParse(input.typeFlag ?? "todo");
  if (!typeResult.success) {
    const cli = invalidTypeMessage(input.typeFlag ?? "");
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const confidenceResult = memoryConfidenceSchema.safeParse(input.confidenceFlag ?? "medium");
  if (!confidenceResult.success) {
    const cli = invalidConfidenceMessage(input.confidenceFlag ?? "");
    input.stderr(cli.message);
    return cli.exitCode;
  }
  const sourceResult = memorySourceSchema.safeParse(input.sourceFlag ?? "manual");
  if (!sourceResult.success) {
    const cli = invalidSourceMessage(input.sourceFlag ?? "");
    input.stderr(cli.message);
    return cli.exitCode;
  }

  // Title defaults to content; when given, it crosses the same connector-render
  // boundary as content, so re-parse it (parse-on-handoff policy, CLAUDE.md §8).
  let title: string;
  try {
    title = input.titleFlag === undefined ? content : titleSchema.parse(input.titleFlag);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "title" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  const keywords = toStringArray(input.keywordFlags);
  const relatedFiles = toStringArray(input.fileFlags);

  // Boundary validation of optional metadata: Core's schema requires reason/
  // goal non-empty and expiresAt ISO-8601, so reject bad input here with a
  // clear message instead of a generic schema error from deep in Core.
  if (input.reasonFlag !== undefined && input.reasonFlag.trim().length === 0) {
    const cli = emptyFieldMessage("reason");
    input.stderr(cli.message);
    return cli.exitCode;
  }
  if (input.goalFlag !== undefined && input.goalFlag.trim().length === 0) {
    const cli = emptyFieldMessage("goal");
    input.stderr(cli.message);
    return cli.exitCode;
  }
  if (
    input.expiresFlag !== undefined &&
    !z.string().datetime({ offset: true }).safeParse(input.expiresFlag).success
  ) {
    const cli = invalidExpiresMessage(input.expiresFlag);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  let parsedSupersedeId: ReturnType<typeof memoryEntryIdSchema.parse> | undefined;
  if (input.supersedeFlag !== undefined) {
    try {
      parsedSupersedeId = memoryEntryIdSchema.parse(input.supersedeFlag);
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "memoryEntryId" });
      input.stderr(cli.message);
      return cli.exitCode;
    }
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
    // renderer writes entry.content/title verbatim into agent config files.
    const entry: MemoryEntry = memoryEntrySchema.parse({
      id,
      projectId: project.id,
      sessionId: parsedSessionId,
      scope,
      type: typeResult.data,
      title,
      content,
      keywords,
      confidence: confidenceResult.data,
      source: sourceResult.data,
      approval: "approved",
      ...(input.reasonFlag !== undefined ? { reason: input.reasonFlag } : {}),
      ...(input.goalFlag !== undefined ? { goal: input.goalFlag } : {}),
      ...(relatedFiles.length > 0 ? { relatedFiles } : {}),
      ...(input.expiresFlag !== undefined ? { expiresAt: input.expiresFlag } : {}),
      ...(parsedSupersedeId !== undefined ? { supersedesId: parsedSupersedeId } : {}),
      createdAt,
      updatedAt: createdAt,
    });

    // Lexical-only in v1: no queryVector — an interactive create must not load
    // the embedding model, so the detected auto-close path is contradiction-only.
    const result = saveMemoryWithLineage(registry, entry, {
      now: () => createdAt,
      detect: input.autoSupersedeFlag !== false,
      allowImmediateClose: true,
    });

    if (result.deduped) {
      input.stderr(`note: duplicate of ${result.deduped.existingId} — not written`);
    } else {
      if (result.supersession?.closed) {
        const closedId = result.supersession.supersededId;
        const closedTitle = registry.getMemoryEntry(closedId)?.title ?? "";
        input.stderr(
          `note: superseded ${closedId} ("${closedTitle}") — undo: mega memory reopen ${closedId}`,
        );
      }
      for (const ev of result.entry.evidence ?? []) {
        if (!ev.startsWith(POSSIBLE_SUPERSEDES_PREFIX)) continue;
        // Detection wrote this id into evidence moments ago; it is a real row.
        const possibleId = ev.slice(POSSIBLE_SUPERSEDES_PREFIX.length) as MemoryEntryId;
        const possibleTitle = registry.getMemoryEntry(possibleId)?.title ?? "";
        input.stderr(
          `note: possibly supersedes ${possibleId} ("${possibleTitle}") — link explicitly with --supersede ${possibleId}`,
        );
      }
    }

    input.stdout(
      input.json
        ? JSON.stringify({
            ...result.entry,
            ...(result.supersession ? { supersession: result.supersession } : {}),
            ...(result.deduped ? { deduped: result.deduped } : {}),
          })
        : result.entry.id,
    );
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
    type: {
      type: "string",
      description: `Memory type (${memoryTypeSchema.options.join(" | ")}); default todo.`,
    },
    title: { type: "string", description: "Short title; defaults to content." },
    keyword: { type: "string", description: "Keyword (repeatable)." },
    confidence: {
      type: "string",
      description: `Confidence (${memoryConfidenceSchema.options.join(" | ")}); default medium.`,
    },
    source: {
      type: "string",
      description: `Source (${memorySourceSchema.options.join(" | ")}); default manual.`,
    },
    reason: { type: "string", description: "Why this memory exists." },
    goal: { type: "string", description: "Goal this memory serves." },
    file: { type: "string", description: "Related file path (repeatable)." },
    expires: { type: "string", description: "Expiry timestamp (ISO-8601)." },
    supersede: {
      type: "string",
      description: "Explicitly supersede a memory id (links + closes it).",
    },
    autoSupersede: {
      type: "boolean",
      default: true,
      description: "Detect supersession automatically (--no-auto-supersede to skip).",
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
      typeFlag: typeof args.type === "string" ? args.type : undefined,
      titleFlag: typeof args.title === "string" ? args.title : undefined,
      confidenceFlag: typeof args.confidence === "string" ? args.confidence : undefined,
      sourceFlag: typeof args.source === "string" ? args.source : undefined,
      reasonFlag: typeof args.reason === "string" ? args.reason : undefined,
      goalFlag: typeof args.goal === "string" ? args.goal : undefined,
      keywordFlags: args.keyword,
      fileFlags: args.file,
      expiresFlag: typeof args.expires === "string" ? args.expires : undefined,
      supersedeFlag: typeof args.supersede === "string" ? args.supersede : undefined,
      // Citty negation trap (commit 38488043): --no-auto-supersede lands on the
      // kebab key while the declared default lands on the camel key. Read the
      // kebab key — the args proxy resolves the negation when present and falls
      // back to the camel default otherwise.
      autoSupersedeFlag: args["auto-supersede"] !== false,
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
      json: !!args.json,
    });
    if (code !== 0) process.exitCode = code;
  },
});
