import { describe, expect, it } from "vitest";
import * as pkg from "../dist/index.js";

describe("@megasaver/connectors-shared public exports", () => {
  it("exposes the v0.1 surface", () => {
    expect(typeof pkg.MEGA_SAVER_BLOCK_START).toBe("string");
    expect(typeof pkg.MEGA_SAVER_BLOCK_END).toBe("string");
    expect(typeof pkg.renderBlock).toBe("function");
    expect(typeof pkg.parseBlock).toBe("function");
    expect(typeof pkg.projectionPreflight).toBe("function");
    expect(typeof pkg.upsertBlock).toBe("function");
    expect(typeof pkg.removeBlock).toBe("function");
    expect(typeof pkg.readTargetFile).toBe("function");
    expect(typeof pkg.writeTargetFile).toBe("function");
    expect(typeof pkg.syncTargetBlock).toBe("function");
    expect(typeof pkg.assertConnectorContext).toBe("function");
    expect(typeof pkg.ConnectorError).toBe("function");
    expect(pkg.connectorErrorCodeSchema).toBeDefined();
    expect(pkg.ConnectorContextSchema).toBeDefined();
  });
});
