import { t } from 'elysia'

export const ChronicleModel = {
  config: t.Object({
    profileId: t.String(),
    modelId: t.String(),
    workspaceId: t.String(),
    enabled: t.Boolean(),
    storageRoot: t.String(),
  }),

  timelineEntry: t.Object({
    id: t.String(),
    sourceType: t.Optional(t.Union([t.Literal('snapshot'), t.Literal('message')])),
    capturedAt: t.String(),
    capturedAtUnix: t.Number(),
    displayId: t.Number(),
    segmentDir: t.String(),
    framePath: t.String(),
    ocrText: t.Nullable(t.String()),
    appBundleId: t.Nullable(t.String()),
    windowTitle: t.Nullable(t.String()),
    platform: t.Optional(t.Nullable(t.String())),
    channelId: t.Optional(t.Nullable(t.String())),
    channelName: t.Optional(t.Nullable(t.String())),
    userName: t.Optional(t.Nullable(t.String())),
  }),

  memoryEntry: t.Object({
    id: t.String(),
    type: t.Union([t.Literal('10min'), t.Literal('6h')]),
    source: t.Union([t.Literal('llm'), t.Literal('local'), t.Literal('imported')]),
    createdAt: t.String(),
    createdAtUnix: t.Number(),
    content: t.String(),
    modelId: t.Nullable(t.String()),
  }),

  modelResource: t.Object({
    id: t.String(),
    category: t.Union([
      t.Literal('ocr'),
      t.Literal('audio-vad'),
      t.Literal('audio-asr'),
      t.Literal('speaker'),
      t.Literal('embedding'),
    ]),
    status: t.String(),
    displayName: t.String(),
    path: t.Nullable(t.String()),
    version: t.Nullable(t.String()),
    message: t.Nullable(t.String()),
    sizeBytes: t.Nullable(t.Number()),
    metadata: t.Record(t.String(), t.Any()),
    updatedAt: t.Number(),
  }),

  modelResourceCategoryParams: t.Object({
    category: t.Union([
      t.Literal('ocr'),
      t.Literal('audio-vad'),
      t.Literal('audio-asr'),
      t.Literal('speaker'),
      t.Literal('embedding'),
    ]),
  }),

  modelResourceInstallBody: t.Object({
    sourcePath: t.Optional(t.Nullable(t.String())),
    sourceUrl: t.Optional(t.Nullable(t.String())),
  }),

  messageSource: t.Object({
    id: t.String(),
    platform: t.Literal('slack'),
    label: t.String(),
    enabled: t.Boolean(),
    workspaceId: t.Nullable(t.String()),
    teamId: t.Nullable(t.String()),
    botTokenRef: t.Nullable(t.String()),
    channelIds: t.Array(t.String()),
    status: t.Union([
      t.Literal('idle'),
      t.Literal('syncing'),
      t.Literal('ready'),
      t.Literal('error'),
      t.Literal('disabled'),
    ]),
    lastSyncAt: t.Nullable(t.Number()),
    lastMessageAt: t.Nullable(t.Number()),
    lastError: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  messageSourceBody: t.Object({
    platform: t.Literal('slack'),
    label: t.String({ minLength: 1 }),
    enabled: t.Boolean(),
    workspaceId: t.Optional(t.Nullable(t.String())),
    teamId: t.Optional(t.Nullable(t.String())),
    botTokenRef: t.Optional(t.Nullable(t.String())),
    channelIds: t.Array(t.String()),
  }),

  messageSourcePatchBody: t.Object({
    label: t.Optional(t.String({ minLength: 1 })),
    enabled: t.Optional(t.Boolean()),
    workspaceId: t.Optional(t.Nullable(t.String())),
    teamId: t.Optional(t.Nullable(t.String())),
    botTokenRef: t.Optional(t.Nullable(t.String())),
    channelIds: t.Optional(t.Array(t.String())),
  }),

  messageEntry: t.Object({
    id: t.String(),
    sourceId: t.String(),
    platform: t.Literal('slack'),
    channelId: t.String(),
    channelName: t.Nullable(t.String()),
    userName: t.Nullable(t.String()),
    text: t.String(),
    messageTs: t.String(),
    messageAt: t.String(),
    messageAtUnix: t.Number(),
    permalink: t.Nullable(t.String()),
  }),

  slackSyncResponse: t.Object({
    sourceId: t.String(),
    status: t.Union([t.Literal('success'), t.Literal('error')]),
    ingested: t.Number(),
    message: t.String(),
  }),

  summarizeBody: t.Object({
    prompt: t.String({ minLength: 1 }),
    windowType: t.Union([t.Literal('10min'), t.Literal('6h')]),
    sourceSnapshotIds: t.Optional(t.Array(t.String())),
    sourceArtifactPaths: t.Optional(t.Array(t.String())),
  }),

  summarizeResponse: t.Object({
    summary: t.String(),
    memoryId: t.Nullable(t.String()),
    status: t.Union([t.Literal('success'), t.Literal('error')]),
  }),

  snapshotReportBody: t.Object({
    sourceId: t.String({ minLength: 1 }),
    displayId: t.Number(),
    frameIndex: t.Optional(t.Number()),
    capturedAt: t.String({ minLength: 1 }),
    segmentDir: t.String(),
    framePath: t.String(),
    capturePath: t.Optional(t.String()),
    ocrPath: t.Optional(t.String()),
    snapshotPath: t.Optional(t.String()),
    ocrText: t.Optional(t.String()),
    appBundleId: t.Optional(t.String()),
    windowTitle: t.Optional(t.String()),
    metadata: t.Optional(t.Record(t.String(), t.Any())),
  }),

  memoryReportBody: t.Object({
    sourceId: t.String({ minLength: 1 }),
    windowType: t.Union([t.Literal('10min'), t.Literal('6h')]),
    createdAt: t.String({ minLength: 1 }),
    memoryPath: t.Optional(t.String()),
    content: t.String(),
    summaryKind: t.Union([t.Literal('llm'), t.Literal('local'), t.Literal('imported')]),
    sourceSnapshotPaths: t.Optional(t.Array(t.String())),
    sourceFramePaths: t.Optional(t.Array(t.String())),
    metadata: t.Optional(t.Record(t.String(), t.Any())),
  }),

  status: t.Object({
    available: t.Boolean(),
    running: t.Boolean(),
    pid: t.Nullable(t.Number()),
    lastCaptureAt: t.Nullable(t.Number()),
    lastSummaryAt: t.Nullable(t.Number()),
    lastErrorAt: t.Nullable(t.Number()),
    lastError: t.Nullable(t.String()),
    lastExitCode: t.Nullable(t.Number()),
    lastExitAt: t.Nullable(t.Number()),
    totalSnapshots: t.Number(),
    totalSummaries: t.Number(),
    totalMessages: t.Number(),
    lastMessageAt: t.Nullable(t.Number()),
    configuredModel: t.Nullable(t.String()),
  }),
}
