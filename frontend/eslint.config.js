import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// `files` has to name the TypeScript extensions. It said `**/*.{js,jsx}` — the
// stock Vite JavaScript template — in a project where every source file is .ts
// or .tsx, so `npm run lint` matched nothing under src/ and exited 0 having
// checked the config files and little else.
export default defineConfig([
  // `android/` is Capacitor's native project, and after a build it holds
  // generated JavaScript (the native bridge, and copies of dist/) that is not
  // ours to lint. Lint passed until the first APK build created those files,
  // so a clean checkout — CI included — would never show the failure.
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
