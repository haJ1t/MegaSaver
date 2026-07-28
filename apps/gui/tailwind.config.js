/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Instrument Sans", "SF Pro Display", "system-ui", "sans-serif"],
        serif: ["Instrument Serif", "ui-serif", "Georgia", "serif"],
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
        "line-soft": "var(--color-line-soft)",
        accent: "var(--color-accent)",
        "accent-fg": "var(--color-accent-fg)",
        "accent-soft": "var(--color-accent-soft)",
        scrim: "var(--color-scrim)",
        danger: "var(--color-danger)",
        "danger-fg": "var(--color-danger-fg)",
        warn: "var(--color-warn)",
        "warn-fg": "var(--color-warn-fg)",
        ok: "var(--color-ok)",
        "ok-fg": "var(--color-ok-fg)",
        "status-live-bg": "var(--status-live-bg)",
        "status-live-fg": "var(--status-live-fg)",
        "status-active-bg": "var(--status-active-bg)",
        "status-active-fg": "var(--status-active-fg)",
        "status-warn-bg": "var(--status-warn-bg)",
        "status-warn-fg": "var(--status-warn-fg)",
        "status-danger-bg": "var(--status-danger-bg)",
        "status-danger-fg": "var(--status-danger-fg)",
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
        // Pin subset — extended by the console redesign (2026-07-28 spec §3)
        // with the meta (2xs), page-title (2xl) and display steps.
        "2xs": ["0.7143rem", { lineHeight: "1rem" }],
        xs: ["0.7857rem", { lineHeight: "1.125rem" }],
        sm: ["0.8571rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.55" }],
        lg: ["1.0714rem", { lineHeight: "1.5rem" }],
        xl: ["1.2857rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.6429rem", { lineHeight: "2rem" }],
        display: ["4.2857rem", { lineHeight: "1" }],
      },
      spacing: {
        // Pin subset: 0 1 2 3 4 5 6 7 8 12 14 (spec §6c, extended)
        0: "0px",
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        7: "28px",
        8: "32px",
        12: "48px",
        14: "56px",
      },
      borderRadius: {
        // Pin subset: none sm md lg xl 2xl full (spec §6d, extended)
        none: "0",
        sm: "0.375rem",
        md: "0.5714rem",
        lg: "0.7143rem",
        xl: "0.8571rem",
        "2xl": "1.1429rem",
        full: "9999px",
      },
      boxShadow: {
        // Pin subset: none sm md (spec §6e, extended)
        none: "none",
        sm: "0 2px 8px rgb(0 0 0 / 0.04)",
        md: "var(--color-shadow)",
      },
    },
  },
  plugins: [],
};
