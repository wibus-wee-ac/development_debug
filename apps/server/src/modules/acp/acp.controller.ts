// Input: ACP service
// Output: HTTP endpoints for ACP management capability
// Position: apps/server/src/modules/acp/acp.controller.ts

import { Body, Controller, Delete, Get, Param, Put, Query } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { AcpService } from './acp.service'

const installRequestSchema = z.object({
  distributionType: z.enum(['binary', 'npx', 'uvx']),
})

type InstallRequest = z.infer<typeof installRequestSchema>

@injectable()
@Controller('acp')
export class AcpController {
  constructor(@inject(AcpService) private readonly service: AcpService) {}

  @Get('/registry')
  listRegistry() {
    return this.service.fetchRegistry()
  }

  @Get('/registry/:agentId/distribution-types')
  getDistributionTypes(@Param('agentId') agentId: string) {
    return this.service.getDistributionTypes(requireNonBlankString(agentId, 'agentId'))
  }

  @Get('/agents')
  listInstalled() {
    return this.service.listInstalled()
  }

  @Get('/agents/:agentId')
  getInstalled(@Param('agentId') agentId: string) {
    return this.service.getInstalled(requireNonBlankString(agentId, 'agentId'))
  }

  @Put('/agents/:agentId/installation')
  installInstallation(@Param('agentId') agentId: string, @Body() body?: InstallRequest) {
    const parsed = installRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw invalidAcpInput(parsed.error.issues.map(issue => issue.message).join('; '))
    }
    return this.service.install(requireNonBlankString(agentId, 'agentId'), parsed.data.distributionType)
  }

  @Delete('/agents/:agentId/installation')
  cancelInstallation(@Param('agentId') agentId: string) {
    this.service.cancelInstall(requireNonBlankString(agentId, 'agentId'))
    return { ok: true }
  }

  @Delete('/agents/:agentId')
  uninstall(@Param('agentId') agentId: string) {
    return this.service.uninstall(requireNonBlankString(agentId, 'agentId')).then(() => ({ ok: true }))
  }

  @Get('/audit')
  getAudit(@Query('agentId') agentId?: string) {
    return this.service.getAuditLog(normalizeOptionalString(agentId))
  }

  @Get('/agents/:agentId/install-path')
  getInstallPath(@Param('agentId') agentId: string) {
    return { path: this.service.getAgentInstallPath(requireNonBlankString(agentId, 'agentId')) }
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw invalidAcpInput(`${field} is required`)
  }
  return trimmed
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function invalidAcpInput(message: string): AppError {
  return new AppError({
    code: 'invalid_acp_input',
    status: 400,
    message,
  })
}
