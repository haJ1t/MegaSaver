import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handlePlannerRoute } from "../../bridge/routes/planner.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "planner-bridge-test-"));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("GUI bridge planner routes", () => {
  it("GET /api/planner returns board state", async () => {
    const res = await handlePlannerRoute({
      method: "GET",
      pathname: "/api/planner",
      query: { cwd: projectDir },
      body: null,
    });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("board");
  });

  it("POST /api/planner/card creates a card", async () => {
    const res = await handlePlannerRoute({
      method: "POST",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, title: "Bridge Task", status: "todo", priority: "high" },
    });
    expect(res.status).toBe(200);
    expect((res.json as { card: { title: string } }).card.title).toBe("Bridge Task");
  });

  it("PATCH /api/planner/card updates card and moves status", async () => {
    const createRes = await handlePlannerRoute({
      method: "POST",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, title: "Move Me", status: "todo", priority: "medium" },
    });
    const id = (createRes.json as { card: { id: string } }).card.id;

    const patchRes = await handlePlannerRoute({
      method: "PATCH",
      pathname: "/api/planner/card",
      query: {},
      body: { cwd: projectDir, id, status: "in-progress", priority: "critical" },
    });
    expect(patchRes.status).toBe(200);
    expect((patchRes.json as { card: { status: string } }).card.status).toBe("in-progress");
  });
});
