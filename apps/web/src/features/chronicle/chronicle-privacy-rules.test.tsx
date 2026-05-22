// Tests Chronicle privacy rule editing.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChronicleConfig } from './use-chronicle'
import { PrivacyRulesPanel } from './chronicle-settings'

function createConfig(overrides: Partial<ChronicleConfig> = {}): ChronicleConfig {
  return {
    profileId: '',
    modelId: '',
    workspaceId: '',
    enabled: false,
    activityPipelineEnabled: true,
    activityPipelineIntervalMs: 120_000,
    activityPipelineBatchSize: 3,
    dreamSchedulerEnabled: true,
    dreamSchedulerIntervalMs: 86_400_000,
    dreamSchedulerApplyMerge: false,
    audioCaptureEnabled: false,
    audioSource: 'microphone',
    audioSegmentMs: 5_000,
    audioSegmentIntervalMs: 60_000,
    audioRmsThreshold: 0.02,
    storageRoot: '/tmp/cradle-chronicle',
    privacySensitiveAppBundleIds: [],
    privacySensitiveTitlePatterns: [],
    privacySensitiveUrlPatterns: [],
    closedEyesDiscardEnabled: false,
    closedEyesMode: 'auto',
    ...overrides,
  }
}

describe('PrivacyRulesPanel', () => {
  afterEach(() => {
    cleanup()
  })

  it('saves line-based privacy rules as canonical config arrays', async () => {
    const updateConfig = vi.fn(async updates => createConfig(updates))
    render(
      <PrivacyRulesPanel
        config={createConfig()}
        saving={false}
        onUpdateConfig={updateConfig}
      />,
    )

    fireEvent.change(screen.getByLabelText('App bundle id'), {
      target: { value: ' com.apple.Terminal \ncom.apple.Terminal\ncom.example.Secret' },
    })
    fireEvent.change(screen.getByLabelText('窗口标题片段'), {
      target: { value: '\nBank Dashboard\n  Payroll ' },
    })
    fireEvent.change(screen.getByLabelText('网页地址片段'), {
      target: { value: ' admin.example.com \n\nbilling.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存规则' }))

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({
        privacySensitiveAppBundleIds: ['com.apple.Terminal', 'com.example.Secret'],
        privacySensitiveTitlePatterns: ['Bank Dashboard', 'Payroll'],
        privacySensitiveUrlPatterns: ['admin.example.com', 'billing.example.com'],
      })
    })
  })

  it('updates closed-eyes discard controls through Chronicle config', async () => {
    const updateConfig = vi.fn(async updates => createConfig(updates))
    render(
      <PrivacyRulesPanel
        config={createConfig({ closedEyesDiscardEnabled: true })}
        saving={false}
        onUpdateConfig={updateConfig}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: '始终暂停' }))

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({ closedEyesMode: 'always-pause' })
    })

    fireEvent.click(screen.getByRole('switch', { name: '闭眼丢弃' }))

    await waitFor(() => {
      expect(updateConfig).toHaveBeenCalledWith({ closedEyesDiscardEnabled: false })
    })
  })
})
