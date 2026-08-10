import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deletePlannerCard,
  readPlannerBoard,
  syncRootTodoFile,
  writePlannerCard,
} from "../src/planner/service.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "planner-service-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("core planner service", () => {
  it("initializes directories and reads empty board", async () => {
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.columns).toHaveLength(5);
    expect(board.totalCards).toBe(0);
  });

  it("writes card to disk and moves file atomically when status changes", async () => {
    const card1 = await writePlannerCard(projectDir, {
      title: "Initial Task",
      status: "todo",
      priority: "high",
      tags: ["gui"],
      content: "## Description\n- [ ] item 1",
    });

    expect(card1.status).toBe("todo");
    expect(card1.filePath).toContain(".megasaver/planner/todo/");

    const card2 = await writePlannerCard(projectDir, {
      id: card1.id,
      title: "Initial Task",
      status: "in-progress",
      priority: "high",
      tags: ["gui"],
      content: "## Description\n- [x] item 1",
    });

    expect(card2.status).toBe("in-progress");
    expect(card2.filePath).toContain(".megasaver/planner/in-progress/");

    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(1);
    const inProgressCol = board.columns.find((c) => c.key === "in-progress");
    expect(inProgressCol?.cards).toHaveLength(1);
  });

  it("deletes a card by moving it to archive", async () => {
    const card = await writePlannerCard(projectDir, {
      title: "Task to delete",
      status: "todo",
      priority: "low",
    });
    await deletePlannerCard(projectDir, card.id);
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(0);
  });

  it("syncs root TODO.md into backlog", async () => {
    writeFileSync(
      join(projectDir, "TODO.md"),
      "# TODO\n- [ ] Task from todo.md\n- [x] Completed task\n",
    );
    const { importedCount } = await syncRootTodoFile(projectDir);
    expect(importedCount).toBe(2);
    const board = await readPlannerBoard(projectDir, "ws-test");
    expect(board.totalCards).toBe(2);
  });
});
