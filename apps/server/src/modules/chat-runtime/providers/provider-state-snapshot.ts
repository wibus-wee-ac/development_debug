import { z } from 'zod'

const ProviderStateSnapshotSchema = z.object({
  models: z.object({
    currentModelId: z.string().nullable().default(null),
  }).default({ currentModelId: null }),
}).passthrough()

const WorkspaceProviderStateSnapshotSchema = ProviderStateSnapshotSchema.extend({
  workspacePath: z.string().optional(),
})

export const ProviderStateSnapshotJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ProviderStateSnapshotSchema)

export const WorkspaceProviderStateSnapshotJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(WorkspaceProviderStateSnapshotSchema)
