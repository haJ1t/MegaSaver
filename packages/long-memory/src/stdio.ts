#!/usr/bin/env node
import { createInterface } from "node:readline";
import { dispatchRpcLine } from "./rpc.js";
import { createInMemoryLongMemoryStore } from "./store.js";

const store = createInMemoryLongMemoryStore();
const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

lines.on("line", (line) => {
  process.stdout.write(`${dispatchRpcLine(line, store)}\n`);
});
