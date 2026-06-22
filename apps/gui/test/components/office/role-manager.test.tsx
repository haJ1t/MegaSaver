// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeRole } from "../../../src/lib/office-client.js";

// ── Module stubs ──────────────────────────────────────────────────────────────

const stub = {
  fetchRoles: () => Promise.reject(new Error("not set")),
  createRole: (_input: unknown) => Promise.reject(new Error("not set")),
  deleteRole: (_id: string) => Promise.reject(new Error("not set")),
};

vi.mock("../../../src/lib/office-client.js", () => ({
  fetchRoles: () => stub.fetchRoles(),
  createRole: (input: unknown) => stub.createRole(input),
  deleteRole: (id: string) => stub.deleteRole(id),
}));

import { RoleManager } from "../../../src/views/office/role-manager.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROLE_1: OfficeRole = {
  id: "r1",
  name: "my-coder",
  kind: "claude-code",
  permissionMode: "plan",
  allowedTools: ["Bash", "Read"],
  createdAt: "2026-06-22T00:00:00Z",
};

const ROLE_FULL: OfficeRole = {
  id: "r2",
  name: "full-access",
  kind: "claude-code",
  permissionMode: "full",
  allowedTools: [],
  createdAt: "2026-06-22T00:00:00Z",
};

afterEach(() => {
  cleanup();
  stub.fetchRoles = () => Promise.reject(new Error("not set"));
  stub.createRole = () => Promise.reject(new Error("not set"));
  stub.deleteRole = () => Promise.reject(new Error("not set"));
});

describe("RoleManager", () => {
  it("shows loading then renders roles list", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    render(<RoleManager />);
    expect(screen.getByLabelText(/Loading roles/)).toBeDefined();
    await waitFor(() => expect(screen.getByText("my-coder")).toBeDefined());
    expect(screen.getByText("Bash, Read")).toBeDefined();
  });

  it("shows empty state when no roles", async () => {
    stub.fetchRoles = () => Promise.resolve([]);
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText(/No roles yet/)).toBeDefined());
  });

  it("shows error state on fetch failure", async () => {
    stub.fetchRoles = () => Promise.reject({ error: "boom", code: "internal_error" });
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
  });

  it("opens create form and posts correct body on submit", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    const created: OfficeRole = {
      id: "r3",
      name: "new-role",
      kind: "claude-code",
      permissionMode: "plan",
      allowedTools: ["Bash"],
      createdAt: "2026-06-22T00:00:00Z",
    };
    let capturedInput: unknown;
    stub.createRole = (input: unknown) => {
      capturedInput = input;
      return Promise.resolve(created);
    };
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText("my-coder")).toBeDefined());

    // Open create form
    fireEvent.click(screen.getByText(/\+ New role/));
    await waitFor(() => expect(screen.getByLabelText(/Create role form/)).toBeDefined());

    // Fill form
    fireEvent.change(screen.getByLabelText(/Name \*/), { target: { value: "new-role" } });
    fireEvent.change(screen.getByLabelText(/Allowed tools/), { target: { value: "Bash" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(screen.getByText("new-role")).toBeDefined());
    expect(capturedInput).toMatchObject({ name: "new-role", allowedTools: ["Bash"] });
  });

  it("surfaces bridge 400 error inline on create failure", async () => {
    stub.fetchRoles = () => Promise.resolve([]);
    stub.createRole = () =>
      Promise.reject({ error: "tool names must not start with -", code: "validation_error" });
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText(/No roles yet/)).toBeDefined());

    fireEvent.click(screen.getByText(/\+ New role/));
    await waitFor(() => expect(screen.getByLabelText(/Create role form/)).toBeDefined());
    fireEvent.change(screen.getByLabelText(/Name \*/), { target: { value: "bad-tools" } });
    fireEvent.change(screen.getByLabelText(/Allowed tools/), { target: { value: "-rm" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    await waitFor(() => expect(screen.getByText(/tool names must not start with -/)).toBeDefined());
  });

  it("shows full-permission warning when permissionMode is full", async () => {
    stub.fetchRoles = () => Promise.resolve([]);
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText(/No roles yet/)).toBeDefined());

    fireEvent.click(screen.getByText(/\+ New role/));
    await waitFor(() => expect(screen.getByLabelText(/Create role form/)).toBeDefined());

    const select = screen.getByLabelText(/Permission mode/);
    fireEvent.change(select, { target: { value: "full" } });

    await waitFor(() => expect(screen.getByText(/MEGA_OFFICE_ALLOW_FULL/)).toBeDefined());
  });

  it("deletes a role after confirmation", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    let deleteCalled = false;
    stub.deleteRole = (_id: string) => {
      deleteCalled = true;
      return Promise.resolve();
    };
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText("my-coder")).toBeDefined());

    // Click delete (✕)
    fireEvent.click(screen.getByLabelText(/Delete role my-coder/));
    await waitFor(() => expect(screen.getByText("Delete?")).toBeDefined());

    // Confirm
    fireEvent.click(screen.getByText("Yes"));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(screen.queryByText("my-coder")).toBeNull());
  });

  it("cancels delete when No is clicked", async () => {
    stub.fetchRoles = () => Promise.resolve([ROLE_1]);
    stub.deleteRole = () => Promise.resolve();
    render(<RoleManager />);
    await waitFor(() => expect(screen.getByText("my-coder")).toBeDefined());

    fireEvent.click(screen.getByLabelText(/Delete role my-coder/));
    await waitFor(() => expect(screen.getByText("Delete?")).toBeDefined());
    fireEvent.click(screen.getByText("No"));

    await waitFor(() => expect(screen.queryByText("Delete?")).toBeNull());
    expect(screen.getByText("my-coder")).toBeDefined();
  });
});
