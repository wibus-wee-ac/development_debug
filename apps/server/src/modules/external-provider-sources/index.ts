import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ExternalProviderSourcesModel } from './model'
import * as ExternalProviderSources from './service'

export const externalProviderSources = new Elysia({
  detail: { tags: ['external-provider-sources'] },
})
  .get('/external-provider-sources', () => ExternalProviderSources.listExternalProviderSources(), {
    detail: {
      summary: 'List external provider sources',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.source) },
  })
  .post('/external-provider-sources/refresh', () => ExternalProviderSources.refreshAllExternalProviderSources(), {
    detail: {
      summary: 'Refresh all external provider sources',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.refreshResult) },
  })
  .post('/external-provider-sources/:sourceKey/refresh', ({ params }) => {
    return ExternalProviderSources.refreshExternalProviderSource(params.sourceKey)
  }, {
    detail: {
      summary: 'Refresh an external provider source',
    },
    params: ExternalProviderSourcesModel.refreshParams,
    response: { 200: ExternalProviderSourcesModel.refreshResult },
  })
  .get('/external-provider-sources/records', () => ExternalProviderSources.listExternalProviderRecords(), {
    detail: {
      summary: 'List external provider source records',
    },
    response: { 200: t.Array(ExternalProviderSourcesModel.record) },
  })
  .get('/profiles/:id/external-source', ({ params }) => {
    const link = ExternalProviderSources.getExternalProfileLink(params.id)
    if (!link) {
      throw new AppError({ code: 'external_profile_link_not_found', status: 404, message: 'Profile is not managed by an external source', details: { profileId: params.id } })
    }
    return link
  }, {
    detail: {
      summary: 'Get external source metadata for a profile',
    },
    params: ExternalProviderSourcesModel.profileParams,
    response: { 200: ExternalProviderSourcesModel.profileLink },
  })
