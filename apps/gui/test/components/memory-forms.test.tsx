// @vitest-environment jsdom
import type { MemoryEntry, Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateMemoryForm } from "../../src/components/memory-forms.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OPEN_SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ENDED_SESSION_ID = "33333333-3333-4333-8333-333333333333";
const ISO = "2026-05-10T12:00:00.000Z";

const OPEN_SESSION: Session = {
  id: OPEN_SESSION_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "claude-code",
  riskLevel: "medium",
  title: "Open one",
  startedAt: ISO,
  endedAt: null,
};

const ENDED_SESSION: Session = {
  id: ENDED_SESSION_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "claude-code",
  riskLevel: "medium",
  title: "Ended one",
  startedAt: ISO,
  endedAt: "2026-05-10T13:00:00.000Z",
};

const MEMORY_ENTRY: MemoryEntry = {
  id: "44444444-4444-4444-8444-444444444444" as MemoryEntry["id"],
  projectId: PROJECT_ID as MemoryEntry["projectId"],
  sessionId: null,
  scope: "project",
  content: "memo content",
  createdAt: ISO,
};

afterEach(() => {
  cleanup();
});

describe("CreateMemoryForm — scope=project (default)", () => {
  it("submits with scope=project and content trimmed", async () => {
    const onCreate = vi.fn().mockResolvedValue(MEMORY_ENTRY);
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={onCreate}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "  hello  " } });
    fireEvent.submit(screen.getByLabelText("Create memory entry"));
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      content: "hello",
      scope: "project",
    });
  });

  it("does not render the Session select when scope=project", () => {
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Session")).toBeNull();
  });
});

describe("CreateMemoryForm — scope=session", () => {
  it("reveals the Session select after switching scope to session", () => {
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "session" } });
    expect(screen.getByLabelText("Session")).toBeDefined();
  });

  it("only lists OPEN sessions in the Session <select>", () => {
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION, ENDED_SESSION]}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "session" } });
    const select = screen.getByLabelText("Session") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain(OPEN_SESSION_ID);
    expect(values).not.toContain(ENDED_SESSION_ID);
  });

  it("disables the submit button until a session is chosen", () => {
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "session" } });
    const submit = screen.getByRole("button", { name: "Create" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submits with sessionId included when scope=session and a session is chosen", async () => {
    const onCreate = vi.fn().mockResolvedValue({ ...MEMORY_ENTRY, scope: "session" });
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={onCreate}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "note" } });
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "session" } });
    fireEvent.change(screen.getByLabelText("Session"), { target: { value: OPEN_SESSION_ID } });
    fireEvent.submit(screen.getByLabelText("Create memory entry"));
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      content: "note",
      scope: "session",
      sessionId: OPEN_SESSION_ID,
    });
  });

  it("clears the chosen sessionId when scope toggles back to project", () => {
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "session" } });
    fireEvent.change(screen.getByLabelText("Session"), { target: { value: OPEN_SESSION_ID } });
    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "project" } });
    expect(screen.queryByLabelText("Session")).toBeNull();
  });

  it("surfaces a bridge error envelope in role=alert when onCreate rejects", async () => {
    const onCreate = vi.fn().mockRejectedValue({ error: "x", code: "session_project_mismatch" });
    render(
      <CreateMemoryForm
        projectId={PROJECT_ID}
        sessions={[OPEN_SESSION]}
        onCreate={onCreate}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "boom" } });
    fireEvent.submit(screen.getByLabelText("Create memory entry"));
    await Promise.resolve();
    await Promise.resolve();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Session does not belong to this project.");
  });
});
