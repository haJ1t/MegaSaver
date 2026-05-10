// @vitest-environment jsdom
import type { Project } from "@megasaver/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectPicker,
  readPersistedProjectId,
  writePersistedProjectId,
} from "../../src/components/project-picker.js";
import { installLocalStoragePolyfill } from "../support/local-storage-polyfill.js";

const STORAGE_KEY = "megasaver:gui:v1:active-project-id";

const PROJECT_A: Project = {
  id: "11111111-1111-4111-8111-111111111111" as Project["id"],
  name: "acme-app",
  rootPath: "/tmp/a",
  createdAt: "2026-05-09T00:00:00.000Z",
  updatedAt: "2026-05-09T00:00:00.000Z",
};

const PROJECT_B: Project = {
  id: "22222222-2222-4222-8222-222222222222" as Project["id"],
  name: "beta-svc",
  rootPath: "/tmp/b",
  createdAt: "2026-05-09T01:00:00.000Z",
  updatedAt: "2026-05-09T01:00:00.000Z",
};

beforeEach(() => {
  installLocalStoragePolyfill();
});

afterEach(() => {
  cleanup();
});

describe("ProjectPicker — trigger render", () => {
  it("renders the active project name when activeId matches", () => {
    render(
      <ProjectPicker
        projects={[PROJECT_A, PROJECT_B]}
        activeId={PROJECT_A.id}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("acme-app");
  });

  it("renders 'Select project' when activeId is null but projects exist", () => {
    render(<ProjectPicker projects={[PROJECT_A]} activeId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button").textContent).toContain("Select project");
  });

  it("renders 'No projects' when projects list is empty and disables the trigger", () => {
    render(<ProjectPicker projects={[]} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toContain("No projects");
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });

  it("sets aria-haspopup=listbox and aria-expanded=false initially", () => {
    render(<ProjectPicker projects={[PROJECT_A]} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ProjectPicker — listbox semantics", () => {
  it("opens a role=listbox on click and renders one role=option per project", () => {
    render(<ProjectPicker projects={[PROJECT_A, PROJECT_B]} activeId={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("marks the active option aria-selected=true", () => {
    render(
      <ProjectPicker
        projects={[PROJECT_A, PROJECT_B]}
        activeId={PROJECT_B.id}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("beta-svc");
  });

  it("toggles aria-expanded to true when opened", () => {
    render(<ProjectPicker projects={[PROJECT_A]} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("ProjectPicker — selection + persistence", () => {
  it("calls onSelect with the project id when an option is clicked", () => {
    const onSelect = vi.fn();
    render(<ProjectPicker projects={[PROJECT_A, PROJECT_B]} activeId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("beta-svc"));
    expect(onSelect).toHaveBeenCalledWith(PROJECT_B.id);
  });

  it("persists the selected id to localStorage under megasaver:gui:v1:active-project-id", () => {
    render(<ProjectPicker projects={[PROJECT_A]} activeId={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("acme-app"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe(PROJECT_A.id);
  });
});

describe("ProjectPicker — keyboard navigation", () => {
  it("opens on ArrowDown when closed", () => {
    render(<ProjectPicker projects={[PROJECT_A, PROJECT_B]} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeDefined();
  });

  it("commits selection on Enter when listbox is open", () => {
    const onSelect = vi.fn();
    render(<ProjectPicker projects={[PROJECT_A, PROJECT_B]} activeId={null} onSelect={onSelect} />);
    const trigger = screen.getByRole("button");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // open
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(PROJECT_A.id);
  });

  it("closes the listbox on Escape", () => {
    render(<ProjectPicker projects={[PROJECT_A]} activeId={null} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeDefined();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("readPersistedProjectId / writePersistedProjectId", () => {
  it("readPersistedProjectId returns null when nothing is stored", () => {
    expect(readPersistedProjectId()).toBeNull();
  });

  it("writePersistedProjectId(id) round-trips through readPersistedProjectId", () => {
    writePersistedProjectId(PROJECT_A.id);
    expect(readPersistedProjectId()).toBe(PROJECT_A.id);
  });

  it("writePersistedProjectId(null) clears the persisted value", () => {
    writePersistedProjectId(PROJECT_A.id);
    writePersistedProjectId(null);
    expect(readPersistedProjectId()).toBeNull();
  });
});
