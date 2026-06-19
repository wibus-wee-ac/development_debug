import { z } from 'zod'

export const ProfileConfigSchema = z.object({
  baseUrl: z.string().default(''),
  openaiBaseUrl: z.string().default(''),
  anthropicBaseUrl: z.string().default(''),
  model: z.string().default(''),
  api: z.string().default(''),
  authMode: z.enum([
    'apikey',
    'chatgpt',
    'chatgptAuthTokens',
    'agentIdentity',
    'personalAccessToken',
    'bedrockApiKey',
  ]).optional(),
  bedrock: z.object({
    region: z.string().default(''),
  }).optional(),
  enabledModels: z.array(z.string().min(1)).default([]),
}).passthrough()

export const ProfileConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ProfileConfigSchema)
