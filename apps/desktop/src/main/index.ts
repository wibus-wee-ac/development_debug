import { installDesktopMainErrorCapture } from './observability-reporter'

installDesktopMainErrorCapture()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
