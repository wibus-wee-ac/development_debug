import { z } from 'zod'

export const acpChatConfigSchema = z.object({
  distributionType: z.enum(['binary', 'npx', 'uvx']).optional(),
  installPath: z.string().trim().min(1).nullable().optional(),
  cmd: z.string().trim().min(1).optional(),
  packageName: z.string().trim().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export type AcpChatConfig = z.infer<typeof acpChatConfigSchema>
