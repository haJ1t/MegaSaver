import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadProjectPermissions } from "@megasaver/context-gate";
import { evaluateCommand as evaluatePolicyCommand } from "@megasaver/policy";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { triggerCacheAdviceMaintenance } from "./cache-advice-maintenance-trigger.js";
import { cacheAdviceMigrationComplete } from "./cache-advice-maintenance.js";
import { type CacheAdviceCall, transactCacheAdvice } from "./cache-advice-store.js";
import { maybeRunCacheAdviceGc } from "./gc.js";
import { classifyOutputRouteCommand, outputRouteArgv } from "./output-route-command.js";

export const MAX_CACHE_ADVICE_HOOK_STDIN_BYTES = 65_536;

const MAX_CACHE_ADVICE_PATH_BYTES = 4_096;
const MAX_OUTPUT_ROUTE_COMMAND_BYTES = 4_096;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIRECTORY_KEY_DOMAIN = "megasaver:cache-advice:directory:v2\0";
const ADVICE =
  "Mega Saver: Batch remaining exploration in this directory with one targeted search or mega output file / mega output exec; keep an intent so omitted evidence stays recoverable.";
// §3: the advice names only the registry session UUID. It never restates the
// command, argv, pattern, cwd, project/store path, permission details, hook
// session, or any current-input text.
const outputRouteAdvice = (sessionId: string) =>
  `Mega Saver: this read-only command may produce a large result. Rerun the same approved command through mega output exec ${sessionId} --intent <goal> to keep it lossless and recoverable.`;

const toolSchema = z.enum(["Read", "Grep", "Glob", "Bash"]);
const payloadSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  tool_name: toolSchema,
  tool_input: z.record(z.string(), z.unknown()),
});

export type BuildCacheAdviceHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
  platform?: NodeJS.Platform;
  // Gate seam for the Bash output-route branch (§3). Absent deps suppress the
  // branch entirely; production wires the defaults below.
  outputRoute?: OutputRouteDeps | undefined;
};

export type OutputRouteSession = {
  id: string;
  agentId: string;
  projectId: string;
  endedAt: string | null;
  tokenSaver?: { storeRawOutput?: boolean } | undefined;
};

export type OutputRouteProject = { id: string; rootPath: string };

// Every dependency is injectable so tests never touch the real store,
// registry, permissions, or policy gate. Returning undefined from any gate
// suppresses the branch with no state change.
export type OutputRouteDeps = {
  defaultStoreRoot: string;
  listProjects: () => readonly OutputRouteProject[];
  listSessions: (projectId: string) => readonly OutputRouteSession[];
  loadPermissions: (projectRoot: string) => unknown | null;
  evaluateCommand: (input: {
    command: string;
    args: readonly string[];
    project: string;
    env: { MEGASAVER_ORIGIN_PID: string };
    permissions?: unknown;
  }) => { allowed: boolean };
};

function utf8LengthWithin(value: string, maximum: number): boolean {
  return Buffer.byteLength(value, "utf8") <= maximum;
}

function nonEmptyPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function directoryKey(directory: string): string {
  return createHash("sha256")
    .update(DIRECTORY_KEY_DOMAIN, "utf8")
    .update(directory, "utf8")
    .digest("hex");
}

export function cacheAdviceCanonicalPath(path: string): {
  filesystemPath: string;
  directoryKeyPath: string;
} {
  return { filesystemPath: path, directoryKeyPath: path.normalize("NFC") };
}

