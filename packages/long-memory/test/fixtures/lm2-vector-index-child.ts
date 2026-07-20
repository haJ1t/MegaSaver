import { once } from "node:events";
import { modelDescriptorFingerprint } from "../../src/lm2-identity.js";
import type { Lm2Candidate, ModelDescriptor } from "../../src/lm2-model.js";
import { createLm2VectorStore } from "../../src/lm2-vector-store.js";

type Input = {
  storeRoot: string;
  workspaceKey: string;
  model: ModelDescriptor;
  record: Lm2Candidate;
};

const encoded = process.argv[2];
if (encoded === undefined) throw new Error("Missing child index input.");
const input = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Input;
const store = createLm2VectorStore({ storeRoot: input.storeRoot });
const result = await store.reserveAndPublish({
  workspaceKey: input.workspaceKey,
  model: input.model,
  records: [input.record],
  signal: new AbortController().signal,
  embed: async () => {
    process.stdout.write("embedding\n");
    await once(process.stdin, "data");
    return {
      modelFingerprint: modelDescriptorFingerprint(input.model),
      vectors: [Array.from({ length: input.model.dimensions }, () => 1)],
    };
  },
});
process.stdout.write(`${JSON.stringify(result)}\n`);
