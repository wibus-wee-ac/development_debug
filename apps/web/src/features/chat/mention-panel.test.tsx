/**
 * Regression coverage for workspace file icons in the composer mention panel.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { MentionItem } from './mention-panel'
import { MentionPanel } from './mention-panel'

const items: MentionItem[] = [
  { type: 'file', name: 'README.md', path: 'README.md' },
  { type: 'directory', name: 'apps', path: 'apps' },
]

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('mentionPanel', () => {
  it('renders workspace file icons from the shared sprite-backed resolver', () => {
    render(
      <MentionPanel
        items={items}
        query=""
        visible
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const readmeOption = screen.getByRole('option', { name: 'README.md' })
    const iconUse = readmeOption.querySelector('svg use')

    expect(document.querySelector('svg[data-icon-sprite]')).toBeTruthy()
    expect(iconUse?.getAttribute('href')).toBe('#file-tree-builtin-markdown')
  })

  it('selects the active file with Tab instead of moving focus', () => {
    const onSelect = vi.fn()
    render(
      <MentionPanel
        items={items}
        query="read"
        visible
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    )

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })
})
