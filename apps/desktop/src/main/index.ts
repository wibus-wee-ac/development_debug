// Input: Velopack startup hooks and desktop app bootstrap
// Output: Main process entry — runs Velopack before starting Electron
// Position: apps/desktop/src/main/index.ts

import { VelopackApp } from 'velopack'

VelopackApp.build().run()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
