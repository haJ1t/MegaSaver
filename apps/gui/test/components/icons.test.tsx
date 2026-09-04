import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon, ICON_NAMES } from "../../src/components/icons.js";

describe("Icon", () => {
  it("renders an svg with aria-hidden for every name", () => {
    for (const name of ICON_NAMES) {
      const { unmount } = render(<Icon name={name} />);
      const svg = document.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });
  it("exposes a labelled variant for standalone use", () => {
    render(<Icon name="check" label="Ready" />);
    expect(screen.getByLabelText("Ready")).toBeTruthy();
  });
});
