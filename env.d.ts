/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Name of the custom OIDC provider in staticwebapp.config.json (default: entraExternalId). */
  readonly VITE_AUTH_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
