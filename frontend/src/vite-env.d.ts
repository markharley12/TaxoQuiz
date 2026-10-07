/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** A dataset under `data/` to bundle instead of the packaged example — see
   *  src/engine/local.ts. Unset for the ordinary app and the website's root;
   *  the website's full/ build sets it. */
  readonly VITE_BUNDLED_DATASET?: string
  /** Where the website's other build lives, relative to this one — see
   *  OTHER_SITE in App.tsx. Set by `build:pages` alone. */
  readonly VITE_OTHER_SITE?: string
}
