/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_DEMO?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_README_LOCAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
