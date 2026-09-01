import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTransport, probeConditionalWrites } from "../src/transport.js";

describe("local filesystem transport for 1-click Living Brain", () => {
  let tmpStore: string;

  beforeEach(() => {
    tmpStore = mkdtempSync(join(tmpdir(), "living-brain-fs-test-"));
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGASAVER_STORE_ROOT"] = tmpStore;
  });

  afterEach(() => {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    // biome-ignore lint/performance/noDelete: test cleanup
    delete process.env["MEGASAVER_STORE_ROOT"];
    rmSync(tmpStore, { recursive: true, force: true });
  });

  it("handles local 1-click endpoint without AWS credentials", async () => {
    const transport = await createTransport({
      endpoint: "https://livingbrain.megasaver.local",
      region: "local",
      bucket: "living-brain",
      prefix: "my-project/",
      pathStyle: true,
    });

    // 1. Get non-existent
    const missing = await transport.getObject("manifest.json.enc");
    expect(missing).toBeNull();

    // 2. Put object
    const data = new TextEncoder().encode("encrypted-manifest-data");
    const putRes = await transport.putObject("manifest.json.enc", data);
    expect(typeof putRes.etag).toBe("string");
    expect(putRes.etag.length).toBeGreaterThan(0);

    // 3. Get object
    const got = await transport.getObject("manifest.json.enc");
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got?.body)).toBe("encrypted-manifest-data");
    expect(got?.etag).toBe(putRes.etag);

    // 4. Conditional write with stale etag should fail
    await expect(
      transport.putObject("manifest.json.enc", new TextEncoder().encode("v2"), {
        kind: "if-match",
        etag: '"stale-etag"',
      }),
    ).rejects.toThrow();

    // 5. Conditional write with matching etag should succeed
    const putV2 = await transport.putObject(
      "manifest.json.enc",
      new TextEncoder().encode("v2-data"),
      {
        kind: "if-match",
        etag: putRes.etag,
      },
    );
    expect(putV2.etag).not.toBe(putRes.etag);

    // 6. Delete object
    await transport.deleteObject("manifest.json.enc");
    const afterDel = await transport.getObject("manifest.json.enc");
    expect(afterDel).toBeNull();
  });

  it("passes probeConditionalWrites check", async () => {
    const transport = await createTransport({
      endpoint: "https://livingbrain.megasaver.local",
      region: "local",
      bucket: "living-brain",
      prefix: "probe-test/",
      pathStyle: true,
    });

    const passed = await probeConditionalWrites(transport);
    expect(passed).toBe(true);
  });
});