async function callForPayload(
  payload: z.infer<typeof payloadSchema>,
  at: number,
): Promise<{ call: CacheAdviceCall; workspaceKey: string } | undefined> {
  if (payload.tool_name === "Bash") return undefined;
  const pathKey = payload.tool_name === "Read" ? "file_path" : "path";
  const inputPath = nonEmptyPath(payload.tool_input[pathKey]);
  if (
    inputPath === undefined ||
    !utf8LengthWithin(payload.cwd, MAX_CACHE_ADVICE_PATH_BYTES) ||
    !utf8LengthWithin(inputPath, MAX_CACHE_ADVICE_PATH_BYTES)
  ) {
    return undefined;
  }

  const canonicalCwd = await realpath(resolve(payload.cwd));
  if (
    !(await stat(canonicalCwd)).isDirectory() ||
    !utf8LengthWithin(canonicalCwd, MAX_CACHE_ADVICE_PATH_BYTES)
  ) {
    return undefined;
  }
  const canonicalTarget = await realpath(resolve(canonicalCwd, inputPath));
  const targetStats = await stat(canonicalTarget);
  let canonicalDirectory: string;
  if (payload.tool_name === "Read") {
    if (!targetStats.isFile()) return undefined;
    canonicalDirectory = dirname(canonicalTarget);
  } else if (targetStats.isFile()) {
    canonicalDirectory = dirname(canonicalTarget);
  } else if (targetStats.isDirectory()) {
    canonicalDirectory = canonicalTarget;
  } else {
    return undefined;
  }

  if (!utf8LengthWithin(canonicalDirectory, MAX_CACHE_ADVICE_PATH_BYTES)) return undefined;
  const canonicalPath = cacheAdviceCanonicalPath(canonicalDirectory);
  return {
    call: {
      tool: payload.tool_name,
      directoryKey: directoryKey(canonicalPath.directoryKeyPath),
      at,
    },
    workspaceKey: encodeWorkspaceKey(canonicalCwd),
  };
}

type OutputRouteOffer = {
  family: "grep" | "find";
  workspaceKey: string;
  registrySessionId: string;
};

// Gates (§3, in order — every failure returns undefined and consumes nothing):
// 1. POSIX + default store (checked by the caller).
// 2. Exactly one registered project whose canonical root equals the hook cwd.
// 3. Exactly one open claude-code Mega Saver session for that project. The
//    Claude hook session id is state scope only, never the registry UUID.
// 4. The effective session has storeRawOutput true.
// 5. Settings/permissions resolve and the exact argv passes policy.
async function evaluateOutputRoute(
  payload: z.infer<typeof payloadSchema>,
  canonicalCwd: string,
  deps: OutputRouteDeps,
): Promise<OutputRouteOffer | undefined> {
  const commandValue = payload.tool_input["command"];
  if (typeof commandValue !== "string") return undefined;
  if (Buffer.byteLength(commandValue, "utf8") > MAX_OUTPUT_ROUTE_COMMAND_BYTES) return undefined;
  const family = classifyOutputRouteCommand(commandValue);
  if (family === null) return undefined;
  const argv = outputRouteArgv(commandValue);
  if (argv === null) return undefined;

  let project: OutputRouteProject | undefined;
  for (const candidate of deps.listProjects()) {
    try {
      const canonicalRoot = await realpath(candidate.rootPath);
      if (canonicalRoot === canonicalCwd) {
        if (project !== undefined) return undefined; // ambiguous registration
        project = { ...candidate, rootPath: canonicalRoot };
      }
    } catch {
      // An unresolvable registered root can never equal the hook cwd.
    }
  }
  if (project === undefined) return undefined;

  const openSessions = deps
    .listSessions(project.id)
    .filter((session) => session.agentId === "claude-code" && session.endedAt === null);
  if (openSessions.length !== 1) return undefined;
  const session = openSessions[0];
  if (session === undefined || session.tokenSaver?.storeRawOutput !== true) return undefined;

  let permissions: unknown | null;
  try {
    permissions = deps.loadPermissions(project.rootPath);
  } catch {
    return undefined;
  }
  const verdict = deps.evaluateCommand({
    command: argv.command,
    args: argv.args,
    project: project.id,
    env: { MEGASAVER_ORIGIN_PID: String(process.pid) },
    ...(permissions !== null && permissions !== undefined ? { permissions } : {}),
  });
  if (!verdict.allowed) return undefined;

  return {
    family,
    workspaceKey: encodeWorkspaceKey(canonicalCwd),
    registrySessionId: session.id,
  };
}

