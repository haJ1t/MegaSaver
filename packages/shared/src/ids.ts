import { z } from "zod";

// IDs become filesystem path segments (memory `${projectId}.jsonl`,
// content-store and stats dirs). On a case-insensitive filesystem
// (NTFS, default APFS) two ids differing only in case would alias one
// file. randomUUID() always mints lowercase; this refine makes the
// lowercase contract explicit rather than emergent, and rejects (not
// transforms) so a non-canonical id is a loud error, not silent aliasing.
const lowercaseUuid = z
  .string()
  .uuid()
  .refine((s) => s === s.toLowerCase(), { message: "id must be lowercase" });

export const projectIdSchema = lowercaseUuid.brand<"ProjectId">();
export type ProjectId = z.infer<typeof projectIdSchema>;

export const sessionIdSchema = lowercaseUuid.brand<"SessionId">();
export type SessionId = z.infer<typeof sessionIdSchema>;

export const memoryEntryIdSchema = lowercaseUuid.brand<"MemoryEntryId">();
export type MemoryEntryId = z.infer<typeof memoryEntryIdSchema>;

export const codeBlockIdSchema = lowercaseUuid.brand<"CodeBlockId">();
export type CodeBlockId = z.infer<typeof codeBlockIdSchema>;

export const projectRuleIdSchema = lowercaseUuid.brand<"ProjectRuleId">();
export type ProjectRuleId = z.infer<typeof projectRuleIdSchema>;

export const failedAttemptIdSchema = lowercaseUuid.brand<"FailedAttemptId">();
export type FailedAttemptId = z.infer<typeof failedAttemptIdSchema>;

export const taskPlanIdSchema = lowercaseUuid.brand<"TaskPlanId">();
export type TaskPlanId = z.infer<typeof taskPlanIdSchema>;

export const taskStepIdSchema = lowercaseUuid.brand<"TaskStepId">();
export type TaskStepId = z.infer<typeof taskStepIdSchema>;

export const toolDefinitionIdSchema = lowercaseUuid.brand<"ToolDefinitionId">();
export type ToolDefinitionId = z.infer<typeof toolDefinitionIdSchema>;

export const roleIdSchema = lowercaseUuid.brand<"RoleId">();
export type RoleId = z.infer<typeof roleIdSchema>;

export const officeAgentIdSchema = lowercaseUuid.brand<"OfficeAgentId">();
export type OfficeAgentId = z.infer<typeof officeAgentIdSchema>;

export const officeTaskIdSchema = lowercaseUuid.brand<"OfficeTaskId">();
export type OfficeTaskId = z.infer<typeof officeTaskIdSchema>;
