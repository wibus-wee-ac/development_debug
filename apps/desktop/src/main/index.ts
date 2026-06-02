import { VelopackApp } from 'velopack'

import { installDesktopMainErrorCapture } from './observability-reporter'

installDesktopMainErrorCapture()
VelopackApp.build().run()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
