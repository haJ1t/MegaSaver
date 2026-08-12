import { isAbsolute, resolve } from "node:path";
import { readBoardFacts } from "@megasaver/mesh";
import { defineCommand } from "citty";
import {
  mapErrorToCliMessage,
  meshUnavailableMessage,
  projectNotFoundMessage,
} from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

function resolveStoreRoot(input: {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
}): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("store path must be non-empty");
    return isAbsolute(trimmed) ? trimmed : resolve(input.cwd, trimmed);
  }
  if (input.home !== undefined) {
    return resolveStorePath({
      storeFlag: undefined,
      cwd: input.cwd,
      home: input.home,
      xdgDataHome: input.xdgDataHome,
      platform: input.platform ?? process.platform,
      localAppData: input.localAppData,
    });
  }
  return resolveStorePath(readStoreEnv(undefined));
}

export type RunBoardPromoteInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  factId: string;
  projectName?: string | undefined;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => string;
  newId?: () => string;
};

export async function runBoardPromote(input: RunBoardPromoteInput): Promise<0 | 1> {
  let storeRoot: string;
  try {
    storeRoot = resolveStoreRoot(input);
  } catch (err) {
    const cli = mapErrorToCliMessage(err, { kind: "store" });
    input.stderr(cli.message);
    return cli.exitCode;
  }
  try {
    await ensureStoreReady(storeRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cli = meshUnavailableMessage(detail);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  if (typeof input.factId !== "string" || input.factId.trim().length === 0) {
    const cli = mapErrorToCliMessage(new Error("factId must be non-empty"));
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    // locate fact
    const all = readBoardFacts(storeRoot, {});
    const fact = all.find((f) => f.id === input.factId);
    if (!fact) {
      const cli = mapErrorToCliMessage(new Error(`board fact not found: ${input.factId}`));
      input.stderr(cli.message);
      return cli.exitCode;
    }

    const { registry } = await ensureStoreReady(storeRoot);

    // resolve project: via flag or cwd
    let projectName = input.projectName;
    let project: ReturnType<typeof registry.listProjects>[number] | undefined;
    if (projectName !== undefined) {
      project = registry.listProjects().find((p) => p.name === projectName);
      if (!project) {
        const cli = projectNotFoundMessage(projectName);
        input.stderr(cli.message);
        return cli.exitCode;
      }
    } else {
      // try findProjectByCwd
      const { findProjectByCwd } = await import("../warmup.js");
      project =
        registry
          .listProjects()
          .find((p) => findProjectByCwd(registry.listProjects(), input.cwd)?.id === p.id) ??
        undefined;
      // fallback: first project if only one
      if (!project && registry.listProjects().length === 1) {
        project = registry.listProjects()[0];
      }
      if (!project) {
        const cli = mapErrorToCliMessage(new Error("project not found: specify --project"));
        input.stderr(cli.message);
        return cli.exitCode;
      }
      projectName = project.name;
    }

    // Build memory entry for promotion → suggested
    const { memoryEntrySchema, saveMemoryWithLineage } = await import("@megasaver/core");
    const nowIso = input.now ? input.now() : new Date().toISOString();
    const newId = input.newId ? input.newId() : crypto.randomUUID();

    const entry = memoryEntrySchema.parse({
      id: newId,
      projectId: project?.id,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: fact.topic,
      content: fact.text,
      keywords: [fact.topic],
      confidence: fact.confidence,
      source: "agent",
      approval: "suggested",
      ...(fact.scope.paths && fact.scope.paths.length > 0
        ? { relatedFiles: fact.scope.paths }
        : {}),
      reason: `promoted from board fact ${fact.id}`,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const result = saveMemoryWithLineage(registry, entry, {
      now: () => nowIso,
      detect: true,
      allowImmediateClose: false,
    });

    // mark board fact promotedTo
    try {
      const { meshPaths } = await import("@megasaver/mesh");
      const { readFileSync } = await import("node:fs");
      const { boardFactSchema, atomicWriteFileSync, safeJsonParse } = await import(
        "@megasaver/mesh"
      );
      // Use direct file path
      const boardDir = meshPaths(storeRoot).boardDir;
      const fp = resolve(boardDir, `${fact.id}.json`);
      // re-read fresh
      const raw = readFileSync(fp, "utf8");
      const parsedJson = safeJsonParse(raw);
      const res = boardFactSchema.safeParse(parsedJson);
      if (res.success) {
        const updated = { ...res.data, promotedTo: result.entry.id };
        const validated = boardFactSchema.parse(updated);
        atomicWriteFileSync(fp, `${JSON.stringify(validated)}\n`);
      }
    } catch {}

    if (input.json) {
      input.stdout(
        JSON.stringify(
          { memoryId: result.entry.id, factId: fact.id, entry: result.entry },
          null,
          2,
        ),
      );
    } else {
      input.stdout(`promoted ${fact.id} → ${result.entry.id} (suggested)`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const boardPromoteCommand = defineCommand({
  meta: {
    name: "promote",
    description: "Promote a board fact to a suggested memory (via saveMemoryWithLineage).",
  },
  args: {
    factId: { type: "positional", required: true, description: "Board fact id (UUID)." },
    project: {
      type: "string",
      description: "Project name (auto from cwd if omitted and only one project).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runBoardPromote({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      factId: typeof args.factId === "string" ? args.factId : "",
      projectName:
        typeof (args as { project?: unknown }).project === "string"
          ? ((args as { project: string }).project as string)
          : undefined,
      json: Boolean((args as { json?: unknown }).json),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