export async function buildCacheAdviceHookOutput(
  input: BuildCacheAdviceHookInput,
): Promise<string> {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") return "";
  try {
    const parsed = payloadSchema.safeParse(input.payload);
    if (!parsed.success || !SAFE_SEGMENT.test(parsed.data.session_id)) return "";
    if (parsed.data.tool_name === "Bash") {
      return await buildOutputRouteOutput(parsed.data, input, platform);
    }
    const resolvedCall = await callForPayload(parsed.data, input.now());
    if (resolvedCall === undefined) return "";
    const result = await transactCacheAdvice({
      storeRoot: input.storeRoot,
      workspaceKey: resolvedCall.workspaceKey,
      sessionId: parsed.data.session_id,
      action: { kind: "batch", call: resolvedCall.call },
      platform,
    });
    await maybeRunCacheAdviceGc(input.storeRoot, { platform });
    // Off-hook legacy migration (spec §2.3): an incomplete migration makes
    // the hook emit nothing and best-effort trigger one detached maintainer.
    // Cheap completeness check first; every failure is swallowed.
    try {
      if (!(await cacheAdviceMigrationComplete(input.storeRoot))) {
        await triggerCacheAdviceMaintenance({ storeRoot: input.storeRoot });
      }
    } catch {
      // Best-effort maintenance must never affect the hook result.
    }
    if (result !== "advise") return "";
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: ADVICE,
      },
    });
  } catch {
    return "";
  }
}

async function buildOutputRouteOutput(
  payload: z.infer<typeof payloadSchema>,
  input: BuildCacheAdviceHookInput,
  platform: NodeJS.Platform,
): Promise<string> {
  const deps = input.outputRoute;
  if (deps === undefined) return "";
  // Gate 1: the advice route exists only on the default store. A baked
  // non-default store suppresses this branch without weakening batch advice.
  if (input.storeRoot !== deps.defaultStoreRoot) return "";
  const canonicalCwd = await realpath(resolve(payload.cwd));
  const offer = await evaluateOutputRoute(payload, canonicalCwd, deps);
  if (offer === undefined) return "";
  const result = await transactCacheAdvice({
    storeRoot: input.storeRoot,
    workspaceKey: offer.workspaceKey,
    sessionId: payload.session_id,
    action: { kind: "output-route", family: offer.family, at: input.now() },
    platform,
  });
  await maybeRunCacheAdviceGc(input.storeRoot, { platform });
  try {
    if (!(await cacheAdviceMigrationComplete(input.storeRoot))) {
      await triggerCacheAdviceMaintenance({ storeRoot: input.storeRoot });
    }
  } catch {
    // Best-effort maintenance must never affect the hook result.
  }
  if (result !== "advise") return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: outputRouteAdvice(offer.registrySessionId),
    },
  });
}

function readStdinBounded(): string | undefined {
  const buffer = Buffer.alloc(MAX_CACHE_ADVICE_HOOK_STDIN_BYTES + 1);
  let offset = 0;
  try {
    while (offset < buffer.length) {
      const bytesRead = readSync(0, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
  } catch {
    return undefined;
  }
  if (offset > MAX_CACHE_ADVICE_HOOK_STDIN_BYTES) return undefined;
  return buffer.subarray(0, offset).toString("utf8");
}

export async function runCacheAdviceHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    if (process.platform === "win32") return;
    const raw = readStdinBounded()?.trim();
    if (raw === undefined || raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const defaultStoreRoot = resolveStorePath(readStoreEnv(undefined));
    const output = await buildCacheAdviceHookOutput({
      payload,
      storeRoot,
      now: Date.now,
      outputRoute: await defaultOutputRouteDeps(storeRoot, defaultStoreRoot),
    });
    if (output !== "") process.stdout.write(output);
  } catch {
    // A PreToolUse adviser must never block the original tool call.
  }
}

// Production gate seam: the registry opens read-only per hook invocation and
// every failure degrades to no-branch (undefined deps suppress the offer).
async function defaultOutputRouteDeps(
  storeRoot: string,
  defaultStoreRoot: string,
): Promise<OutputRouteDeps | undefined> {
  if (storeRoot !== defaultStoreRoot) {
    return {
      defaultStoreRoot,
      listProjects: () => [],
      listSessions: () => [],
      loadPermissions: () => null,
      evaluateCommand: () => ({ allowed: false }),
    };
  }
  try {
    const { ensureStoreReady } = await import("../store.js");
    const { registry } = await ensureStoreReady(storeRoot);
    return {
      defaultStoreRoot,
      listProjects: () => registry.listProjects(),
      listSessions: (projectId) => registry.listSessions(projectId as never),
      loadPermissions: (projectRoot) => loadProjectPermissions(projectRoot),
      evaluateCommand: (input) =>
        evaluatePolicyCommand({
          command: input.command,
          args: input.args,
          project: input.project as never,
          env: input.env,
          ...(input.permissions !== undefined ? { permissions: input.permissions as never } : {}),
        }),
    };
  } catch {
    return undefined;
  }
}
