// Input: PackCodebaseService
// Output: HTTP endpoint for workspace-owned codebase packing
// Position: apps/server/src/modules/pack-codebase/pack-codebase.controller.ts

import { Body, Controller, Param, Post } from '@tsuki-hono/common'
import { inject, injectable } from 'tsyringe'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { PackCodebaseService } from './pack-codebase.service'

const packCodebaseRequestSchema = z.object({
  style: z.enum(['xml', 'markdown', 'plain']),
  compress: z.boolean(),
  include: z.string().trim().min(1).optional(),
  ignore: z.string().trim().min(1).optional(),
  removeComments: z.boolean().optional(),
  removeEmptyLines: z.boolean().optional(),
})

type PackCodebaseRequest = z.infer<typeof packCodebaseRequestSchema>

@injectable()
@Controller('workspaces')
export class PackCodebaseController {
  constructor(@inject(PackCodebaseService) private readonly service: PackCodebaseService) {}

  @Post('/:workspaceId/pack')
  pack(@Param('workspaceId') workspaceId: string, @Body() body?: PackCodebaseRequest) {
    const parsed = packCodebaseRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError({
        code: 'invalid_pack_codebase_input',
        status: 400,
        message: parsed.error.issues.map(issue => issue.message).join('; '),
      })
    }

    return this.service.packWorkspace(requireNonBlankString(workspaceId, 'workspaceId'), parsed.data)
  }
}

function requireNonBlankString(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new AppError({
      code: 'invalid_pack_codebase_input',
      status: 400,
      message: `${field} is required`,
    })
  }
  return trimmed
}
