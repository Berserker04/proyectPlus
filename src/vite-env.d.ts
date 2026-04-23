/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
}

interface ImportMetaEnv {
  readonly TOPOLOGY_SOURCE?: string;
  readonly VITE_TOPOLOGY_SOURCE?: string;
}
