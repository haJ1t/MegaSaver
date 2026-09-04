import { isAbsolute, resolve } from "node:path";
import { sendMessage } from "@megasaver/mesh";
import { defineCommand } from "citty";
import { z } from "zod";
import { mapErrorToCliMessage, meshNoPeersMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

const sendInputSchema = z
  .object({
    target: z.string().trim().min(1),
    text: z.string().trim().min(1).max(4000),
  })
  .strict();

export type RunMeshSendInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  target: string;
  text: string;
  kind?: "message" | "ask" | "answer";
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function resolveStoreRoot(input: RunMeshSendInput): string {
  if (input.storeFlag !== undefined) {
    const trimmed = input.storeFlag.trim();
    if (trimmed.length === 0) throw new Error("Store path must be non-empty.");
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

export async function runMeshSend(input: RunMeshSendInput): Promise<0 | 1> {
  let parsed: z.infer<typeof sendInputSchema>;
  try {
    parsed = sendInputSchema.parse({ target: input.target, text: input.text });
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

  const kind = input.kind ?? "message";
  const from = "cli";
  const to = parsed.target === "all" || parsed.target === "broadcast" ? undefined : parsed.target;

  try {
    await ensureStoreReady(storeRoot);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const cli = meshUnavailableMessage(detail);
    input.stderr(cli.message);
    return cli.exitCode;
  }

  try {
    const evt = sendMessage(storeRoot, { from, to, kind, text: parsed.text });
    if (input.json) {
      input.stdout(JSON.stringify(evt, null, 2));
    } else {
      const dest = to ?? "all";
      input.stdout(`sent ${kind} to ${dest}: ${evt.id}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof Error && err.message.includes("no live peers")) {
      const cli = meshNoPeersMessage();
      input.stderr(cli.message);
      return cli.exitCode;
    }
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const meshSendCommand = defineCommand({
  meta: { name: "send", description: "Send a mesh message to a peer or broadcast." },
  args: {
    target: { type: "positional", required: true, description: "Target liveSessionId or 'all'." },
    text: {
      type: "positional",
      required: true,
      description: "Message text (≤4000 chars, redacted).",
    },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    kind: { type: "string", default: "message", description: "Kind: message|ask|answer." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const rawKind =
      typeof (args as { kind?: unknown }).kind === "string"
        ? ((args as { kind: string }).kind as string)
        : "message";
    const kind =
      rawKind === "ask" || rawKind === "answer" || rawKind === "message"
        ? (rawKind as "message" | "ask" | "answer")
        : "message";
    const env = readStoreEnv(storeFlag);
    const code = await runMeshSend({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      target: typeof args.target === "string" ? args.target : "",
      text: typeof args.text === "string" ? args.text : "",
      kind,
      json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
