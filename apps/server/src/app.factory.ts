import type { HonoHttpApplication } from '@tsuki-hono/core'
import { createApplication } from '@tsuki-hono/core'
import { Hono } from 'hono'

import { AppModule } from './app.module'
import { registerOpenApiRoutes } from './openapi/openapi-routes'

export async function createConfiguredApp(): Promise<HonoHttpApplication> {
  const hono = new Hono()

  const app = await createApplication(AppModule, {}, hono)
  registerOpenApiRoutes(hono)

  return app
}
