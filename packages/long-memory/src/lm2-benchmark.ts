#!/usr/bin/env node
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { runBenchmarkOperation } from "./lm2-benchmark-operations.js";
import { BenchmarkTransportError, parseBenchmarkRequest } from "./lm2-benchmark-protocol.js";

export async function dispatchLm2BenchmarkLine(line: string): Promise<string> {
  let value: unknown;
  let id: unknown = null;
  try {
    value = JSON.parse(line);
    if (value !== null && typeof value === "object" && "id" in value) {
      id = (value as { id: unknown }).id;
    }
    const request = parseBenchmarkRequest(value);
    const result = await runBenchmarkOperation(request);
    return JSON.stringify({ id: request.id, ok: true, result });
  } catch (error) {
    const code = error instanceof BenchmarkTransportError ? error.code : "operation_failed";
    return JSON.stringify({ id: typeof id === "string" ? id : null, ok: false, error: { code } });
  }
}

export function createLm2BenchmarkLineHandler(): (line: string) => Promise<string> {
  let queue = Promise.resolve();
  return (line) => {
    const response = queue.then(() => dispatchLm2BenchmarkLine(line));
    queue = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  };
}

export async function runLm2BenchmarkStdio(): Promise<void> {
  const handle = createLm2BenchmarkLineHandler();
  const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    if (!line.trim()) continue;
    process.stdout.write(`${await handle(line)}\n`);
  }
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  runLm2BenchmarkStdio().catch(() => {
    process.exitCode = 1;
  });
}
