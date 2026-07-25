import { type RpcRequest, type RpcResponse, rpcRequestSchema } from "./model.js";
import type { LongMemoryStore } from "./store.js";

export function dispatchRpcLine(line: string, store: LongMemoryStore): string {
  let request: RpcRequest;

  try {
    request = rpcRequestSchema.parse(JSON.parse(line));
  } catch {
    return errorLine(null, "invalid_request");
  }

  try {
    const result =
      request.op === "insert" ? store.insert(request.observation) : store.query(request.request);
    const response: RpcResponse = { id: request.id, ok: true, result };

    return JSON.stringify(response);
  } catch {
    return errorLine(request.id, "internal");
  }
}

function errorLine(id: string | null, code: "invalid_request" | "internal"): string {
  const response: RpcResponse = { id, ok: false, error: { code } };

  return JSON.stringify(response);
}
