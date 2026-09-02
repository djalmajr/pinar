interface ImportMetaEnv {
  readonly VITE_PINAR_RUNTIME?: string;
  readonly VITE_PINAR_VERSION?: string;
  readonly VITE_PINAR_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
