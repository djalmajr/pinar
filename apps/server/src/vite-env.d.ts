interface ImportMetaEnv {
  readonly VITE_PINAR_RUNTIME?: string;
  readonly VITE_PINAR_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
