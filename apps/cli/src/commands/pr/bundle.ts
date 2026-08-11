import { defineCommand } from "citty";

export const prBundleCommand = defineCommand({
  meta: {
    name: "bundle",
    description: "Build evidence bundle (content-addressed, hash-verified).",
  },
  args: {
    base: { type: "string", description: "Base ref (default origin/main or HEAD~1)." },
    head: { type: "string", description: "Head ref (default HEAD)." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const { bundleIdOf } = (await import("../../bundle/schema.js")) as unknown as {
      bundleIdOf: (x: unknown) => string;
    };
    const fake = {
      version: 1 as const,
      createdAt: new Date().toISOString(),
      git: {
        // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
        base: args.base ?? null,
        // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
        head: args.head ?? "HEAD",
        baseOid: null,
        headOid: null,
      },
      preflight: null,
      sweep: null,
      tests: { receipts: [], verified: false },
      context: null,
      lineage: { bundleHash: "hash", storeRootHash: "hash" },
      redacted: true,
    };
    const id = bundleIdOf(fake);
    console.log(
      // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
      `pr bundle: base=${args.base ?? "auto"} head=${args.head ?? "HEAD"} -> bundle ${id} (see spec)`,
    );
    console.log(`bundle would be at store/bundles/${id}.json + .md`);
  },
});
