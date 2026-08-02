import { createHash } from "node:crypto";
import { readSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { type CacheAdviceCall, transactCacheAdvice } from "./cache-advice-store.js";
import { maybeRunCacheAdviceGc } from "./gc.js";

export const MAX_CACHE_ADVICE_HOOK_STDIN_BYTES = 65_536;

const MAX_CACHE_ADVICE_PATH_BYTES = 4_096;
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIRECTORY_KEY_DOMAIN = "megasaver:cache-advice:directory:v2\0";
const ADVICE =
  "Mega Saver: Batch remaining exploration in this directory with one targeted search or mega output file / mega output exec; keep an intent so omitted evidence stays recoverable.";

const toolSchema = z.enum(["Read", "Grep", "Glob"]);
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

export async function buildCacheAdviceHookOutput(
  input: BuildCacheAdviceHookInput,
): Promise<string> {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") return "";
  try {
    const parsed = payloadSchema.safeParse(input.payload);
    if (!parsed.success || !SAFE_SEGMENT.test(parsed.data.session_id)) return "";
    const resolvedCall = await callForPayload(parsed.data, input.now());
    if (resolvedCall === undefined) return "";
    const result = await transactCacheAdvice({
      storeRoot: input.storeRoot,
      workspaceKey: resolvedCall.workspaceKey,
      sessionId: parsed.data.session_id,
      call: resolvedCall.call,
      platform,
    });
    await maybeRunCacheAdviceGc(input.storeRoot, { platform });
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
    const output = await buildCacheAdviceHookOutput({ payload, storeRoot, now: Date.now });
    if (output !== "") process.stdout.write(output);
  } catch {
    // A PreToolUse adviser must never block the original tool call.
  }
}
