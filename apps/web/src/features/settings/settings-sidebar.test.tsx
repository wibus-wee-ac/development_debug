// @vitest-environment jsdom
//
// Input: React Testing Library and SettingsSidebar props
// Output: Regression tests for settings sidebar navigation accessibility
// Position: Settings feature test guarding the sidebar close control and nav callbacks

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsSidebar } from './settings-sidebar'

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

describe('SettingsSidebar', () => {
  afterEach(() => {
    cleanup()
  })

  it('exposes a named close control and keeps the callback wired', () => {
    const onClose = vi.fn()
    const onSetSection = vi.fn()

    render(
      <SettingsSidebar
        activeSection="appearance"
        onSetSection={onSetSection}
        onClose={onClose}
      />,
    )

    const closeButton = screen.getByRole('button', { name: 'Close settings' })
    expect(closeButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(closeButton)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSetSection).not.toHaveBeenCalled()
  })

  it('keeps section navigation callbacks separate from closing settings', () => {
    const onClose = vi.fn()
    const onSetSection = vi.fn()

    render(
      <SettingsSidebar
        activeSection="appearance"
        onSetSection={onSetSection}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Providers' }))

    expect(onSetSection).toHaveBeenCalledWith('providers')
    expect(onClose).not.toHaveBeenCalled()
  })
})
