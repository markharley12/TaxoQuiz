/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** A dataset under `data/` to bundle instead of the packaged example — see
   *  src/engine/local.ts. Unset for the website and the ordinary app. */
  readonly VITE_BUNDLED_DATASET?: string
}
