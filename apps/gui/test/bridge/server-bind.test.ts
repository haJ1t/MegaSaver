import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeServer } from "../../bridge/server.js";

describe("createBridgeServer — loopback bind", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  it("binds the bridge to 127.0.0.1, never all interfaces", async () => {
    const noop = (): void => {};
    // port 0 → ephemeral; the host is what matters for this test.
    const server = createBridgeServer(noop, 0);
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));

    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    const address = server.address() as AddressInfo;
    expect(address.address).toBe("127.0.0.1");
  });
});
