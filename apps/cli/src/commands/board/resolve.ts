import { isAbsolute, resolve } from "node:path";
import { resolveFact } from "@megasaver/mesh";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
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

export type RunBoardResolveInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  factId: string;
  note?: string | undefined;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export async function runBoardResolve(input: RunBoardResolveInput): Promise<0 | 1> {
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
    resolveFact(storeRoot, input.factId, input.note);
    if (input.json) {
      input.stdout(JSON.stringify({ ok: true, id: input.factId }, null, 2));
    } else {
      input.stdout(`resolved ${input.factId}`);
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const boardResolveCommand = defineCommand({
  meta: { name: "resolve", description: "Resolve a board fact (mark resolved)." },
  args: {
    factId: { type: "positional", required: true, description: "Board fact id (UUID)." },
    note: { type: "string", description: "Resolution note." },
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const env = readStoreEnv(storeFlag);
    const code = await runBoardResolve({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      factId: typeof args.factId === "string" ? args.factId : "",
      note:
        typeof (args as { note?: unknown }).note === "string"
          ? ((args as { note: string }).note as string)
          : undefined,
      json: Boolean((args as { json?: unknown }).json),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
