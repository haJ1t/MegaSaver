import { describe, expect, it } from "vitest";
import {
  HANDOFF_SCHEMA_VERSION,
  HandoffPacketError,
  diagnoseHandoffPacket,
  handoffGitSchema,
  handoffManifestSchema,
  handoffPayloadSchema,
  parseHandoffPacket,
  serializeHandoffPacket,
} from "../src/index.js";

describe("core index handoff exports", () => {
  it("re-exports the handoff packet surface", () => {
    expect(HANDOFF_SCHEMA_VERSION).toBe("1");
    expect(typeof serializeHandoffPacket).toBe("function");
    expect(typeof parseHandoffPacket).toBe("function");
    expect(typeof diagnoseHandoffPacket).toBe("function");
    expect(typeof handoffManifestSchema.parse).toBe("function");
    expect(typeof handoffGitSchema.parse).toBe("function");
    expect(typeof handoffPayloadSchema.parse).toBe("function");
    expect(new HandoffPacketError("expired", "x").code).toBe("expired");
  });
});
