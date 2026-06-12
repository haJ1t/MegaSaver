import { describe, expect, it } from "vitest";
import { exposedToolName, internalIdFromExposed, resolveNamingMode } from "../src/tool-naming.js";

describe("resolveNamingMode (P0 §5.2)", () => {
  it("defaults to proxy when unset", () => {
    expect(resolveNamingMode(undefined)).toBe("proxy");
  });
  it("empty string -> proxy", () => {
    expect(resolveNamingMode("")).toBe("proxy");
  });
  it("explicit proxy", () => {
    expect(resolveNamingMode("proxy")).toBe("proxy");
  });
  it("explicit legacy", () => {
    expect(resolveNamingMode("legacy")).toBe("legacy");
  });
  it("trims surrounding whitespace and is case-insensitive", () => {
    expect(resolveNamingMode("  LEGACY ")).toBe("legacy");
    expect(resolveNamingMode("Proxy")).toBe("proxy");
  });
  it("unrecognized value fails safe to proxy", () => {
    expect(resolveNamingMode("garbage")).toBe("proxy");
  });
});

describe("exposedToolName (P0 §5.3 mapping)", () => {
  it("proxy mode renames the three mapped tools", () => {
    expect(exposedToolName("mega_read_file", "proxy")).toBe("proxy_read_file");
    expect(exposedToolName("mega_run_command", "proxy")).toBe("proxy_run_command");
    expect(exposedToolName("mega_fetch_chunk", "proxy")).toBe("proxy_expand_chunk");
  });
  it("legacy mode keeps mega_* names", () => {
    expect(exposedToolName("mega_read_file", "legacy")).toBe("mega_read_file");
    expect(exposedToolName("mega_run_command", "legacy")).toBe("mega_run_command");
    expect(exposedToolName("mega_fetch_chunk", "legacy")).toBe("mega_fetch_chunk");
  });
  it("unmapped mega_recall is unchanged in both modes", () => {
    expect(exposedToolName("mega_recall", "proxy")).toBe("mega_recall");
    expect(exposedToolName("mega_recall", "legacy")).toBe("mega_recall");
  });
});

describe("internalIdFromExposed (reverse dispatch resolution)", () => {
  it("proxy mode resolves proxy_* to the internal dispatch id", () => {
    expect(internalIdFromExposed("proxy_read_file", "proxy")).toBe("mega_read_file");
    expect(internalIdFromExposed("proxy_run_command", "proxy")).toBe("mega_run_command");
    expect(internalIdFromExposed("proxy_expand_chunk", "proxy")).toBe("mega_fetch_chunk");
  });
  it("proxy mode rejects the renamed legacy names (no duplicate surface)", () => {
    expect(internalIdFromExposed("mega_read_file", "proxy")).toBeUndefined();
    expect(internalIdFromExposed("mega_run_command", "proxy")).toBeUndefined();
    expect(internalIdFromExposed("mega_fetch_chunk", "proxy")).toBeUndefined();
  });
  it("proxy mode still accepts unmapped mega_recall", () => {
    expect(internalIdFromExposed("mega_recall", "proxy")).toBe("mega_recall");
  });
  it("legacy mode resolves mega_* names", () => {
    expect(internalIdFromExposed("mega_run_command", "legacy")).toBe("mega_run_command");
    expect(internalIdFromExposed("mega_recall", "legacy")).toBe("mega_recall");
  });
  it("legacy mode rejects proxy_* names", () => {
    expect(internalIdFromExposed("proxy_run_command", "legacy")).toBeUndefined();
    expect(internalIdFromExposed("proxy_expand_chunk", "legacy")).toBeUndefined();
  });
  it("unknown names resolve to undefined in both modes", () => {
    expect(internalIdFromExposed("mega_delete_everything", "proxy")).toBeUndefined();
    expect(internalIdFromExposed("mega_delete_everything", "legacy")).toBeUndefined();
  });
});
