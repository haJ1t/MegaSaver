import {
  DEDUPE_KEYWORD_PREFIX,
  type MemoryEntry,
  captureCodeAnchor,
  dedupeKeywordFor,
  extractSessionMemories,
  memoryEntrySchema,
  saveMemoryWithLineage,
} from "@megasaver/core";
import { sessionIdSchema } from "@megasaver/shared";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, sessionNotFoundMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";
import { readTestEnv } from "../session/shared.js";

export type RunMemoryFromSessionInput = {
  sessionId: string;
  storeFlag: string | undefined;
  jsonFlag: boolean;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  now?: string;
  newId?: () => string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

// M4 transcript→memory: deterministically distill a recorded session's failures
// into `suggested` memories for the human approval gate. NO LLM. Never
// auto-approves; M3 then surfaces semantic dups at approve. Idempotent — a
// candidate whose dedupeKey is already staged on the project is skipped.
export async function runMemoryFromSession(input: RunMemoryFromSessionInput): Promise<0 | 1> {
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

  let sessionId: ReturnType<typeof sessionIdSchema.parse>;
  try {
    sessionId = sessionIdSchema.parse(input.sessionId);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "sessionId" });
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const { registry, initialized } = await ensureStoreReady(rootDir);
    if (initialized) input.stderr(`note: initialized store at ${rootDir}`);

    const session = registry.getSession(sessionId);
    if (!session) {
      const cli = sessionNotFoundMessage(sessionId);
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const failedAttempts = registry
      .listFailedAttempts(session.projectId)
      .filter((a) => a.sessionId === sessionId);
    const candidates = extractSessionMemories({
      sessionId,
      projectId: session.projectId,
      failedAttempts,
    });

    const staged = new Set(
      registry
        .listMemoryEntries(session.projectId)
        .flatMap((m) => m.keywords)
        .filter((k) => k.startsWith(DEDUPE_KEYWORD_PREFIX)),
    );

    const newId = input.newId ?? (() => crypto.randomUUID());
    const now = input.now ?? readTestEnv("MEGA_TEST_NOW") ?? new Date().toISOString();
    const project = registry.getProject(session.projectId);

    let suggested = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const dedupeKeyword = dedupeKeywordFor(candidate.dedupeKey);
      if (staged.has(dedupeKeyword)) {
        skipped += 1;
        continue;
      }
      // ponytail: one capture (≈1 git spawn per cited file) per candidate;
      // batch through RepoState if extraction volume ever grows.
      const anchor =
        project === null || candidate.relatedFiles.length === 0
          ? undefined
          : await captureCodeAnchor({
              rootPath: project.rootPath,
              relatedFiles: candidate.relatedFiles,
              now,
            });
      const entry: MemoryEntry = memoryEntrySchema.parse({
        id: newId(),
        projectId: session.projectId,
        sessionId,
        scope: candidate.scope,
        type: candidate.type,
        title: candidate.title,
        content: candidate.content,
        keywords: [dedupeKeyword],
        confidence: candidate.confidence,
        source: candidate.source,
        approval: candidate.approval,
        ...(candidate.relatedFiles.length > 0 ? { relatedFiles: candidate.relatedFiles } : {}),
        ...(anchor !== undefined ? { anchor } : {}),
        createdAt: now,
        updatedAt: now,
      });
      // detect: false (living brain, architect #5): N terse extracted candidates
      // sharing the same session files would mass-auto-link against approved
      // rows and prime a bulk-approval mass-close. The from-session: dedupe
      // keyword stays the only dedupe on this path.
      saveMemoryWithLineage(registry, entry, { now: () => now, detect: false });
      staged.add(dedupeKeyword);
      suggested += 1;
    }

    const summary = { suggested, skipped };
    input.stdout(
      input.jsonFlag
        ? JSON.stringify(summary)
        : `suggested=${summary.suggested} skipped=${summary.skipped}`,
    );
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "memory_create" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const memoryFromSessionCommand = defineCommand({
  meta: {
    name: "from-session",
    description:
      "Distill a session's recorded failures into suggested memories (deterministic, no LLM; human approves).",
  },
  args: {
    sessionId: {
      type: "positional",
      required: true,
      description: "Session id (UUID) to distill.",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON output." },
  },
  async run({ args }) {
    const code = await runMemoryFromSession({
      ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
      sessionId: typeof args.sessionId === "string" ? args.sessionId : "",
      jsonFlag: args.json === true,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
