import { describe, expect, it } from "vitest";
import { searchFailedAttempts } from "../src/failed-attempt-search.js";
import type { FailedAttempt } from "../src/failed-attempt.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
function fa(over: Omit<Partial<FailedAttempt>, "id"> & { id: string }): FailedAttempt {
  return {
    id: over.id as FailedAttempt["id"],
    projectId: PROJECT_ID as FailedAttempt["projectId"],
    sessionId: null,
    task: over.task ?? "task",
    failedStep: over.failedStep ?? "step",
    relatedFiles: [],
    convertedToRule: over.convertedToRule ?? false,
    createdAt: over.createdAt ?? "2026-06-12T00:00:00.000Z",
    ...(over.errorOutput !== undefined ? { errorOutput: over.errorOutput } : {}),
    ...(over.suspectedCause !== undefined ? { suspectedCause: over.suspectedCause } : {}),
  } as FailedAttempt;
}

describe("searchFailedAttempts", () => {
  it("ranks by BM25 over task+failedStep+errorOutput+suspectedCause", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", task: "fix login auth bug" });
    const b = fa({ id: "a0000000-0000-4000-8000-000000000002", task: "update navbar styling" });
    const out = searchFailedAttempts([a, b], { text: "login auth" });
    expect(out.map((x) => x.id)).toEqual([a.id]);
  });

  it("drops zero-overlap matches", () => {
    const a = fa({ id: "a0000000-0000-4000-8000-000000000001", task: "login" });
    expect(searchFailedAttempts([a], { text: "completely unrelated terms" })).toEqual([]);
  });

  it("excludes converted failures unless includeConverted", () => {
    const a = fa({
      id: "a0000000-0000-4000-8000-000000000001",
      task: "login",
      convertedToRule: true,
    });
    expect(searchFailedAttempts([a], { text: "login" })).toEqual([]);
    expect(searchFailedAttempts([a], { text: "login", includeConverted: true })).toHaveLength(1);
  });

  it("with no text returns newest-first, stable by id", () => {
    const a = fa({
      id: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-06-12T01:00:00.000Z",
    });
    const b = fa({
      id: "a0000000-0000-4000-8000-000000000002",
      createdAt: "2026-06-12T02:00:00.000Z",
    });
    expect(searchFailedAttempts([a, b], {}).map((x) => x.id)).toEqual([b.id, a.id]);
  });
});
