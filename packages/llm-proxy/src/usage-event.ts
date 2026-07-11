import { z } from "zod";

// A single /v1/messages round-trip's token usage. Counts + metadata ONLY — the
// proxy never persists the request/response bodies, system prompt, or messages.
export const proxyUsageEventSchema = z
  .object({
    id: z.string().min(1),
    ts: z.string().datetime({ offset: true }),
    // The model label is echoed from the (client-controlled) request body into a
    // greppable JSONL log. JSON.stringify already escapes control chars so a
    // newline cannot forge a second line, but bound the length so a pathological
    // body can't bloat the metering log, and strip control chars for cleanliness.
    model: z
      .string()
      .max(256)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping C0/DEL control chars from an untrusted label
      .transform((m) => m.replace(/[\x00-\x1f\x7f]/g, "")),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    stream: z.boolean(),
    // F33: reserved per-request workspace attribution. The proxy today runs
    // a single global listener with NO per-request workspace signal (no env
    // or header scoping), so the writer never stamps this — audit falls back
    // to the labeled global bucket. Optional keeps old rows parsing under
    // .strict(); the day a signal exists, stamping it activates the scoped
    // ratios in `mega audit usage` with no further schema change.
    workspaceKey: z.string().min(1).optional(),
  })
  .strict();

export type ProxyUsageEvent = z.infer<typeof proxyUsageEventSchema>;
