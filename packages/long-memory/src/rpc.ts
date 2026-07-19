import { rpcRequestSchema, type RpcResponse } from "./model.js";
import type { LongMemoryStore } from "./store.js";

export function dispatchRpcLine(line: string, store: LongMemoryStore): string {
  try {
    const request = rpcRequestSchema.parse(JSON.parse(line));
    const result =
      request.op === "insert"
        ? store.insert(request.observation)
        : store.query(request.request);
    const response: RpcResponse = { id: request.id, ok: true, result };

    return JSON.stringify(response);
  } catch {
    const response: RpcResponse = {
      id: null,
      ok: false,
      error: { code: "invalid_request" },
    };

    return JSON.stringify(response);
  }
}
