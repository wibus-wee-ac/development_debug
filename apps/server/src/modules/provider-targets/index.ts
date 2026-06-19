import { Elysia, t } from 'elysia'

import {
  cancelCodexChatgptCredentialLogin,
  readCodexChatgptCredentialLoginStatus,
  startCodexChatgptCredentialLogin,
} from '../chat-runtime-providers/codex/app-server/account-service'
import {
  consumeCodexRateLimitResetCredit,
  readCodexAccountDiagnostics,
} from '../chat-runtime-providers/codex/app-server/account-diagnostics'
import { ProviderTargetsModel } from './model'
import * as ProviderTargets from './service'

export const providerTargets = new Elysia({
  prefix: '/provider-targets',
  detail: { tags: ['provider-targets'] },
})
  .get(
    '/',
    () => ProviderTargets.listProviderTargets(),
    {
      detail: {
        summary: 'List provider targets',
      },
      response: { 200: t.Array(ProviderTargetsModel.providerTarget) },
    },
  )
  .put(
    '/:providerTargetId',
    ({ params, body }) => {
      return ProviderTargets.upsertManualProviderTarget({
        id: params.providerTargetId,
        displayName: body.displayName,
        providerKind: body.providerKind,
        enabled: body.enabled,
        connectionConfigJson: JSON.stringify(body.connectionConfig),
        credentialRef: body.credentialRef ?? null,
        iconSlug: body.iconSlug,
      })
    },
    {
      detail: {
        summary: 'Create or update a manual provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.upsertManualBody,
      response: { 200: ProviderTargetsModel.providerTarget },
    },
  )
  .delete(
    '/:providerTargetId',
    ({ params }) => {
      ProviderTargets.removeProviderTarget(params.providerTargetId)
      return { ok: true as const }
    },
    {
      detail: {
        summary: 'Delete provider target',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
  .post(
    '/credentials/chatgpt/login',
    ({ body }) => startCodexChatgptCredentialLogin({ label: body.label }),
    {
      detail: {
        summary: 'Start ChatGPT credential login',
        description: 'Start a Cradle-owned ChatGPT device auth flow and create an encrypted credential when it completes.',
      },
      body: ProviderTargetsModel.chatgptCredentialLoginStartBody,
      response: { 200: ProviderTargetsModel.chatgptCredentialLoginStartResponse },
    },
  )
  .get(
    '/credentials/chatgpt/login/:loginId',
    ({ params }) => readCodexChatgptCredentialLoginStatus(params.loginId),
    {
      detail: {
        summary: 'Read ChatGPT credential login status',
      },
      params: ProviderTargetsModel.chatgptCredentialLoginParams,
      response: { 200: ProviderTargetsModel.chatgptCredentialLoginStatus },
    },
  )
  .post(
    '/credentials/chatgpt/login/:loginId/cancel',
    ({ params }) => cancelCodexChatgptCredentialLogin(params.loginId),
    {
      detail: {
        summary: 'Cancel ChatGPT credential login',
      },
      params: ProviderTargetsModel.chatgptCredentialLoginParams,
      response: { 200: t.Object({ ok: t.Literal(true) }) },
    },
  )
  .get(
    '/:providerTargetId/model-settings',
    ({ params }) => ProviderTargets.getProviderTargetModelSettings(params.providerTargetId),
    {
      detail: {
        summary: 'Get model settings for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.modelSettings },
    },
  )
  .get(
    '/:providerTargetId/codex/account-diagnostics',
    ({ params }) => readCodexAccountDiagnostics({ providerTargetId: params.providerTargetId }),
    {
      detail: {
        summary: 'Read Codex account diagnostics for a provider target',
        description: 'Explicitly starts or reuses Codex app-server to read ChatGPT account usage and rate limits.',
      },
      params: ProviderTargetsModel.idParams,
      response: { 200: ProviderTargetsModel.codexAccountDiagnostics },
    },
  )
  .post(
    '/:providerTargetId/codex/rate-limit-reset-credit/consume',
    ({ params, body }) => consumeCodexRateLimitResetCredit({
      providerTargetId: params.providerTargetId,
      idempotencyKey: body.idempotencyKey,
    }),
    {
      detail: {
        summary: 'Consume a Codex rate-limit reset credit',
        description: 'Consumes one ChatGPT account reset credit using the supplied idempotency key.',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.codexRateLimitResetCreditConsumeBody,
      response: { 200: ProviderTargetsModel.codexRateLimitResetCreditConsumeResponse },
    },
  )
  .patch(
    '/:providerTargetId/model-visibility',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetModelVisibility(params.providerTargetId, body.enabledModels),
    {
      detail: {
        summary: 'Update visible models for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.modelVisibilityBody,
      response: { 200: ProviderTargetsModel.modelSettings },
    },
  )
  .patch(
    '/:providerTargetId/custom-models',
    ({ params, body }) =>
      ProviderTargets.updateProviderTargetCustomModels(params.providerTargetId, body.models),
    {
      detail: {
        summary: 'Update custom models for a provider target',
      },
      params: ProviderTargetsModel.idParams,
      body: ProviderTargetsModel.customModelsBody,
      response: { 200: ProviderTargetsModel.customModelEntryList },
    },
  )
