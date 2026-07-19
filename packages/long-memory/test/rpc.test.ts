import { describe, expect, it } from "vitest";
import { dispatchRpcLine } from "../src/rpc.js";
import { createInMemoryLongMemoryStore } from "../src/store.js";

const observation = {
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  workspaceKey: "workspace-a",
  sourceDigest: "a".repeat(64),
  kind: "state_snapshot" as const,
  observedAt: "2026-07-19T12:00:00.000Z",
  text: "The project uses pnpm workspaces.",
  evidenceIds: ["evidence-1"],
};

describe("dispatchRpcLine", () => {
  it("returns an insert receipt for a valid insert request", () => {
    const result = dispatchRpcLine(
      JSON.stringify({ id: "request-1", op: "insert", observation }),
      createInMemoryLongMemoryStore(),
    );

    expect(JSON.parse(result)).toEqual({
      id: "request-1",
      ok: true,
      result: { inserted: true },
    });
  });

  it("returns a machine-readable error for malformed JSON", () => {
    const result = dispatchRpcLine("{not-json", createInMemoryLongMemoryStore());

    expect(JSON.parse(result)).toEqual({
      id: null,
      ok: false,
      error: { code: "invalid_request" },
    });
  });

  it("keeps a valid request id when an operation fails internally", () => {
    const failingStore = {
      insert() {
        throw new Error("store unavailable");
      },
      query() {
        return { items: [], receipt: [] };
      },
    };

    const result = dispatchRpcLine(
      JSON.stringify({ id: "request-3", op: "insert", observation }),
      failingStore,
    );

    expect(JSON.parse(result)).toEqual({
      id: "request-3",
      ok: false,
      error: { code: "internal" },
    });
  });

  it("returns a receipt-bearing bundle for a valid query request", () => {
    const store = createInMemoryLongMemoryStore();
    dispatchRpcLine(JSON.stringify({ id: "request-1", op: "insert", observation }), store);

    const result = dispatchRpcLine(
      JSON.stringify({
        id: "request-2",
        op: "query",
        request: {
          task: "Which package manager does the project use?",
          workspaceKey: "workspace-a",
          tokenBudget: 100,
        },
      }),
      store,
    );

    expect(JSON.parse(result)).toEqual({
      id: "request-2",
      ok: true,
      result: {
        items: [
          {
            type: "text",
            value: "The project uses pnpm workspaces.",
            observationId: observation.id,
          },
        ],
        receipt: [
          {
            observationId: observation.id,
            evidenceIds: ["evidence-1"],
            lane: "state",
            tokenEstimate: 9,
          },
        ],
      },
    });
  });
});
