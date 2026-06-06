import { t } from 'elysia'

const pluginCapabilityLayer = t.Union([
  t.Literal('server'),
  t.Literal('web'),
  t.Literal('desktop'),
])

const pluginMentionCapability = t.Object({
  id: t.String({ minLength: 1 }),
  type: t.String({ minLength: 1 }),
  layer: pluginCapabilityLayer,
  label: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const pluginMentionCandidate = t.Object({
  pluginName: t.String({ minLength: 1 }),
  displayName: t.String({ minLength: 1 }),
  description: t.Union([t.String(), t.Null()]),
  iconUrl: t.Union([t.String({ minLength: 1 }), t.Null()]),
  routeSegment: t.String({ minLength: 1 }),
  capabilities: t.Array(pluginMentionCapability),
  mcpServers: t.Array(t.String({ minLength: 1 })),
  active: t.Boolean(),
}, { additionalProperties: false })

export const PluginsModel = {
  pluginMentionCapability,
  pluginMentionCandidate,
} as const
