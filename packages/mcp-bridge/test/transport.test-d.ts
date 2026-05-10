import { describe, it } from "vitest";
import { type McpTransport, mcpTransportSchema } from "../src/transport.js";

describe("McpTransport type regression", () => {
  it("each v0.3 member is a valid McpTransport", () => {
    const _a: McpTransport = "stdio";
    const _b: McpTransport = "sse";
    void _a;
    void _b;
  });

  it("non-member string literal is not assignable to McpTransport", () => {
    // @ts-expect-error non-member literal is not McpTransport
    const _bad: McpTransport = "websocket";
    void _bad;
  });

  it("non-member string-cast is not assignable to McpTransport", () => {
    // @ts-expect-error arbitrary string is not assignable to McpTransport
    const _bad: McpTransport = "tcp" as string;
    void _bad;
  });

  it("mcpTransportSchema.options spreads into McpTransport[]", () => {
    const arr: McpTransport[] = [...mcpTransportSchema.options];
    void arr;
  });

  it("mcpTransportSchema.options preserves launch-order", () => {
    const _t: readonly ["stdio", "sse"] = mcpTransportSchema.options;
    void _t;
  });
});
