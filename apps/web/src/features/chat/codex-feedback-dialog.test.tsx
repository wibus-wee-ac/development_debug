/**
 * Output: Regression coverage for Codex feedback dialog payloads.
 * Input: User-selected feedback category, required details, and include-logs toggle.
 * Position: Feature-owned tests for Codex app-server feedback UI.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { CodexFeedbackDialog } from './codex-feedback-dialog'

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
})

afterEach(() => {
  cleanup()
})

describe('CodexFeedbackDialog', () => {
  it('requires details before submitting feedback', () => {
    render(
      <CodexFeedbackDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Bug' }))

    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits Codex feedback upload params with logs included by default', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn(async () => true)

    render(
      <CodexFeedbackDialog
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Bad result' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Share details' }), {
      target: { value: '  The answer missed the active goal.  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        classification: 'bad-result',
        reason: 'The answer missed the active goal.',
        includeLogs: true,
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('can submit feedback without logs', async () => {
    const onSubmit = vi.fn(async () => true)

    render(
      <CodexFeedbackDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Safety check' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include logs' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Share details' }), {
      target: { value: 'This needs review.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        classification: 'safety_check',
        reason: 'This needs review.',
        includeLogs: false,
      })
    })
  })
})
