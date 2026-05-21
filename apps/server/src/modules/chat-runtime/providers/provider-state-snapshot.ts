import { z } from 'zod'

const ProviderStateSnapshotSchema = z.object({
  models: z.object({
    currentModelId: z.string().nullable().default(null),
  }).default({ currentModelId: null }),
}).passthrough()

const WorkspaceProviderStateSnapshotSchema = ProviderStateSnapshotSchema.extend({
  workspacePath: z.string().optional(),
})

export const ProviderStateSnapshotJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '{}') as string),
  ProviderStateSnapshotSchema,
)

export const WorkspaceProviderStateSnapshotJsonSchema = z.preprocess(
  raw => JSON.parse((raw ?? '{}') as string),
  WorkspaceProviderStateSnapshotSchema,
)
