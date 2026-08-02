import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { z } from "zod";
import { readStoreEnv, resolveStorePath } from "../store.js";
import { type AdviceCall, type BatchAdviceState, recordBatchCall } from "./cache-advice-state.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const EMPTY_STATE: BatchAdviceState = { offeredDirectories: [], recent: [] };
const ADVICE =
  "Mega Saver: Batch remaining exploration in this directory with one targeted search or mega output file / mega output exec; keep an intent so omitted evidence stays recoverable.";

const toolSchema = z.enum(["Read", "Grep", "Glob"]);
const payloadSchema = z.object({
  session_id: z.string().min(1),
  cwd: z.string().min(1),
  tool_name: toolSchema,
  tool_input: z.record(z.string(), z.unknown()),
});
const stateSchema = z.object({
  offeredDirectories: z.array(z.string().min(1)).max(64),
  recent: z
    .array(
      z.object({
        tool: toolSchema,
        directory: z.string().min(1),
        at: z.number().finite(),
      }),
    )
    .max(128),
});

export type BuildCacheAdviceHookInput = {
  payload: unknown;
  storeRoot: string;
  now: () => number;
};

function nonEmptyPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function callForPayload(
  payload: z.infer<typeof payloadSchema>,
  at: number,
): AdviceCall | undefined {
  const pathKey = payload.tool_name === "Read" ? "file_path" : "path";
  const path = nonEmptyPath(payload.tool_input[pathKey]);
  if (path === undefined) return undefined;
  const directory =
    payload.tool_name === "Read" ? resolve(payload.cwd, dirname(path)) : resolve(payload.cwd, path);
  return { tool: payload.tool_name, directory, at };
}

function statePath(storeRoot: string, workspaceKey: string, sessionId: string): string {
  return join(storeRoot, "stats", workspaceKey, "cache-advice", `${sessionId}.json`);
}

function readState(path: string): BatchAdviceState {
  if (!existsSync(path)) return EMPTY_STATE;
  return stateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

function writeState(path: string, state: BatchAdviceState): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export async function buildCacheAdviceHookOutput(
  input: BuildCacheAdviceHookInput,
): Promise<string> {
  try {
    const parsed = payloadSchema.safeParse(input.payload);
    if (!parsed.success || !SAFE_SEGMENT.test(parsed.data.session_id)) return "";
    const call = callForPayload(parsed.data, input.now());
    if (call === undefined) return "";
    const path = statePath(
      input.storeRoot,
      encodeWorkspaceKey(parsed.data.cwd),
      parsed.data.session_id,
    );
    const result = recordBatchCall(readState(path), call);
    writeState(path, result.state);
    if (!result.advise) return "";
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

function readStdinSync(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export async function runCacheAdviceHookFromProcess(storeFlag?: string): Promise<void> {
  process.exitCode = 0;
  try {
    const raw = readStdinSync().trim();
    if (raw === "") return;
    const payload: unknown = JSON.parse(raw);
    const storeRoot = resolveStorePath(readStoreEnv(storeFlag));
    const output = await buildCacheAdviceHookOutput({ payload, storeRoot, now: Date.now });
    if (output !== "") process.stdout.write(output);
  } catch {
    // A PreToolUse adviser must never block the original tool call.
  }
}
