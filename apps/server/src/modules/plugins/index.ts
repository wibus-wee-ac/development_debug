import { Elysia, t } from 'elysia'

import { PluginsModel } from './model'
import * as Plugins from './service'

export const plugins = new Elysia({
  prefix: '/plugins',
  detail: { tags: ['plugins'] },
})
  .get('/mentions', () => Plugins.listMentionCandidates(), {
    detail: {
      summary: 'List plugin mention candidates',
    },
    response: { 200: t.Array(PluginsModel.pluginMentionCandidate) },
  })
  .get('/:routeSegment/icon', async ({ params }) => {
    const icon = await Plugins.readPluginIcon(params.routeSegment)
    const body = icon.bytes.buffer.slice(
      icon.bytes.byteOffset,
      icon.bytes.byteOffset + icon.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        'content-type': icon.mimeType,
        'cache-control': 'no-store',
        'content-length': String(icon.bytes.byteLength),
      },
    })
  }, {
    detail: {
      summary: 'Read plugin icon asset',
    },
    params: t.Object({
      routeSegment: t.String({ minLength: 1 }),
    }),
  })
