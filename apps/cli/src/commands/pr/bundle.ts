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
    console.log(
      `pr bundle: base=${args.base ?? "auto"} head=${args.head ?? "HEAD"} (stub — see spec 2026-08-11-evidence-bundle-exporter)`,
    );
    console.log(`bundle would be at store/bundles/<id>.json + .md`);
  },
});
