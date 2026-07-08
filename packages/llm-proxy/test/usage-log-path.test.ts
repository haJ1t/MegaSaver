// packages/llm-proxy/test/usage-log-path.test.ts
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proxyUsageLogPath } from "../src/index.js";

describe("proxyUsageLogPath", () => {
  it("locates usage.jsonl under proxy-usage in the store root", () => {
    expect(proxyUsageLogPath("/tmp/store")).toBe(join("/tmp/store", "proxy-usage", "usage.jsonl"));
  });
});
