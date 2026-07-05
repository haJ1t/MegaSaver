import { describe, expectTypeOf, it } from "vitest";
import type { ProxyStatus as BridgeProxyStatus } from "../bridge/proxy-control.js";
import type { ProxyStatus as ClientProxyStatus } from "../src/lib/claude-sessions-client.js";

// The GET/POST /api/proxy handlers return the bridge ProxyStatus verbatim, so the
// client type MUST stay structurally identical. Commit 297ebc28 reshaped the
// bridge shape (running/url/port -> enabled/routed/routeConflict/reconcileBlocked)
// without updating the client, and the drift went undetected because no test tied
// the two together — the view then read fields the server no longer emitted. This
// pins them together so a future divergence fails typecheck.
describe("proxy status client/server contract", () => {
  it("client ProxyStatus is structurally identical to the bridge ProxyStatus", () => {
    expectTypeOf<ClientProxyStatus>().toEqualTypeOf<BridgeProxyStatus>();
  });
});
