// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentBadge, RiskBadge, ScopeBadge, StatusBadge } from "../../src/components/badges.js";

afterEach(() => {
  cleanup();
});

describe("RiskBadge", () => {
  it("renders short copy 'low' for level=low", () => {
    const { container } = render(<RiskBadge level="low" />);
    expect(container.textContent).toBe("low");
  });

  it("renders short copy 'med' for level=medium", () => {
    const { container } = render(<RiskBadge level="medium" />);
    expect(container.textContent).toBe("med");
  });

  it("renders short copy 'high' for level=high", () => {
    const { container } = render(<RiskBadge level="high" />);
    expect(container.textContent).toBe("high");
  });

  it("renders short copy 'crit' for level=critical", () => {
    const { container } = render(<RiskBadge level="critical" />);
    expect(container.textContent).toBe("crit");
  });

  it("attaches the variant class badge-risk-critical for level=critical", () => {
    const { container } = render(<RiskBadge level="critical" />);
    const span = container.querySelector("span");
    expect(span?.className).toContain("badge-risk-critical");
  });

  it("exposes an aria-label 'Risk: <level>' for screen readers", () => {
    const { container } = render(<RiskBadge level="high" />);
    expect(container.querySelector("span")?.getAttribute("aria-label")).toBe("Risk: high");
  });
});

describe("StatusBadge", () => {
  it("renders the literal status 'open' when status=open", () => {
    const { container } = render(<StatusBadge status="open" />);
    expect(container.textContent).toBe("open");
  });

  it("renders the literal status 'ended' when status=ended", () => {
    const { container } = render(<StatusBadge status="ended" />);
    expect(container.textContent).toBe("ended");
  });

  it("attaches the variant class badge-status-open when status=open", () => {
    const { container } = render(<StatusBadge status="open" />);
    expect(container.querySelector("span")?.className).toContain("badge-status-open");
  });

  it("attaches the variant class badge-status-ended when status=ended", () => {
    const { container } = render(<StatusBadge status="ended" />);
    expect(container.querySelector("span")?.className).toContain("badge-status-ended");
  });
});

describe("ScopeBadge", () => {
  it("renders 'project' when scope=project", () => {
    const { container } = render(<ScopeBadge scope="project" />);
    expect(container.textContent).toBe("project");
  });

  it("renders 'session' when scope=session", () => {
    const { container } = render(<ScopeBadge scope="session" />);
    expect(container.textContent).toBe("session");
  });

  it("attaches the variant class badge-scope-session when scope=session", () => {
    const { container } = render(<ScopeBadge scope="session" />);
    expect(container.querySelector("span")?.className).toContain("badge-scope-session");
  });
});

describe("AgentBadge", () => {
  it("renders the short label 'claude' for agentId=claude-code", () => {
    const { container } = render(<AgentBadge agentId="claude-code" />);
    expect(container.textContent).toBe("claude");
  });

  it("renders the short label 'cli' for agentId=generic-cli", () => {
    const { container } = render(<AgentBadge agentId="generic-cli" />);
    expect(container.textContent).toBe("cli");
  });

  it("exposes aria-label 'Agent: <id>' for screen readers", () => {
    const { container } = render(<AgentBadge agentId="aider" />);
    expect(container.querySelector("span")?.getAttribute("aria-label")).toBe("Agent: aider");
  });
});
