import { describe, expect, it } from "vitest";
import {
  type CacheSuffixRisk,
  auditClaudeCacheSuffix,
  checkGeneratedOutputByteVariance,
} from "../src/cache-suffix-audit.js";

const FAKE_SECRET = "FAKE_SUFFIX_AUDIT_SECRET_DO_NOT_LEAK";
const FOREIGN_URL = "https://gateway.example.invalid/v1";

function serialized(risks: readonly CacheSuffixRisk[]): string {
  return JSON.stringify(risks);
}

describe("auditClaudeCacheSuffix settings risks", () => {
  it("flags a duplicate owned hook once per event/subcommand pair with the owned count", () => {
    const risks = auditClaudeCacheSuffix(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Read",
              hooks: [
                { type: "command", command: "mega hooks cache-advice" },
                { type: "command", command: "mega hooks cache-advice" },
                { type: "command", command: `echo ${FAKE_SECRET}` },
              ],
            },
          ],
        },
      },
      {},
    );
    expect(risks).toEqual([
      {
        scope: "configuration-risk",
        code: "duplicate_megasaver_hook",
        surface: { event: "PreToolUse", subcommand: "cache-advice", count: 2 },
      },
    ]);
    expect(serialized(risks)).not.toContain(FAKE_SECRET);
  });

  it("does not flag a single owned hook or a foreign command that merely mentions mega", () => {
    const risks = auditClaudeCacheSuffix(
      {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: "command", command: "mega hooks cache-advice" },
                { type: "command", command: "echo mega hooks cache-advice" },
              ],
            },
          ],
        },
      },
      {},
    );
    expect(risks).toEqual([]);
  });

  it("does not treat different owned subcommands in one event as duplicates", () => {
    const risks = auditClaudeCacheSuffix(
      {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: "command", command: "mega hooks log" },
                { type: "command", command: "mega hooks saver" },
              ],
            },
          ],
        },
      },
      {},
    );
    expect(risks).toEqual([]);
  });

  it("flags a foreign custom base URL separately from the missing first-party flag", () => {
    const risks = auditClaudeCacheSuffix(
      { env: { ANTHROPIC_BASE_URL: FOREIGN_URL } },
      { ownedRouteBaseUrl: "http://127.0.0.1:8787" },
    );
    expect(risks).toEqual([
      { scope: "configuration-risk", code: "foreign_custom_base_url" },
      { scope: "configuration-risk", code: "owned_route_missing_first_party_flag" },
    ]);
    expect(serialized(risks)).not.toContain("gateway.example.invalid");
  });

  it("flags only the missing first-party flag on Mega Saver's own route", () => {
    const risks = auditClaudeCacheSuffix(
      { env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" } },
      { ownedRouteBaseUrl: "http://127.0.0.1:8787" },
    );
    expect(risks).toEqual([
      { scope: "configuration-risk", code: "owned_route_missing_first_party_flag" },
    ]);
  });

  it("flags neither URL risk on the owned route with the first-party flag set", () => {
    const risks = auditClaudeCacheSuffix(
      {
        env: {
          ANTHROPIC_BASE_URL: "http://127.0.0.1:8787",
          _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: "1",
        },
      },
      { ownedRouteBaseUrl: "http://127.0.0.1:8787" },
    );
    expect(risks).toEqual([]);
  });

  it("produces no URL risks when no base URL is set, even without the flag", () => {
    expect(auditClaudeCacheSuffix({ env: {} }, {})).toEqual([]);
    expect(auditClaudeCacheSuffix({}, {})).toEqual([]);
  });
});

describe("checkGeneratedOutputByteVariance", () => {
  it("returns an empty list when every generated surface is byte-stable", () => {
    expect(checkGeneratedOutputByteVariance({})).toEqual([]);
  });

  it("reports only code and surface when a forced unstable renderer varies", () => {
    let toggle = false;
    const risks = checkGeneratedOutputByteVariance({
      connectorBlockRenderer: () => {
        toggle = !toggle;
        return toggle ? "a" : "b";
      },
    });
    expect(risks).toEqual([
      {
        scope: "configuration-risk",
        code: "generated_output_byte_variance",
        surface: "connector-block",
      },
    ]);
    expect(serialized(risks)).not.toContain('"a"');
  });
});

describe("auditClaudeCacheSuffix ordering and privacy", () => {
  it("orders risks deterministically by code and never serializes fixture secrets, URLs, or commands", () => {
    const risks = auditClaudeCacheSuffix(
      {
        env: { ANTHROPIC_BASE_URL: FOREIGN_URL },
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: "command", command: "mega hooks saver" },
                { type: "command", command: "mega hooks saver" },
              ],
            },
            {
              hooks: [
                { type: "command", command: "mega hooks cache-advice" },
                { type: "command", command: "mega hooks cache-advice" },
              ],
            },
          ],
          SessionStart: [
            {
              hooks: [
                { type: "command", command: "mega hooks warmup" },
                { type: "command", command: "mega hooks warmup" },
                { type: "command", command: `curl -H "Authorization: ${FAKE_SECRET}"` },
              ],
            },
          ],
        },
      },
      { ownedRouteBaseUrl: "http://127.0.0.1:8787" },
    );
    expect(risks.map((r) => r.code)).toEqual([
      "duplicate_megasaver_hook",
      "duplicate_megasaver_hook",
      "duplicate_megasaver_hook",
      "foreign_custom_base_url",
      "owned_route_missing_first_party_flag",
    ]);
    const out = serialized(risks);
    expect(out).not.toContain(FAKE_SECRET);
    expect(out).not.toContain("gateway.example.invalid");
    expect(out).not.toContain("mega hooks");
    expect(out).not.toContain("curl");
  });
});
