declare module "*.css?raw" {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  // Dev-only shared bridge token, injected by vite at build time (see
  // vite.config.ts). Absent in the packaged build, which bootstraps from ?token=.
  readonly VITE_MEGASAVER_GUI_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
