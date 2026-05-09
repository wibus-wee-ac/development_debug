// Input: secrets service
// Output: HTTP endpoints for server-owned secret lifecycle
// Position: apps/server/src/modules/secrets/secrets.controller.ts

import { Body, Controller, Delete, Get, Param, Post } from '@tsuki-hono/common'

import { AppError } from '../../errors/app-error'
import { SecretsService } from './secrets.service'

type SaveSecretBody = {
  kind?: string
  label?: string
  secret?: string
}

@Controller('secrets')
export class SecretsController {
  constructor(private readonly service: SecretsService) {}

  @Get('/')
  listSecrets() {
    return this.service.listSecrets()
  }

  @Post('/')
  saveSecret(@Body() body: SaveSecretBody) {
    return this.service.saveSecret({
      kind: requireSecretKind(body.kind),
      label: requireNonBlankString(body.label, 'label'),
      secret: requireNonBlankString(body.secret, 'secret'),
    })
  }

  @Delete('/:id')
  removeSecret(@Param('id') id: string) {
    this.service.removeSecret(requireNonBlankString(id, 'id'))
    return { ok: true }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidSecretInput(`${field} is required`)
  }
  return trimmed
}

function requireSecretKind(value: string | undefined): string {
  return requireNonBlankString(value, 'kind')
}

function invalidSecretInput(message: string): AppError {
  return new AppError({
    code: 'invalid_secret_input',
    status: 400,
    message,
  })
}