/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["DM Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      colors: {
        // All semantic colors reference CSS variables defined in styles.css.
        // Components use these Tailwind utilities; they never hardcode hex.
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        "surface-elevated": "var(--color-surface-elevated)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        border: "var(--color-border)",
        accent: "var(--color-accent)",
        "accent-fg": "var(--color-accent-fg)",
        danger: "var(--color-danger)",
        "danger-fg": "var(--color-danger-fg)",
        warn: "var(--color-warn)",
        "warn-fg": "var(--color-warn-fg)",
        ok: "var(--color-ok)",
        "ok-fg": "var(--color-ok-fg)",
      },
      ringColor: {
        DEFAULT: "var(--color-focus-ring)",
      },
      ringOffsetColor: {
        DEFAULT: "var(--color-surface)",
      },
      borderColor: {
        DEFAULT: "var(--color-border)",
      },
      fontSize: {
        // Pin subset: xs sm base lg xl only (spec §6b)
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.5rem" }],
        lg: ["1rem", { lineHeight: "1.5rem" }],
        xl: ["1.125rem", { lineHeight: "1.75rem" }],
      },
      spacing: {
        // Pin subset: 0 1 2 3 4 6 8 12 (spec §6c)
        0: "0px",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        6: "24px",
        8: "32px",
        12: "48px",
      },
      borderRadius: {
        // Pin subset: none sm md lg full (spec §6d)
        none: "0",
        sm: "0.125rem",
        md: "0.25rem",
        lg: "0.375rem",
        full: "9999px",
      },
      boxShadow: {
        // Pin subset: none sm md (spec §6e)
        none: "none",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.12)",
        md: "0 4px 12px 0 rgb(0 0 0 / 0.20)",
      },
    },
  },
  plugins: [],
};
