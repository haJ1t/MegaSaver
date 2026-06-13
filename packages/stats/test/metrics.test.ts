import type { ProjectId, SessionId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import type { TokenSaverEvent } from "../src/event.js";
import {
  HOOK_MISSING_HINT,
  aggregateAdoption,
  buildProxyMetrics,
  computeInterception,
  ingestHookLog,
  proxyToolNameForSourceKind,
} from "../src/metrics.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111" as SessionId;
const PROJECT_ID = "22222222-2222-4222-8222-222222222222" as ProjectId;

const makeEvent = (overrides: Partial<TokenSaverEvent> = {}): TokenSaverEvent =>
  ({
    id: "evt-1",
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    createdAt: "2026-05-10T12:00:00.000Z",
    sourceKind: "file",
    label: "read",
    rawBytes: 1000,
    returnedBytes: 200,
    bytesSaved: 800,
    savingRatio: 0.8,
    summary: "s",
    mode: "balanced",
    ...overrides,
  }) as TokenSaverEvent;

describe("proxyToolNameForSourceKind", () => {
  it("maps each source kind to its proxy tool name", () => {
    expect(proxyToolNameForSourceKind("file")).toBe("proxy_read_file");
    expect(proxyToolNameForSourceKind("command")).toBe("proxy_run_command");
    expect(proxyToolNameForSourceKind("grep")).toBe("proxy_search_code");
    expect(proxyToolNameForSourceKind("fetch")).toBe("proxy_expand_chunk");
  });
});

describe("aggregateAdoption", () => {
  it("counts every recorded event as a known megasaver + proxy call (rate 1.0)", () => {
    const adoption = aggregateAdoption([
      makeEvent({ sourceKind: "file" }),
      makeEvent({ sourceKind: "command" }),
    ]);
    expect(adoption.proxy_adoption_rate).toBe(1);
    expect(adoption.proxy_call_count).toBe(2);
  });

  it("breaks proxy calls down by type", () => {
    const adoption = aggregateAdoption([
      makeEvent({ sourceKind: "file" }),
      makeEvent({ sourceKind: "file" }),
      makeEvent({ sourceKind: "command" }),
      makeEvent({ sourceKind: "grep" }),
      makeEvent({ sourceKind: "fetch" }),
    ]);
    expect(adoption.proxy_calls_by_type).toEqual({
      proxy_read_file: 2,
      proxy_run_command: 1,
      proxy_search_code: 1,
      proxy_expand_chunk: 1,
    });
  });

  it("computes expand rate as expand calls over compressed-response count", () => {
    const adoption = aggregateAdoption([
      makeEvent({ sourceKind: "file" }),
      makeEvent({ sourceKind: "command" }),
      makeEvent({ sourceKind: "fetch" }),
    ]);
    // 1 expand (fetch) over 2 compressed responses (file + command).
    expect(adoption.expand_rate).toBeCloseTo(0.5);
  });

  it("sums proxy-mediated token savings and raw stored output count", () => {
    const adoption = aggregateAdoption([
      makeEvent({ sourceKind: "file", rawBytes: 1000, returnedBytes: 200, bytesSaved: 800 }),
      makeEvent({ sourceKind: "command", rawBytes: 4000, returnedBytes: 1000, bytesSaved: 3000 }),
    ]);
    expect(adoption.proxy_mediated_token_savings).toBe(3800);
    expect(adoption.raw_stored_output_count).toBe(2);
  });

  it("computes average compression ratio over events", () => {
    const adoption = aggregateAdoption([
      makeEvent({ savingRatio: 0.8 }),
      makeEvent({ savingRatio: 0.4 }),
    ]);
    expect(adoption.avg_compression_ratio).toBeCloseTo(0.6);
  });

  it("returns a defined zero block with no divide-by-zero on empty input", () => {
    const adoption = aggregateAdoption([]);
    expect(adoption.proxy_adoption_rate).toBe(0);
    expect(adoption.proxy_call_count).toBe(0);
    expect(adoption.expand_rate).toBe(0);
    expect(adoption.avg_compression_ratio).toBe(0);
    expect(adoption.proxy_mediated_token_savings).toBe(0);
    expect(adoption.raw_stored_output_count).toBe(0);
  });
});

describe("ingestHookLog", () => {
  it("counts well-formed eligible native records across all five tools", () => {
    const log = [
      `{"timestamp":"2026-06-12T00:00:00.000Z","agent":"claude-code","tool":"Read","category":"eligible_read","filePath":"a.ts","sessionId":"s1"}`,
      `{"timestamp":"2026-06-12T00:00:01.000Z","agent":"claude-code","tool":"Bash","category":"eligible_command","sessionId":"s1"}`,
      `{"timestamp":"2026-06-12T00:00:02.000Z","agent":"claude-code","tool":"Grep","category":"eligible_search","sessionId":"s1"}`,
      `{"timestamp":"2026-06-12T00:00:03.000Z","agent":"claude-code","tool":"Glob","category":"eligible_search","sessionId":"s1"}`,
      `{"timestamp":"2026-06-12T00:00:04.000Z","agent":"claude-code","tool":"LS","category":"eligible_read","sessionId":"s1"}`,
    ].join("\n");
    expect(ingestHookLog(log).nativeEligibleCount).toBe(5);
  });

  it("skips malformed and non-JSON lines, ignores unknown fields", () => {
    const log = [
      `{"tool":"Read","category":"eligible_read"}`,
      "not json at all",
      `{"tool":"Bash","category":"eligible_command","extra":"ignored"}`,
      `{"tool":`, // truncated
    ].join("\n");
    expect(ingestHookLog(log).nativeEligibleCount).toBe(2);
  });

  it("treats category as opaque and keys eligibility on tool name", () => {
    const log = [
      `{"tool":"Read","category":"some_future_tag"}`,
      `{"tool":"NotEligibleTool","category":"eligible_read"}`,
    ].join("\n");
    expect(ingestHookLog(log).nativeEligibleCount).toBe(1);
  });

  it("tolerates an empty file", () => {
    expect(ingestHookLog("").nativeEligibleCount).toBe(0);
  });
});

describe("computeInterception", () => {
  it("computes proxy_eligible / (proxy_eligible + native_eligible)", () => {
    const interception = computeInterception(3, 1);
    expect(interception.hook_present).toBe(true);
    expect(interception.proxy_eligible_calls).toBe(3);
    expect(interception.native_eligible_calls_from_hook).toBe(1);
    expect(interception.hook_interception_rate).toBeCloseTo(0.75);
  });

  it("yields 0.0 on a zero denominator without dividing by zero", () => {
    expect(computeInterception(0, 0).hook_interception_rate).toBe(0);
  });
});

describe("buildProxyMetrics", () => {
  const events = [
    makeEvent({ sourceKind: "file" }),
    makeEvent({ sourceKind: "command" }),
    makeEvent({ sourceKind: "fetch" }),
  ];

  it("includes adoption + savings and null interception when no hook log", () => {
    const metrics = buildProxyMetrics({ events, hookLog: null });
    expect(metrics.adoption.proxy_call_count).toBe(3);
    expect(metrics.interception).toBeNull();
    expect(metrics.interception_hint).toBe(HOOK_MISSING_HINT);
  });

  it("populates the interception block when a hook log is present", () => {
    const log = [
      `{"tool":"Read","category":"eligible_read"}`,
      `{"tool":"Bash","category":"eligible_command"}`,
    ].join("\n");
    const metrics = buildProxyMetrics({ events, hookLog: log });
    expect(metrics.interception).not.toBeNull();
    // 3 proxy-eligible events, 2 native eligible from hook -> 3/5.
    expect(metrics.interception?.hook_interception_rate).toBeCloseTo(0.6);
    expect(metrics.interception?.proxy_eligible_calls).toBe(3);
    expect(metrics.interception?.native_eligible_calls_from_hook).toBe(2);
    expect(metrics.adoption.proxy_call_count).toBe(3);
  });

  it("uses the verbatim spec sec 13.6 missing-hook hint", () => {
    expect(HOOK_MISSING_HINT).toBe(
      "Proxy adoption metrics only. Claude Code hook telemetry not configured. Run: mega hooks install claude-code",
    );
  });
});
