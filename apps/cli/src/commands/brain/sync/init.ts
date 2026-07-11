import { existsSync } from "node:fs";
import {
  BrainSyncError,
  assertSafeEndpoint,
  createTransport,
  decodeRecoveryCode,
  encodeRecoveryCode,
  generateKey,
  keyfilePath,
  loadKeyfile,
  normalizePrefix,
  probeConditionalWrites,
  saveConfig,
  saveKeyfile,
} from "@megasaver/brain-sync";
import { defineCommand } from "citty";
import { ensureStoreReady, readStoreEnv, resolveStorePath } from "../../../store.js";
import { type BrainSyncCommonInput, gate } from "./common.js";

export type RunBrainSyncInitInput = BrainSyncCommonInput & {
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  pathStyle: boolean;
  join?: string;
  keyfileImportPath?: string;
  reset?: boolean;
  force?: boolean;
};

export async function runBrainSyncInit(input: RunBrainSyncInitInput): Promise<0 | 1> {
  if (!gate(input)) return 0;

  try {
    assertSafeEndpoint(input.endpoint);
    const prefix = normalizePrefix(input.prefix);

    if (existsSync(keyfilePath(input.storeRoot)) && !(input.reset && input.force)) {
      input.stderr(
        "error: brain sync keyfile already exists — pass --reset --force to regenerate (DESTRUCTIVE: existing remote data becomes unreadable)",
      );
      return 1;
    }

    const joined = input.join !== undefined;
    const key =
      input.join !== undefined
        ? decodeRecoveryCode(input.join)
        : input.keyfileImportPath !== undefined
          ? loadKeyfile(input.keyfileImportPath)
          : generateKey();

    const transport = await createTransport({
      endpoint: input.endpoint,
      region: input.region,
      bucket: input.bucket,
      prefix,
      pathStyle: input.pathStyle,
    });
    const ok = await probeConditionalWrites(transport);
    if (!ok) {
      input.stderr(
        "error: endpoint does not enforce conditional writes — refusing to sync against it (conditional_writes_unsupported)",
      );
      return 1;
    }

    saveKeyfile(keyfilePath(input.storeRoot), key);
    saveConfig(input.storeRoot, {
      schemaVersion: 1,
      endpoint: input.endpoint,
      bucket: input.bucket,
      prefix,
      region: input.region,
      pathStyle: input.pathStyle,
      conditionalWritesVerified: true,
      lastSeen: {},
    });

    if (joined) {
      input.stdout("Joined existing brain sync.");
    } else {
      input.stdout(`Recovery code: ${encodeRecoveryCode(key)}`);
      input.stdout("Store this recovery code now — it will not be shown again.");
    }
    return 0;
  } catch (err) {
    if (err instanceof BrainSyncError) {
      input.stderr(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

export const brainSyncInitCommand = defineCommand({
  meta: {
    name: "init",
    description: "Configure brain sync against an S3-compatible endpoint (Mega Saver Pro).",
  },
  args: {
    endpoint: { type: "string", required: true, description: "S3-compatible endpoint URL." },
    bucket: { type: "string", required: true, description: "Bucket name." },
    prefix: { type: "string", default: "megasaver-brain", description: "Key prefix." },
    region: { type: "string", default: "auto", description: "Region." },
    pathStyle: { type: "boolean", default: true, description: "Use path-style addressing." },
    join: { type: "string", description: "Join an existing sync using a recovery code." },
    keyfile: { type: "string", description: "Import a key from an existing keyfile path." },
    reset: { type: "boolean", default: false, description: "Allow regenerating the keyfile." },
    force: { type: "boolean", default: false, description: "Confirm a destructive keyfile reset." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const storeInput = readStoreEnv(typeof args.store === "string" ? args.store : undefined);
    const storeRoot = resolveStorePath(storeInput);
    const code = await runBrainSyncInit({
      storeRoot,
      now: () => Date.now(),
      endpoint: String(args.endpoint),
      bucket: String(args.bucket),
      prefix: String(args.prefix),
      region: String(args.region),
      pathStyle: !!args.pathStyle,
      ...(typeof args.join === "string" ? { join: args.join } : {}),
      ...(typeof args.keyfile === "string" ? { keyfileImportPath: args.keyfile } : {}),
      reset: !!args.reset,
      force: !!args.force,
      ensureStore: () => ensureStoreReady(storeRoot),
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
