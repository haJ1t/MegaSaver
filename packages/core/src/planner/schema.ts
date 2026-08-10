import { z } from "zod";

export const PLANNER_STATUSES = ["backlog", "todo", "in-progress", "review", "done"] as const;
export const plannerStatusSchema = z.enum(PLANNER_STATUSES);
export type PlannerStatus = z.infer<typeof plannerStatusSchema>;

export const PLANNER_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const plannerPrioritySchema = z.enum(PLANNER_PRIORITIES);
export type PlannerPriority = z.infer<typeof plannerPrioritySchema>;

export const plannerCardIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Card ID must be alphanumeric with hyphens or underscores");

export const plannerCardFrontmatterSchema = z.object({
  id: plannerCardIdSchema,
  title: z.string().min(1).max(256),
  status: plannerStatusSchema,
  priority: plannerPrioritySchema,
  tags: z.array(z.string().min(1).max(64)).default([]),
  assignedAgent: z.string().nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlannerCardFrontmatter = z.infer<typeof plannerCardFrontmatterSchema>;

export const plannerChecklistSchema = z.object({
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
});
export type PlannerChecklist = z.infer<typeof plannerChecklistSchema>;

export const plannerCardSchema = plannerCardFrontmatterSchema.extend({
  content: z.string(),
  filePath: z.string(),
  checklist: plannerChecklistSchema,
});
export type PlannerCard = z.infer<typeof plannerCardSchema>;

export const plannerColumnSchema = z.object({
  key: plannerStatusSchema,
  title: z.string(),
  cards: z.array(plannerCardSchema),
  count: z.number().int().min(0),
});
export type PlannerColumn = z.infer<typeof plannerColumnSchema>;

export const plannerBoardSchema = z.object({
  workspaceKey: z.string(),
  projectRoot: z.string(),
  columns: z.array(plannerColumnSchema),
  totalCards: z.number().int().min(0),
  tags: z.array(z.string()),
  updatedAt: z.string().datetime({ offset: true }),
});
export type PlannerBoard = z.infer<typeof plannerBoardSchema>;
