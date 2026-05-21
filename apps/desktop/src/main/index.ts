import { VelopackApp } from 'velopack'

VelopackApp.build().run()

void import('./main-app').then(({ startDesktopApp }) => startDesktopApp())
