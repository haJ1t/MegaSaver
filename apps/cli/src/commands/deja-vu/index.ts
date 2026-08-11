import { defineCommand } from "citty";

export const dejaVuCommand = defineCommand({
  meta: { name: "deja-vu", description: "Local cross-repo teaser recall (BM25 lexical, honest)." },
  args: {
    query: { type: "positional", required: false, description: "Error or query." },
    limit: { type: "string", description: "Max teasers (default 5, max 20)." },
    full: { type: "string", description: "Teaser id to open full record." },
    json: { type: "boolean", default: false, description: "Emit JSON." },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    if (args.full) {
      console.log(`deja-vu full ${args.full} (stub — re-redacted open, see spec)`);
    } else {
      console.log(
        `deja-vu "${args.query ?? ""}" — ${args.limit ?? 5} teasers (stub — BM25 over local store)`,
      );
      if (args.json) console.log(JSON.stringify([], null, 2));
    }
  },
});
