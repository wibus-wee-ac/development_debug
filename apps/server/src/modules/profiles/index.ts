import { Elysia, t } from 'elysia'

import { AppError } from '../../errors/app-error'
import { ProfilesModel } from './model'
import * as Profiles from './service'

export const profiles = new Elysia({
  prefix: '/profiles',
  detail: { tags: ['profiles'] },
})
  .get('/', () => Profiles.listProfiles(), {
    detail: {
      summary: 'List profiles',
      'x-cradle-cli': {
        command: ['profile', 'list'],
      },
    },
    response: { 200: t.Array(ProfilesModel.agentProfile) },
  })
  .get('/:id', ({ params }) => {
    const p = Profiles.getProfile(params.id)
    if (!p) {
      throw new AppError({ code: 'profile_not_found', status: 404, message: 'Profile not found' })
    }
    return p
  }, {
    detail: {
      summary: 'Get profile by ID',
      'x-cradle-cli': {
        command: ['profile', 'get'],
      },
    },
    params: ProfilesModel.idParams,
    response: { 200: ProfilesModel.agentProfile },
  })
  .put('/:id', ({ params, body }) => {
    return Profiles.upsertProfile({
      id: params.id,
      name: body.name,
      providerKind: body.providerKind,
      enabled: body.enabled,
      configJson: JSON.stringify(body.config),
      credentialRef: body.credentialRef ?? null,
    })
  }, {
    detail: {
      summary: 'Create or update profile',
      'x-cradle-cli': {
        command: ['profile', 'set'],
      },
    },
    params: ProfilesModel.idParams,
    body: ProfilesModel.upsertBody,
    response: { 200: ProfilesModel.agentProfile },
  })
  .delete('/:id', ({ params }) => {
    Profiles.removeProfile(params.id)
    return { ok: true as const }
  }, {
    detail: {
      summary: 'Delete profile',
      'x-cradle-cli': {
        command: ['profile', 'delete'],
      },
    },
    params: ProfilesModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
