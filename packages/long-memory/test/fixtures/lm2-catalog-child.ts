import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";

type ChildInput = {
  mode: "append" | "append-after-barrier" | "append-with-anchor-close-failure";
  storeRoot: string;
  record: unknown;
};

const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Missing catalog child input.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ChildInput;

if (input.mode === "append-with-anchor-close-failure") {
  const require = createRequire(import.meta.url);
  const fsExt = require("fs-ext") as { flockSync(descriptor: number, operation: string): void };
  const actualFlock = fsExt.flockSync;
  const actualClose = fs.closeSync;
  let armed = false;
  let injected = false;
  fsExt.flockSync = (descriptor, operation) => {
    actualFlock(descriptor, operation);
    if (operation.startsWith("ex")) armed = true;
  };
  fs.closeSync = (descriptor) => {
    const directory = fs.fstatSync(descriptor).isDirectory();
    actualClose(descriptor);
    if (armed && directory && !injected) {
      injected = true;
      throw new Error("injected catalog anchor close failure");
    }
  };
  syncBuiltinESMExports();
}

if (input.mode === "append-after-barrier") {
  process.stdout.write("ready\n");
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
}

const { createLm2CandidateCatalog } = await import("../../src/lm2-catalog.js");
const result = createLm2CandidateCatalog({ storeRoot: input.storeRoot }).appendPublished(
  input.record as never,
);
process.stdout.write(`${JSON.stringify({ result })}\n`);
