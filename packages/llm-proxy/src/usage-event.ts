import { z } from "zod";

// A single /v1/messages round-trip's token usage. Counts + metadata ONLY — the
// proxy never persists the request/response bodies, system prompt, or messages.
export const proxyUsageEventSchema = z
  .object({
    id: z.string().min(1),
    ts: z.string().datetime({ offset: true }),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    stream: z.boolean(),
  })
  .strict();

export type ProxyUsageEvent = z.infer<typeof proxyUsageEventSchema>;
