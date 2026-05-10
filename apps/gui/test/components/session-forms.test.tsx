// @vitest-environment jsdom
import type { Session } from "@megasaver/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateSessionForm, UpdateSessionForm } from "../../src/components/session-forms.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ISO = "2026-05-10T12:00:00.000Z";

const OPEN_SESSION: Session = {
  id: SESSION_ID as Session["id"],
  projectId: PROJECT_ID as Session["projectId"],
  agentId: "codex",
  riskLevel: "high",
  title: "Refactor auth",
  startedAt: ISO,
  endedAt: null,
};

afterEach(() => {
  cleanup();
});

describe("CreateSessionForm — submit", () => {
  it("calls onCreate with the typed title, default agent and risk", async () => {
    const onCreate = vi.fn().mockResolvedValue({ ...OPEN_SESSION, title: "  new  " });
    const onCreated = vi.fn();
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={onCreate}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "new" } });
    fireEvent.submit(screen.getByLabelText("Create session"));
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      agentId: "claude-code",
      title: "new",
      riskLevel: "medium",
    });
  });

  it("omits the title field entirely when input is whitespace-only (mirrors CLI)", async () => {
    const onCreate = vi.fn().mockResolvedValue(OPEN_SESSION);
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={onCreate}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "   " } });
    fireEvent.submit(screen.getByLabelText("Create session"));
    await Promise.resolve();
    expect(onCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      agentId: "claude-code",
      riskLevel: "medium",
    });
  });

  it("renders an Agent <select> with every closed-enum option from agentIdSchema", () => {
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Agent") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["aider", "claude-code", "codex", "cursor", "generic-cli"]);
  });

  it("renders a Risk <select> with every RiskLevel option", () => {
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("Risk level") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["low", "medium", "high", "critical"]);
  });

  it("invokes onCreated with the returned session on successful submit", async () => {
    const onCreate = vi.fn().mockResolvedValue(OPEN_SESSION);
    const onCreated = vi.fn();
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={onCreate}
        onCreated={onCreated}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByLabelText("Create session"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onCreated).toHaveBeenCalledWith(OPEN_SESSION);
  });

  it("surfaces a bridge error envelope in a role=alert region", async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue({ error: "bad", code: "validation_failed", details: [] });
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={onCreate}
        onCreated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByLabelText("Create session"));
    await Promise.resolve();
    await Promise.resolve();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Invalid input");
  });

  it("invokes onCancel when the Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <CreateSessionForm
        projectId={PROJECT_ID}
        onCreate={vi.fn()}
        onCreated={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("UpdateSessionForm — prefilled + semantics", () => {
  it("prefills the title field from the session", () => {
    render(
      <UpdateSessionForm
        session={OPEN_SESSION}
        onUpdate={vi.fn()}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Refactor auth");
  });

  it("prefills the agent and risk selects from the session", () => {
    render(
      <UpdateSessionForm
        session={OPEN_SESSION}
        onUpdate={vi.fn()}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe("codex");
    expect((screen.getByLabelText("Risk level") as HTMLSelectElement).value).toBe("high");
  });

  it("submits the patch with title=null when the title is cleared (mirrors CLI)", async () => {
    const onUpdate = vi.fn().mockResolvedValue(OPEN_SESSION);
    render(
      <UpdateSessionForm
        session={OPEN_SESSION}
        onUpdate={onUpdate}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.submit(screen.getByLabelText("Update session"));
    await Promise.resolve();
    expect(onUpdate).toHaveBeenCalledWith(SESSION_ID, {
      title: null,
      agentId: "codex",
      riskLevel: "high",
    });
  });

  it("passes the new title trimmed and the same agent/risk when title changes", async () => {
    const onUpdate = vi.fn().mockResolvedValue(OPEN_SESSION);
    render(
      <UpdateSessionForm
        session={OPEN_SESSION}
        onUpdate={onUpdate}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  renamed  " } });
    fireEvent.submit(screen.getByLabelText("Update session"));
    await Promise.resolve();
    expect(onUpdate).toHaveBeenCalledWith(SESSION_ID, {
      title: "renamed",
      agentId: "codex",
      riskLevel: "high",
    });
  });

  it("surfaces bridge error envelope in role=alert when onUpdate rejects", async () => {
    const onUpdate = vi.fn().mockRejectedValue({ error: "ended", code: "session_already_ended" });
    render(
      <UpdateSessionForm
        session={OPEN_SESSION}
        onUpdate={onUpdate}
        onUpdated={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.submit(screen.getByLabelText("Update session"));
    await Promise.resolve();
    await Promise.resolve();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This session has already ended.");
  });
});
