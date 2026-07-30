import { describe, expect, it } from "vitest";
import {
  cacheNamespaceMarker,
  cacheRunSlot,
  namespaceCacheRun,
  stripCacheNamespace,
} from "../src/transform.js";
import type { Arm, RecordedRequest, ReplayOrder } from "../src/types.js";

// Measured 2026-07-30: the same recording, the same saver, replayed in the two
// possible arm orders, gave 1.598 and 1.197 — a 0.40 spread against a <=0.05
// effect. `deriveOrderCheck` detected it but could not remove it.
//
// The mechanism is prompt caching, which is a PREFIX MATCH. All four arm runs
// (two arms x two pair orders) replay bytes built ONCE by prepareArms, so they
// share an identical tools+system head and whichever runs later reads what an
// earlier one paid to create.
//
// The level matters. An ARM-scoped namespace does not fix this: it is constant
// across both pairs, so pair 2 still reads back pair 1's entries — and
// replay.ts's own design comment said pair 2 running warm off pair 1 was
// intended. Scoping per arm RUN gives four namespaces, so every run starts cold
// and warms only itself. That is also what production does: one arm, one
// session, cold at the start, warming as it goes.
//
// Three properties keep it honest, all asserted below: CONSTANT within a run (or
// the run never warms itself), DISTINCT across runs (or the bias returns), and
// EQUAL LENGTH across runs (or one run silently carries more input tokens).

const ORDERS: readonly ReplayOrder[] = ["baseline-first", "megasaver-first"];
const ARMS: readonly Arm[] = ["baseline", "megasaver"];
const ALL_SLOTS = ORDERS.flatMap((order) => ARMS.map((arm) => cacheRunSlot(order, arm)));

function req(system: unknown, text = "hello"): RecordedRequest {
  const body: Record<string, unknown> = {
    model: "claude-opus-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: [{ type: "text", text }] }],
  };
  if (system !== undefined) body.system = system;
  return body as unknown as RecordedRequest;
}

function systemText(body: RecordedRequest): string {
  const s = (body as unknown as { system?: unknown }).system;
  if (typeof s === "string") return s;
  if (Array.isArray(s)) return s.map((b) => (b as { text?: string }).text ?? "").join("\n");
  return "";
}

describe("cache-run namespacing", () => {
  it("gives all four arm runs distinct slots", () => {
    expect(new Set(ALL_SLOTS).size).toBe(4);
  });

  it("separates the two PAIRS, not just the two arms", () => {
    // The defect an arm-scoped namespace has: same arm, different pair, same
    // namespace — so pair 2 reads back what pair 1 created.
    for (const arm of ARMS) {
      expect(cacheRunSlot("baseline-first", arm)).not.toBe(cacheRunSlot("megasaver-first", arm));
    }
  });

  it("gives every run a different cache prefix", () => {
    const prefixes = ALL_SLOTS.map((slot) => systemText(namespaceCacheRun(req("sys"), slot)));
    expect(new Set(prefixes).size).toBe(4);
  });

  it("keeps a run's marker constant across its requests, so the run warms its own cache", () => {
    const slot = cacheRunSlot("baseline-first", "baseline");
    const a = systemText(namespaceCacheRun(req("sys", "one"), slot));
    const b = systemText(namespaceCacheRun(req("sys", "two"), slot));
    // Same system input, different user turn: the run's prefix must be identical.
    expect(a).toBe(b);
  });

  it("charges every run the same number of marker bytes", () => {
    const lengths = ALL_SLOTS.map((slot) => Buffer.byteLength(cacheNamespaceMarker(slot), "utf8"));
    expect(new Set(lengths).size).toBe(1);
  });

  it("differs between runs in exactly one character, so the runs tokenize alike", () => {
    // Equal BYTE length does not imply equal TOKEN count, and an asymmetric
    // token count is a constant per-request bias in the very quantity being
    // compared. Markers that differ in one ASCII digit at one position make
    // identical tokenization near-certain.
    const [first, ...rest] = ALL_SLOTS.map(cacheNamespaceMarker);
    for (const other of rest) {
      const differing = [...(first as string)].filter((c, i) => c !== other[i]);
      expect(differing).toHaveLength(1);
    }
  });

  it("preserves the original system text in every run", () => {
    const original = "You are Claude Code.";
    for (const slot of ALL_SLOTS) {
      expect(systemText(namespaceCacheRun(req(original), slot))).toContain(original);
    }
  });

  it("does not mutate the prepared body, which every run shares", () => {
    const shared = req("sys");
    namespaceCacheRun(shared, 0);
    namespaceCacheRun(shared, 1);
    expect(systemText(shared)).toBe("sys");
  });

  it("extends the first system block rather than adding one, keeping cache_control in place", () => {
    const blocks = [
      { type: "text", text: "billing header" },
      { type: "text", text: "stable core", cache_control: { type: "ephemeral" } },
    ];
    const out = namespaceCacheRun(req(blocks), 2) as unknown as { system: unknown[] };
    expect(out.system).toHaveLength(2);
    expect((out.system[1] as { cache_control?: unknown }).cache_control).toEqual({
      type: "ephemeral",
    });
    expect((out.system[0] as { text: string }).text).toContain("billing header");
  });

  it("namespaces a recording with no system prompt by giving it one", () => {
    // Refusing here would buy nothing — the goal is disjoint namespaces, and a
    // synthesized marker delivers exactly that, equal-length in every run.
    const bare = req(undefined);
    const texts = ALL_SLOTS.map((slot) => systemText(namespaceCacheRun(bare, slot)));
    expect(new Set(texts).size).toBe(4);
    expect(new Set(texts.map((t) => Buffer.byteLength(t, "utf8"))).size).toBe(1);
  });
});

describe("stripCacheNamespace", () => {
  it("round-trips a string system prompt", () => {
    const body = req("You are Claude Code.");
    for (const slot of ALL_SLOTS) {
      expect(stripCacheNamespace(namespaceCacheRun(body, slot))).toEqual(body);
    }
  });

  it("round-trips a block-array system prompt", () => {
    const body = req([{ type: "text", text: "core", cache_control: { type: "ephemeral" } }]);
    for (const slot of ALL_SLOTS) {
      expect(stripCacheNamespace(namespaceCacheRun(body, slot))).toEqual(body);
    }
  });

  it("round-trips a recording that had no system prompt", () => {
    const body = req(undefined);
    for (const slot of ALL_SLOTS) {
      expect(stripCacheNamespace(namespaceCacheRun(body, slot))).toEqual(body);
    }
  });

  it("leaves a body that was never namespaced alone", () => {
    const body = req("bench-replay is mentioned here but not as a marker");
    expect(stripCacheNamespace(body)).toEqual(body);
  });
});
