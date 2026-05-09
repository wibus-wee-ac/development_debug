// Input: Tsuki controller decorators
// Output: /health handler
// Position: apps/server/src/modules/health/health.controller.ts

import { Controller, Get } from '@tsuki-hono/common'
import { injectable } from 'tsyringe'

@injectable()
@Controller('health')
export class HealthController {
  @Get('/')
  check() {
    return { status: 'ok', timestamp: Date.now() }
  }
}
