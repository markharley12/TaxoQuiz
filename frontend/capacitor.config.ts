import type { CapacitorConfig } from '@capacitor/cli'

// Capacitor wraps the built web app (`dist/`) in a native Android or iOS shell,
// served from inside the app package. That works because the app no longer
// needs a server: the example dataset is played by `src/engine/` on the device.
//
// `appId` is the package name on Android and the bundle ID on iOS. It is free
// to change until the first store upload and permanent after it, since the
// stores treat a different ID as a different app.
const config: CapacitorConfig = {
  appId: 'io.github.markharley12.taxoquiz',
  appName: 'TaxoQuiz',
  webDir: 'dist',
}

export default config
