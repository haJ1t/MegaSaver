import type { z } from "zod";
import type { McpToolName } from "./tool-name.js";
import { approveMemoryInputSchema } from "./tools/approve-memory.js";
import { inputSchema as auditTokenUsageInput } from "./tools/audit-token-usage.js";
import {
  boardListInputSchema,
  boardPostInputSchema,
  boardResolveInputSchema,
} from "./tools/board.js";
import { inputSchema as buildTaskPlanInput } from "./tools/build-task-plan.js";
import { inputSchema as checkApproachInput } from "./tools/check-approach.js";
import { inputSchema as contextPruningInput } from "./tools/context-pruning.js";
import { inputSchema as convertFailureToRuleInput } from "./tools/convert-failure-to-rule.js";
import { inputSchema as recordFailedAttemptInput } from "./tools/failed-attempts.js";
import { fetchChunkInputSchema } from "./tools/fetch-chunk.js";
import { inputSchema as findSimilarFailuresInput } from "./tools/find-similar-failures.js";
import { fromSessionMemoryInputSchema } from "./tools/from-session-memory.js";
import { inputSchema as getApplicableRulesInput } from "./tools/get-applicable-rules.js";
import { inputSchema as getEditImpactInput } from "./tools/get-edit-impact.js";
import { getRelevantMemoriesInputSchema } from "./tools/get-relevant-memories.js";
import { argsSchema as getTaskContextInput } from "./tools/get-task-context.js";
import { inputSchema as getTaskStatusInput } from "./tools/get-task-status.js";
import { inputSchema as getWarmStartBriefInput } from "./tools/get-warm-start-brief.js";
import { inputSchema as impactInput } from "./tools/impact.js";
import { indexMemoryInputSchema } from "./tools/index-memory.js";
import {
  meshBroadcastInputSchema,
  meshClaimInputSchema,
  meshEventsInputSchema,
  meshPeersInputSchema,
  meshPollInputSchema,
  meshQueryInputSchema,
  meshReleaseInputSchema,
  meshSendInputSchema,
  meshStatusSetInputSchema,
} from "./tools/mesh.js";
import { inputSchema as projectContextInput } from "./tools/project-context.js";
import { getInputSchema, saveInputSchema } from "./tools/project-rules.js";
import { readFileInputSchema } from "./tools/read-file.js";
import { recallInputSchema } from "./tools/recall.js";
import { inputSchema as recordTaskStepInput } from "./tools/record-task-step.js";
import { inputSchema as retryFailedStepInput } from "./tools/retry-failed-step.js";
import { inputSchema as routeToolsForTaskInput } from "./tools/route-tools-for-task.js";
import { runCommandInputSchema } from "./tools/run-command.js";
import { saveMemoryInputSchema } from "./tools/save-memory.js";
import { searchCodeInputSchema } from "./tools/search-code.js";
import { searchMemoryInputSchema } from "./tools/search-memory.js";
import { sweepMemoryInputSchema } from "./tools/sweep-memory.js";
import { inputSchema as verifyMemoriesInput } from "./tools/verify-memories.js";

// The schema each tool's handler ACTUALLY parses with — the same object, not a
// copy — so the contract we publish in tools/list and the contract we enforce in
// dispatch cannot drift (publish-tool-input-schemas §2.2).
//
// `Record<McpToolName, ...>` is load-bearing: adding a member to McpToolName
// without a schema here is a COMPILE error, so a new tool can never ship
// advertising nothing. Do not relax it to Partial or an index signature.
//
// The four context-pruning tools legitimately share one schema — their handlers
// all route through a common helper that parses with it.
export const TOOL_INPUT_SCHEMAS: Record<McpToolName, z.ZodTypeAny> = {
  approve_memory: approveMemoryInputSchema,
  audit_token_usage: auditTokenUsageInput,
  board_list: boardListInputSchema,
  board_post: boardPostInputSchema,
  board_resolve: boardResolveInputSchema,
  build_task_plan: buildTaskPlanInput,
  check_approach: checkApproachInput,
  convert_failure_to_rule: convertFailureToRuleInput,
  explain_context_selection: contextPruningInput,
  find_similar_failures: findSimilarFailuresInput,
  get_applicable_rules: getApplicableRulesInput,
  get_context_budget_report: contextPruningInput,
  get_edit_impact: getEditImpactInput,
  get_project_context: projectContextInput,
  get_project_rules: getInputSchema,
  get_relevant_code_blocks: contextPruningInput,
  get_relevant_context: contextPruningInput,
  get_relevant_memories: getRelevantMemoriesInputSchema,
  get_task_context: getTaskContextInput,
  get_task_status: getTaskStatusInput,
  get_warm_start_brief: getWarmStartBriefInput,
  mega_fetch_chunk: fetchChunkInputSchema,
  mega_impact: impactInput,
  mega_index_memory: indexMemoryInputSchema,
  mega_memory_from_session: fromSessionMemoryInputSchema,
  mega_memory_sweep: sweepMemoryInputSchema,
  mega_read_file: readFileInputSchema,
  mega_recall: recallInputSchema,
  mega_run_command: runCommandInputSchema,
  mesh_broadcast: meshBroadcastInputSchema,
  mesh_claim: meshClaimInputSchema,
  mesh_events: meshEventsInputSchema,
  mesh_peers: meshPeersInputSchema,
  mesh_poll: meshPollInputSchema,
  mesh_query: meshQueryInputSchema,
  mesh_release: meshReleaseInputSchema,
  mesh_send: meshSendInputSchema,
  mesh_status_set: meshStatusSetInputSchema,
  proxy_search_code: searchCodeInputSchema,
  record_failed_attempt: recordFailedAttemptInput,
  record_task_step: recordTaskStepInput,
  retry_failed_step: retryFailedStepInput,
  route_tools_for_task: routeToolsForTaskInput,
  save_memory: saveMemoryInputSchema,
  save_project_rule: saveInputSchema,
  search_memory: searchMemoryInputSchema,
  verify_memories: verifyMemoriesInput,
};
