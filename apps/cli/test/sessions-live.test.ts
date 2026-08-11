import { buildLiveTable } from "@megasaver/daemon";
import { describe, expect, it } from "vitest";

describe("sessions live via daemon buildLiveTable", () => {
  it("burn null → n/a and claim badge", () => {
    const t = buildLiveTable({
      sessions: [
        {
          liveSessionId: "a",
          agent: "claude",
          cwd: "/x/y/z",
          lastSeenAt: "2026-08-11T00:00:00.000Z",
        },
      ],
      statsBurn: new Map([["a", null]]),
      claimCounts: new Map([["a", 2]]),
      now: () => Date.parse("2026-08-11T00:01:00.000Z"),
    });
    expect(t.sessions[0]?.burn).toBeNull();
    expect(t.sessions[0]?.claimWarnings).toBe(2);
  });
});
