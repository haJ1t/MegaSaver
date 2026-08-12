import { isAbsolute, resolve } from "node:path";
import { gc } from "@megasaver/mesh";
import { defineCommand } from "citty";
import { mapErrorToCliMessage, meshUnavailableMessage } from "../../errors.js";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../store.js";

export type RunMeshGcInput = {
  storeFlag: string | undefined;
  cwd: string;
  home?: string;
  xdgDataHome?: string | undefined;
  platform?: NodeJS.Platform;
  localAppData?: string | undefined;
  json?: boolean;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

function resolveStoreRoot(input: RunMeshGcInput): string {
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

export async function runMeshGc(input: RunMeshGcInput): Promise<0 | 1> {
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

  try {
    const result = gc(storeRoot);
    if (input.json) {
      input.stdout(JSON.stringify(result, null, 2));
    } else {
      input.stdout(
        `gc: expiredPresence=${result.expiredPresence} expiredClaims=${result.expiredClaims} rotated=${result.rotated}`,
      );
    }
    return 0;
  } catch (err) {
    const cli = mapErrorToCliMessage(err);
    input.stderr(cli.message);
    return cli.exitCode;
  }
}

export const meshGcCommand = defineCommand({
  meta: {
    name: "gc",
    description: "Run mesh garbage collection (presence TTL, claims TTL, events rotation).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
  },
  async run({ args }) {
    const storeFlag = typeof args.store === "string" ? (args.store as string) : undefined;
    const json = Boolean((args as { json?: unknown }).json);
    const env = readStoreEnv(storeFlag);
    const code = await runMeshGc({
      storeFlag: env.storeFlag,
      cwd: env.cwd,
      home: env.home,
      xdgDataHome: env.xdgDataHome,
      platform: env.platform,
      localAppData: env.localAppData,
      json,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
