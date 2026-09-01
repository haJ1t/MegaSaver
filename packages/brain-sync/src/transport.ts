import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { BrainSyncError } from "./errors.js";
import { sha256Hex } from "./hash.js";

export type TransportConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
};

export type PutCondition = { kind: "if-match"; etag: string } | { kind: "if-none-match" };

export type Transport = {
  getObject(key: string): Promise<{ body: Uint8Array; etag: string } | null>;
  putObject(key: string, body: Uint8Array, condition?: PutCondition): Promise<{ etag: string }>;
  deleteObject(key: string): Promise<void>;
};

const statusOf = (err: unknown): number | undefined =>
  (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const nameOf = (err: unknown): string | undefined => (err as { name?: string }).name;

function isLocalEndpoint(endpoint: string): boolean {
  return (
    endpoint === "local" ||
    endpoint.startsWith("file://") ||
    endpoint.includes("livingbrain.megasaver.local") ||
    endpoint.endsWith(".local")
  );
}

function assertKeySafe(baseDir: string, key: string): string {
  if (key.includes("\0")) {
    throw new BrainSyncError("transport_error", "Invalid key: contains null byte");
  }
  if (key.includes("..") || isAbsolute(key)) {
    throw new BrainSyncError("transport_error", `Invalid key: traversal not allowed: ${key}`);
  }
  const fullPath = join(baseDir, key);
  const normalizedBase = baseDir.endsWith(sep) ? baseDir.slice(0, -1) : baseDir;
  if (fullPath !== normalizedBase && !fullPath.startsWith(normalizedBase + sep)) {
    throw new BrainSyncError("transport_error", `Invalid key: escapes baseDir: ${key}`);
  }
  return fullPath;
}

function assertBucketPrefixSafe(bucket: string, prefix: string): void {
  if (
    bucket.includes("\0") ||
    bucket.includes("..") ||
    isAbsolute(bucket) ||
    prefix.includes("\0") ||
    prefix.includes("..") ||
    isAbsolute(prefix)
  ) {
    throw new BrainSyncError("transport_error", "Invalid bucket/prefix");
  }
}

function createLocalFsTransport(config: TransportConfig): Transport {
  assertBucketPrefixSafe(config.bucket, config.prefix);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const customStore = process.env["MEGASAVER_STORE_ROOT"];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
  const storeRoot =
    customStore && customStore.length > 0
      ? customStore
      : home.length > 0
        ? join(home, ".megasaver")
        : tmpdir();
  const baseDir = join(storeRoot, "living-brain", config.bucket, config.prefix);

  const getEtag = (bytes: Uint8Array): string =>
    `"${sha256Hex(Buffer.from(bytes).toString("binary"))}"`;

  return {
    async getObject(key: string) {
      const fullPath = assertKeySafe(baseDir, key);
      try {
        const raw = readFileSync(fullPath);
        const uint8 = new Uint8Array(raw);
        return { body: uint8, etag: getEtag(uint8) };
      } catch (_err) {
        if ((_err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new BrainSyncError("transport_error", `Local GET ${key} failed`);
      }
    },

    async putObject(key: string, body: Uint8Array, condition?: PutCondition) {
      const fullPath = assertKeySafe(baseDir, key);
      const etag = getEtag(body);

      if (condition?.kind === "if-none-match") {
        if (existsSync(fullPath)) {
          throw new BrainSyncError("precondition_failed", `conditional write failed for ${key}`);
        }
      } else if (condition?.kind === "if-match") {
        if (!existsSync(fullPath)) {
          throw new BrainSyncError("precondition_failed", `conditional write failed for ${key}`);
        }
        const existing = readFileSync(fullPath);
        const existingEtag = getEtag(new Uint8Array(existing));
        if (existingEtag !== condition.etag) {
          throw new BrainSyncError("precondition_failed", `conditional write failed for ${key}`);
        }
      }

      atomicWriteFile(fullPath, body);
      return { etag };
    },

    async deleteObject(key: string) {
      const fullPath = assertKeySafe(baseDir, key);
      try {
        rmSync(fullPath, { force: true });
      } catch (_err) {
        throw new BrainSyncError("transport_error", `Local DELETE ${key} failed`);
      }
    },
  };
}

// @aws-sdk/client-s3 is externalized from the standalone `mega.mjs` bundle (it
// inlines ~1.2MB and pushes the binary past its size guard — see
// wiki/decisions/bundle-externalize-native-chain.md). npm-installed CLIs get it
// via the `@megasaver/cli` optionalDependency; a bare `node mega.mjs` download
// resolves it from node_modules at runtime or, if absent, hits this mapping —
// which turns the raw loader error into a friendly, actionable transport_error.
export function rethrowSdkLoadError(err: NodeJS.ErrnoException): never {
  if (err.code === "ERR_MODULE_NOT_FOUND" || err.code === "MODULE_NOT_FOUND") {
    throw new BrainSyncError(
      "transport_error",
      // Keep the original loader message: a PARTIAL install (@aws-sdk present but a
      // transitive smithy-runtime dep missing) would otherwise be masked by the npm-i
      // advice. (The literal SDK scope is spelled without the slash on purpose: the
      // bundle-smoke guard greps the built mega.mjs for that inlined-SDK marker.)
      `the @aws-sdk/client-s3 package is required for brain sync but is not installed — run \`npm i @aws-sdk/client-s3\` (bundled CLI users have it automatically). Original: ${err.message}`,
    );
  }
  throw err;
}

export async function createTransport(config: TransportConfig): Promise<Transport> {
  assertBucketPrefixSafe(config.bucket, config.prefix);
  if (isLocalEndpoint(config.endpoint)) {
    return createLocalFsTransport(config);
  }

  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import(
    "@aws-sdk/client-s3"
  ).catch(rethrowSdkLoadError);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const syncAccessKeyId = process.env["MEGA_SYNC_ACCESS_KEY_ID"];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const awsAccessKeyId = process.env["AWS_ACCESS_KEY_ID"];
  const accessKeyId = syncAccessKeyId ?? awsAccessKeyId;

  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const syncSecretKey = process.env["MEGA_SYNC_SECRET_ACCESS_KEY"];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const awsSecretKey = process.env["AWS_SECRET_ACCESS_KEY"];
  const secretAccessKey = syncSecretKey ?? awsSecretKey;
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.pathStyle,
    // WHEN_REQUIRED: the default WHEN_SUPPORTED can switch a body to
    // Content-Encoding: aws-chunked framing, which corrupts stores that don't
    // decode it. Our bodies are always in-memory Buffers of known length;
    // disabling opportunistic checksums keeps the wire body == the plaintext
    // bytes for both the test double and real S3/R2.
    requestChecksumCalculation: "WHEN_REQUIRED",
    ...(accessKeyId !== undefined && secretAccessKey !== undefined
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  // Bodies MUST be in-memory Buffers/Uint8Arrays of known length (never
  // streams) so no aws-chunked framing kicks in. pathStyle MUST be true.
  const fullKey = (key: string) => `${config.prefix}${key}`;

  return {
    async getObject(key) {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: fullKey(key) }),
        );
        const body = await response.Body?.transformToByteArray();
        if (body === undefined || response.ETag === undefined) {
          throw new BrainSyncError(
            "transport_error",
            `S3 GET ${key}: response missing body or ETag`,
          );
        }
        return { body, etag: response.ETag };
      } catch (err) {
        if (err instanceof BrainSyncError) throw err;
        if (
          nameOf(err) === "NoSuchKey" ||
          (statusOf(err) === 404 && nameOf(err) !== "NoSuchBucket")
        ) {
          return null;
        }
        if (nameOf(err) === "CredentialsProviderError") {
          throw new BrainSyncError(
            "transport_error",
            "S3 credentials missing — set MEGA_SYNC_ACCESS_KEY_ID and MEGA_SYNC_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) in your environment",
          );
        }
        throw new BrainSyncError(
          "transport_error",
          `S3 GET ${key} failed: ${nameOf(err) ?? "request failed"}${statusOf(err) !== undefined ? ` (${statusOf(err)})` : ""}`,
        );
      }
    },

    async putObject(key, body, condition) {
      try {
        const response = await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: fullKey(key),
            Body: body,
            ...(condition?.kind === "if-match" ? { IfMatch: condition.etag } : {}),
            ...(condition?.kind === "if-none-match" ? { IfNoneMatch: "*" } : {}),
          }),
        );
        if (response.ETag === undefined) {
          throw new BrainSyncError("transport_error", `S3 PUT ${key}: response missing ETag`);
        }
        return { etag: response.ETag };
      } catch (err) {
        if (err instanceof BrainSyncError) throw err;
        if (statusOf(err) === 412 || nameOf(err) === "PreconditionFailed") {
          throw new BrainSyncError("precondition_failed", `conditional write failed for ${key}`);
        }
        if (nameOf(err) === "CredentialsProviderError") {
          throw new BrainSyncError(
            "transport_error",
            "S3 credentials missing — set MEGA_SYNC_ACCESS_KEY_ID and MEGA_SYNC_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) in your environment",
          );
        }
        throw new BrainSyncError(
          "transport_error",
          `S3 PUT ${key} failed: ${nameOf(err) ?? "request failed"}${statusOf(err) !== undefined ? ` (${statusOf(err)})` : ""}`,
        );
      }
    },

    async deleteObject(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: fullKey(key) }));
      } catch (err) {
        if (err instanceof BrainSyncError) throw err;
        if (nameOf(err) === "CredentialsProviderError") {
          throw new BrainSyncError(
            "transport_error",
            "S3 credentials missing — set MEGA_SYNC_ACCESS_KEY_ID and MEGA_SYNC_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY) in your environment",
          );
        }
        throw new BrainSyncError(
          "transport_error",
          `S3 DELETE ${key} failed: ${nameOf(err) ?? "request failed"}${statusOf(err) !== undefined ? ` (${statusOf(err)})` : ""}`,
        );
      }
    },
  };
}

// True only when the endpoint actually ENFORCES conditional writes:
// stale If-Match must 412, If-None-Match:* over an existing key must 412.
export async function probeConditionalWrites(transport: Transport): Promise<boolean> {
  const probeKey = `probe/${randomUUID()}`;
  await transport.putObject(probeKey, Buffer.from("megasaver-probe"));
  try {
    let enforced = false;
    try {
      await transport.putObject(probeKey, Buffer.from("x"), {
        kind: "if-match",
        etag: '"00000000000000000000000000000000"',
      });
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") enforced = true;
      else throw err;
    }
    if (!enforced) return false;
    try {
      await transport.putObject(probeKey, Buffer.from("x"), { kind: "if-none-match" });
      return false;
    } catch (err) {
      if (err instanceof BrainSyncError && err.code === "precondition_failed") return true;
      throw err;
    }
  } finally {
    await transport.deleteObject(probeKey).catch(() => {});
  }
}
