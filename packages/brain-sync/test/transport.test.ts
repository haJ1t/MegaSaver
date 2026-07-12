import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrainSyncError } from "../src/errors.js";
import { type Transport, createTransport, probeConditionalWrites } from "../src/transport.js";
import { type S3Double, startS3Double } from "./helpers/s3-double.js";

let double: S3Double;
let transport: Transport;

beforeAll(async () => {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_ACCESS_KEY_ID"] = "test";
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  process.env["MEGA_SYNC_SECRET_ACCESS_KEY"] = "test";
  double = await startS3Double();
  transport = await createTransport({
    endpoint: double.url,
    region: "auto",
    bucket: "test-bucket",
    prefix: "p/",
    pathStyle: true,
  });
});
afterAll(async () => {
  await double.close();
});

describe("transport", () => {
  it("getObject returns null on 404", async () => {
    expect(await transport.getObject("missing")).toBeNull();
  });

  it("put → get round-trips body and etag, under the prefix", async () => {
    const body = Buffer.from("hello");
    const put = await transport.putObject("a/b.enc", body);
    const got = await transport.getObject("a/b.enc");
    expect(got).not.toBeNull();
    expect(Buffer.from(got?.body ?? new Uint8Array())).toEqual(body);
    expect(got?.etag).toBe(put.etag);
    expect(double.store.has("p/a/b.enc")).toBe(true);
  });

  it("if-none-match on an existing key → precondition_failed", async () => {
    await transport.putObject("dup", Buffer.from("x"));
    try {
      await transport.putObject("dup", Buffer.from("y"), { kind: "if-none-match" });
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("precondition_failed");
    }
  });

  it("if-match with a stale etag → precondition_failed; fresh etag succeeds", async () => {
    const { etag } = await transport.putObject("cas", Buffer.from("v1"));
    try {
      await transport.putObject("cas", Buffer.from("v2"), { kind: "if-match", etag: '"deadbeef"' });
      expect.unreachable();
    } catch (err) {
      expect((err as BrainSyncError).code).toBe("precondition_failed");
    }
    await expect(
      transport.putObject("cas", Buffer.from("v2"), { kind: "if-match", etag }),
    ).resolves.toBeDefined();
  });

  it("deleteObject removes; probe passes against an enforcing store", async () => {
    await transport.putObject("gone", Buffer.from("x"));
    await transport.deleteObject("gone");
    expect(await transport.getObject("gone")).toBeNull();
    expect(await probeConditionalWrites(transport)).toBe(true);
  });

  it("wraps a network failure as transport_error (no raw SDK error)", async () => {
    const dead = await createTransport({
      endpoint: "http://127.0.0.1:1",
      region: "auto",
      bucket: "b",
      prefix: "p/",
      pathStyle: true,
    });
    try {
      await dead.getObject("anything");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BrainSyncError);
      expect((err as BrainSyncError).code).toBe("transport_error");
    }
  });

  it("probe returns false against a non-enforcing store", async () => {
    const lax = await startS3Double({ enforce: false });
    try {
      const laxTransport = await createTransport({
        endpoint: lax.url,
        region: "auto",
        bucket: "b",
        prefix: "p/",
        pathStyle: true,
      });
      expect(await probeConditionalWrites(laxTransport)).toBe(false);
    } finally {
      await lax.close();
    }
  });
});
