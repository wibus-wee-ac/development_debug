import { z } from 'zod'

export const ProfileConfigSchema = z.object({
  baseUrl: z.string().default(''),
  model: z.string().default(''),
  api: z.string().default(''),
  enabledModels: z.array(z.string().min(1)).default([]),
}).passthrough()

export const ProfileConfigJsonSchema = z.string()
  .nullish()
  .transform(raw => JSON.parse(raw ?? '{}'))
  .pipe(ProfileConfigSchema)
