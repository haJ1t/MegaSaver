import { z } from "zod";

export const proxyControlErrorCodeSchema = z.enum([
  "route_conflict",
  "settings_invalid",
  "port_unavailable",
  "healthcheck_failed",
  "runtime_failed",
  "disable_failed",
  "drain_expired",
  "lock_unverifiable",
  "recovery_failed",
  "transition_in_progress",
  "legacy_service_present",
  "shutdown_requires_client_restart",
  "reconfigure_requires_client_restart",
  "autostart_failed",
]);
export type ProxyControlErrorCode = z.infer<typeof proxyControlErrorCodeSchema>;

export const proxySafeErrorDetailSchema = z.enum([
  "foreign_route_present",
  "route_removed_externally",
  "invalid_settings_shape",
  "listener_unavailable",
  "ownership_unverified",
  "operation_incomplete",
]);
export type ProxySafeErrorDetail = z.infer<typeof proxySafeErrorDetailSchema>;

// HTTPS origin OR an explicit loopback HTTP origin; no userinfo/path/query/fragment.
export const upstreamBaseUrlSchema = z.string().refine((raw) => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  if (u.search !== "" || u.hash !== "") return false;
  if (u.pathname !== "" && u.pathname !== "/") return false;
  if (u.protocol === "https:") return true;
  // URL.hostname returns IPv6 literals bracketed ("[::1]"), so match that form.
  if (u.protocol === "http:")
    return u.hostname === "127.0.0.1" || u.hostname === "[::1]" || u.hostname === "::1";
  return false;
}, "upstream must be an https origin or an explicit loopback http origin, no userinfo/path/query/fragment");

const ownerBase = {
  id: z.string(),
  ownerKind: z.enum(["offline_cli", "supervisor", "recovery"]),
  ownerInstanceId: z.string(),
  ownerProcessStartToken: z.string(),
  ownerBootId: z.string(),
  ownerFenceToken: z.string(),
  handoffDeadline: z.string().nullable(),
  startedAt: z.string(),
};

export const proxyTransitionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ownerBase,
    kind: z.literal("enable"),
    phase: z.enum([
      "intent_persisted",
      "bootstrap_pending",
      "listener_healthy",
      "lease_installing",
      "route_verified",
      "rollback",
    ]),
    expectedUnrouted: z.literal(false),
  }),
  z.object({
    ...ownerBase,
    kind: z.literal("disable"),
    phase: z.enum(["unroute_expected", "rollback"]),
    expectedUnrouted: z.literal(true),
  }),
  z.object({
    ...ownerBase,
    kind: z.literal("drain_complete"),
    phase: z.literal("confirmation_persisted"),
    expectedUnrouted: z.literal(true),
  }),
]);
export type ProxyTransition = z.infer<typeof proxyTransitionSchema>;

export const routeLeaseSchema = z
  .object({
    url: z.string(),
    instanceId: z.string(),
    phase: z.enum(["installing", "active"]),
    installedAt: z.string(),
  })
  .nullable();

export const drainingGenerationSchema = z
  .object({
    instanceId: z.string(),
    processStartToken: z.string(),
    bootId: z.string(),
    url: z.string(),
    startedAt: z.string(),
  })
  .nullable();

export const proxyControlStateSchema = z.object({
  version: z.literal(1),
  desiredEnabled: z.boolean(),
  port: z.number().int().positive(),
  upstreamBaseUrl: upstreamBaseUrlSchema,
  routeLease: routeLeaseSchema,
  drainingGeneration: drainingGenerationSchema,
  reconcileBlocked: z
    .object({ reason: z.enum(["route_removed", "route_conflict"]), at: z.string() })
    .nullable(),
  transition: proxyTransitionSchema.nullable(),
  updatedAt: z.string(),
  lastError: z
    .object({
      code: proxyControlErrorCodeSchema,
      detail: proxySafeErrorDetailSchema.nullable(),
      at: z.string(),
    })
    .nullable(),
});
export type ProxyControlState = z.infer<typeof proxyControlStateSchema>;

export const proxyRuntimeStateSchema = z.object({
  version: z.literal(1),
  pid: z.number().int(),
  processStartToken: z.string(),
  bootId: z.string(),
  instanceId: z.string(),
  controlUrl: z.string(),
  controlToken: z.string(),
  healthCapability: z.string(),
  proxyUrl: z.string(),
  startedAt: z.string(),
  lastReconciledAt: z.string(),
  lastUsagePersistedAt: z.string().nullable(),
  // F31 self-heal telemetry: bumped by monitorTick when it restores a
  // removed route. Optional — pre-wave-5 runtime files keep parsing.
  routeReapplies: z.number().int().nonnegative().optional(),
  lastRouteReappliedAt: z.string().datetime({ offset: true }).optional(),
});
export type ProxyRuntimeState = z.infer<typeof proxyRuntimeStateSchema>;
