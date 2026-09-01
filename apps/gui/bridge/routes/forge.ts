import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectRule } from "@megasaver/core";
import { type ProjectId, type ProjectRuleId, encodeWorkspaceKey } from "@megasaver/shared";
import type { RouteContext } from "../route-context.js";
import { readJsonBody } from "./_body.js";

const learnedFailureIds = new Set<string>();

export async function handleGetForgeFailures(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      failures: [
        {
          id: "fail-01",
          pattern: "Unchecked array index dereference in tool output",
          occurrences: 3,
          ruleCreated: learnedFailureIds.has("fail-01"),
        },
      ],
    },
    ctx.origin,
  );
}

export async function handlePostForgeLearn(ctx: RouteContext): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(ctx.req);
  } catch {
    ctx.sendError(ctx.res, 400, "validation_failed", "Invalid JSON body.", ctx.origin);
    return;
  }
  const payload = body as { failureId?: string; ruleTitle?: string };
  const failureId = payload.failureId ?? "fail-01";
  learnedFailureIds.add(failureId);
  const ruleTitle =
    payload.ruleTitle ?? "Always verify non-null state before dereferencing array indices.";

  const ruleId = ctx.newId();
  const rule: ProjectRule = {
    id: ruleId as unknown as ProjectRuleId,
    projectId: (ctx.registry?.listProjects()[0]?.id ??
      "00000000-beef-0000-0000-000000000001") as ProjectId,
    title: "Unchecked array index dereference in tool output",
    rule: ruleTitle,
    appliesTo: ["**/*.ts", "**/*.tsx", "**/*.js"],
    evidence: ["Failure pattern: Unchecked array index dereference in tool output (3 occurrences)"],
    severity: "warning",
    confidence: "high",
    createdFrom: "failed_attempt",
    createdAt: ctx.now(),
    updatedAt: ctx.now(),
  };

  if (ctx.registry) {
    for (const project of ctx.registry.listProjects()) {
      try {
        ctx.registry.createProjectRule({ ...rule, projectId: project.id });
      } catch {}
    }
  }

  try {
    const rulesDir = join(ctx.storeRoot, "rules");
    mkdirSync(rulesDir, { recursive: true });
    const workspaceKeys = new Set<string>();
    if (ctx.registry) {
      for (const p of ctx.registry.listProjects()) {
        workspaceKeys.add(encodeWorkspaceKey(p.rootPath));
      }
    }
    const statsDir = join(ctx.storeRoot, "stats");
    if (existsSync(statsDir)) {
      for (const entry of readdirSync(statsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.length === 16) {
          workspaceKeys.add(entry.name);
        }
      }
    }
    for (const wk of workspaceKeys) {
      const filePath = join(rulesDir, `${wk}.jsonl`);
      appendFileSync(filePath, `${JSON.stringify(rule)}\n`, "utf8");
    }
  } catch {}

  ctx.sendJson(
    ctx.res,
    200,
    {
      learned: true,
      ruleId,
      ruleTitle,
    },
    ctx.origin,
  );
}

export async function handleGetFirewallStatus(ctx: RouteContext): Promise<void> {
  ctx.sendJson(
    ctx.res,
    200,
    {
      enabled: true,
      activeRules: 12,
      blockedAttempts: 5,
    },
    ctx.origin,
  );
}
