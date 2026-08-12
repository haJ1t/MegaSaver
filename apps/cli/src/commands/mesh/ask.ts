import { isAbsolute, resolve } from "node:path";
import { postAsk } from "@megasaver/mesh";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { defineCommand } from "citty";
import { z } from "zod";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

const askInputSchema = z
  .object({
    question: z.string().trim().min(1).max(4000),
  })
  .strict();

export type RunMeshAskInput = {
  question: string;
  to?: string;
  session?: string;
  json?: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => number;
  newId?: () => string;
  postAskFn?: typeof postAsk;
};

function resolveStoreRoot(input: RunMeshAskInput): string {
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

export async function runMeshAsk(input: RunMeshAskInput): Promise<0 | 1> {
  let parsed: z.infer<typeof askInputSchema>;
  try {
    parsed = askInputSchema.parse({ question: input.question });
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }

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

  const workspaceKey = encodeWorkspaceKey(input.cwd);
  const from = input.session ?? `cli-${workspaceKey}`;
  const fn = input.postAskFn ?? postAsk;

  try {
    const result = await (fn as unknown as (a: string, b: unknown) => Promise<unknown>)(storeRoot, {
      from,
      text: parsed.question,
      workspaceKey,
      ...(input.to !== undefined ? { to: input.to } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
      ...(input.newId !== undefined ? { newId: input.newId } : {}),
    });

    // Also support fn called as postAsk({storeRoot, from, workspaceKey, question})
    // The above handles string+object form. If fn expects object form, it will still work via overload.

    const res = result as { posted: boolean; askId?: string; recipients?: number; reason?: string };
    if (input.json) {
      input.stdout(JSON.stringify(res, null, 2));
      return 0;
    }
    if (res.posted) {
      input.stdout(`ask ${res.askId} posted to ${res.recipients} peer(s)`);
      input.stdout("Answers arrive on the bus: mega mesh events");
      return 0;
    }
    if (res.reason === "no_live_peers") {
      input.stdout("no live peers — ask not posted");
      return 0;
    }
    if (res.reason === "rate_limited") {
      input.stdout("rate limited — try again in 60s");
      return 0;
    }
    if (res.reason === "mesh_unavailable") {
      const cli = meshUnavailableMessage("mesh unavailable");
      input.stderr(cli.message);
      return cli.exitCode;
    }
    input.stdout(JSON.stringify(res, null, 2));
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const meshAskCommand = defineCommand({
  meta: { name: "ask", description: "Ask live peers a question (guarded, rate-limited)." },
  args: {
    question: {
      type: "positional",
      required: true,
      description: "Question text (≤4000 chars, redacted).",
    },
    to: {
      type: "string",
      description: "Directed target liveSessionId (optional, fans out if omitted).",
    },
    session: {
      type: "string",
      description: "Override sender liveSessionId (default cli-<workspaceKey>).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const question = typeof args.question === "string" ? args.question : "";
    const to =
      typeof (args as { to?: unknown }).to === "string"
        ? ((args as { to: string }).to as string)
        : undefined;
    const session =
      typeof (args as { session?: unknown }).session === "string"
        ? ((args as { session: string }).session as string)
        : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runMeshAsk({
      question,
      ...(to !== undefined ? { to } : {}),
      ...(session !== undefined ? { session } : {}),
      json,
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
