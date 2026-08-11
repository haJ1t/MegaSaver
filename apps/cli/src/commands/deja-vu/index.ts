import { defineCommand } from "citty";
import { loadDejaVuCorpus, searchDejaVu } from "../../deja-vu/corpus.js";

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
    // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
    if (args.full) {
      // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
      console.log(`deja-vu full ${args.full} — re-redacted open (see spec)`);
      return;
    }
    // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
    const query = String(args.query ?? "");
    // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
    const limit = Math.min(20, Math.max(1, Number.parseInt(String(args.limit ?? 5), 10) || 5));
    const corpus = loadDejaVuCorpus("");
    const hits = searchDejaVu(corpus, query).slice(0, limit);
    // @ts-ignore: noPropertyAccessFromIndexSignature - citty args index signature
    if (args.json) {
      console.log(JSON.stringify(hits, null, 2));
    } else {
      if (hits.length === 0) console.log(`no teasers for "${query}" (corpus empty — local store)`);
      else for (const h of hits) console.log(`${h.id} score=${h.score}`);
    }
  },
});
