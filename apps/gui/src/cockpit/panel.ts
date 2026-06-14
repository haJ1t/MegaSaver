export type CockpitPanelScope = "session" | "workspace";

export type CockpitPanelProps = {
  dir: string;
  id: string;
  cwd: string;
};

export type CockpitPanel = {
  id: string;
  label: string;
  scope: CockpitPanelScope;
  component: (props: CockpitPanelProps) => JSX.Element;
};
