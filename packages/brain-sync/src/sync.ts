import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "./crypto.js";
import { BrainSyncError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import {
  MANIFEST_KEY,
  type SyncManifest,
  objectAad,
  openManifest,
  sealManifest,
} from "./manifest.js";
import type { Transport } from "./transport.js";

export type SyncDeps = {
  transport: Transport;
  key: Uint8Array;
  projectId: string;
  lastSeenGeneration: () => number;
  persistLastSeen: (generation: number) => void;
  exportBundle: () => string;
  importBundle: (bundleText: string) => void;
  now: () => Date;
};

export type PullResult =
  | { state: "empty" }
  | { state: "up-to-date"; generation: number }
  | { state: "merged"; generation: number };

export type PushResult =
  | { state: "up-to-date"; generation: number }
  | { state: "pushed"; generation: number; merged: boolean };

export type StatusResult =
  | { state: "empty" }
  | {
      state: "ok";
      remoteGeneration: number;
      lastSeenGeneration: number;
      upToDate: boolean;
      updatedAt: string;
    };

type RemoteState = { manifest: SyncManifest; etag: string };

const MAX_CAS_ATTEMPTS = 3;

async function readRemote(
  transport: Transport,
  key: Uint8Array,
  projectId: string,
): Promise<RemoteState | null> {
  const got = await transport.getObject(MANIFEST_KEY);
  if (got === null) return null;
  try {
    return { manifest: openManifest(got.body, key, projectId), etag: got.etag };
  } catch (err) {
    if (err instanceof BrainSyncError && err.code === "decrypt_failed") {
      throw new BrainSyncError(
        "wrong_key",
        "remote manifest exists but cannot be decrypted with this keyfile — run `mega brain sync init --join` with the original recovery code",
      );
    }
    throw err;
  }
}

async function mergeRemote(deps: SyncDeps, remote: RemoteState): Promise<PullResult> {
  const { manifest } = remote;
  const lastSeen = deps.lastSeenGeneration();
  if (manifest.generation < lastSeen) {
    throw new BrainSyncError(
      "rollback_detected",
      `remote generation ${manifest.generation} is older than last-seen ${lastSeen} — refusing to merge a rolled-back manifest`,
    );
  }
  if (manifest.generation === lastSeen)
    return { state: "up-to-date", generation: manifest.generation };
  const obj = await deps.transport.getObject(manifest.objectKey);
  if (obj === null) {
    throw new BrainSyncError(
      "manifest_invalid",
      `manifest points at missing object ${manifest.objectKey}`,
    );
  }
  const bundleText = decrypt(
    obj.body,
    deps.key,
    objectAad(deps.projectId, manifest.objectKey),
  ).toString("utf8");
  if (sha256Hex(bundleText) !== manifest.brainSha256) {
    throw new BrainSyncError(
      "hash_mismatch",
      "decrypted bundle does not match the manifest brainSha256",
    );
  }
  deps.importBundle(bundleText);
  deps.persistLastSeen(manifest.generation);
  return { state: "merged", generation: manifest.generation };
}

export async function pull(deps: SyncDeps): Promise<PullResult> {
  const remote = await readRemote(deps.transport, deps.key, deps.projectId);
  if (remote === null) return { state: "empty" };
  return mergeRemote(deps, remote);
}

export async function status(
  deps: Pick<SyncDeps, "transport" | "key" | "projectId" | "lastSeenGeneration">,
): Promise<StatusResult> {
  const remote = await readRemote(deps.transport, deps.key, deps.projectId);
  if (remote === null) return { state: "empty" };
  const lastSeen = deps.lastSeenGeneration();
  return {
    state: "ok",
    remoteGeneration: remote.manifest.generation,
    lastSeenGeneration: lastSeen,
    upToDate: remote.manifest.generation === lastSeen,
    updatedAt: remote.manifest.updatedAt,
  };
}

export async function push(deps: SyncDeps): Promise<PushResult> {
  let merged = false;
  for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt += 1) {
    const remote = await readRemote(deps.transport, deps.key, deps.projectId);
    if (remote !== null) {
      const mergeResult = await mergeRemote(deps, remote);
      if (mergeResult.state === "merged") merged = true;
    }
    const bundleText = deps.exportBundle();
    const brainSha256 = sha256Hex(bundleText);
    if (remote !== null && remote.manifest.brainSha256 === brainSha256) {
      return { state: "up-to-date", generation: remote.manifest.generation };
    }
    const objectKey = `objects/${randomUUID()}.enc`;
    const ciphertext = encrypt(
      Buffer.from(bundleText, "utf8"),
      deps.key,
      objectAad(deps.projectId, objectKey),
    );
    await deps.transport.putObject(objectKey, ciphertext);
    const manifest: SyncManifest = {
      schemaVersion: 1,
      generation: (remote?.manifest.generation ?? 0) + 1,
      updatedAt: deps.now().toISOString(),
      brainSha256,
      objectKey,
    };
    try {
      await deps.transport.putObject(
        MANIFEST_KEY,
        sealManifest(manifest, deps.key, deps.projectId),
        remote === null ? { kind: "if-none-match" } : { kind: "if-match", etag: remote.etag },
      );
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") {
        await deps.transport.deleteObject(objectKey).catch(() => {});
        continue;
      }
      throw err;
    }
    deps.persistLastSeen(manifest.generation);
    if (remote !== null && remote.manifest.objectKey !== objectKey) {
      await deps.transport.deleteObject(remote.manifest.objectKey).catch(() => {});
    }
    return { state: "pushed", generation: manifest.generation, merged };
  }
  throw new BrainSyncError(
    "sync_conflict",
    "another machine kept updating the remote (3 attempts) — re-run `mega brain sync`",
  );
}
