import { loadDesktopDevEnv } from './dev-env'
import { installDesktopMainErrorCapture } from './observability-reporter'

loadDesktopDevEnv()
installDesktopMainErrorCapture()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
