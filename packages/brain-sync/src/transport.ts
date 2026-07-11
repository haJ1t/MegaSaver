import { randomUUID } from "node:crypto";
import { BrainSyncError } from "./errors.js";

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

export async function createTransport(config: TransportConfig): Promise<Transport> {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const accessKeyId = process.env["MEGA_SYNC_ACCESS_KEY_ID"];
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const secretAccessKey = process.env["MEGA_SYNC_SECRET_ACCESS_KEY"];
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
