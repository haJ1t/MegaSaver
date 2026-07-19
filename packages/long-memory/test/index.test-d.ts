import { expectTypeOf, it } from "vitest";
import * as longMemory from "../src/index.js";

it("exports the LM0 package marker", () => {
  expectTypeOf(longMemory.LONG_MEMORY_PACKAGE).toEqualTypeOf<string>();
});

it("preserves LM0 exports while adding LM1 contracts", () => {
  expectTypeOf(longMemory.createInMemoryLongMemoryStore).toBeFunction();
  expectTypeOf<longMemory.LongMemoryStore>().toMatchTypeOf<{
    insert: (observation: longMemory.Observation) => { inserted: boolean };
    query: (request: longMemory.RecallRequest) => longMemory.RecallBundle;
  }>();
  expectTypeOf(longMemory.dispatchRpcLine).toBeFunction();
  expectTypeOf(longMemory.MAX_EVIDENCE_IDS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_EVIDENCE_ID_LENGTH).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_OBSERVATION_TEXT_CHARS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_RECALL_TASK_CHARS).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_RECALL_TOKEN_BUDGET).toEqualTypeOf<number>();
  expectTypeOf(longMemory.MAX_WORKSPACE_KEY_LENGTH).toEqualTypeOf<number>();
  expectTypeOf(longMemory.observationKindSchema).toBeObject();
  expectTypeOf(longMemory.observationSchema).toBeObject();
  expectTypeOf(longMemory.recallRequestSchema).toBeObject();
  expectTypeOf(longMemory.recallItemSchema).toBeObject();
  expectTypeOf(longMemory.receiptItemSchema).toBeObject();
  expectTypeOf(longMemory.recallBundleSchema).toBeObject();
  expectTypeOf(longMemory.rpcRequestSchema).toBeObject();
  expectTypeOf(longMemory.rpcResponseSchema).toBeObject();
  expectTypeOf<longMemory.ObservationKind>().toEqualTypeOf<"state_snapshot" | "state_transition">();
  expectTypeOf<longMemory.Observation>().toMatchTypeOf<{
    id: string;
    workspaceKey: string;
  }>();
  expectTypeOf<longMemory.RecallRequest>().toMatchTypeOf<{
    task: string;
    workspaceKey: string;
    tokenBudget: number;
  }>();
  expectTypeOf<longMemory.RecallItem>().toMatchTypeOf<{
    type: "text";
    value: string;
    observationId: string;
  }>();
  expectTypeOf<longMemory.ReceiptItem>().toMatchTypeOf<{
    observationId: string;
    evidenceIds: string[];
  }>();
  expectTypeOf<longMemory.RecallBundle>().toMatchTypeOf<{
    items: longMemory.RecallItem[];
    receipt: longMemory.ReceiptItem[];
  }>();
  expectTypeOf<longMemory.RpcRequest>().toMatchTypeOf<{ id: string }>();
  expectTypeOf<longMemory.RpcResponse>().toMatchTypeOf<{ ok: boolean }>();
  expectTypeOf(longMemory.prepareCapture).toBeFunction();
  expectTypeOf<longMemory.RedactionPort>().toMatchTypeOf<{
    version: string;
    redact(input: { text: string; action: string | null }): unknown;
  }>();
});
