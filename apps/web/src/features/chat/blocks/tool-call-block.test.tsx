// @vitest-environment jsdom
//
// Input: React Testing Library and ToolCallBlock tool IO examples
// Output: Regression coverage for Edit File diff preview routing and Diffs options
// Position: Chat tool block tests for file edit rendering behavior

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'

import { ToolCallBlock } from './tool-call-block'

const { multiFileDiffSpy } = vi.hoisted(() => ({
  multiFileDiffSpy: vi.fn((props: ComponentProps<'div'> & {
    options?: Record<string, unknown>
  }) => React.createElement('div', {
    'data-testid': 'mock-diffs-container',
    'data-diff-style': String(props.options?.diffStyle),
  })),
}))

vi.mock('@pierre/diffs/react', () => ({
  MultiFileDiff: multiFileDiffSpy,
}))

afterEach(() => {
  cleanup()
  multiFileDiffSpy.mockClear()
})

function renderToolCallBlock(props: ComponentProps<typeof ToolCallBlock>) {
  return render(
    <TooltipProvider>
      <ToolCallBlock {...props} />
    </TooltipProvider>,
  )
}

describe('tool call block file edit previews', () => {
  it('routes Edit File tool IO to the edit diff preview in the collapsed summary', () => {
    renderToolCallBlock(
      {
        toolName: 'Edit File',
        toolCallId: 'call-edit-file',
        state: 'output-available',
        input: {
          replace_all: false,
          file_path: '/Users/wibus/dev/Cradle/apps/server/src/index.ts',
          old_string: 'const app = await createServerApp()\napp.listen({ port: config.port })',
          new_string: 'const app = await createServerApp()\napp.listen({ port: config.port, reusePort: true })',
        },
        output: 'The file /Users/wibus/dev/Cradle/apps/server/src/index.ts has been updated successfully.',
      },
    )

    const block = screen.getByTestId('chat-tool-call-call-edit-file')
    const editBlock = within(block).getByTestId('chat-edit-file-block')
    const layoutControl = within(block).getByLabelText('Diff layout')
    const diffContainer = within(block).getByTestId('mock-diffs-container')

    expect(block.getAttribute('data-tool-kind')).toBe('file-diff')
    expect(editBlock).not.toBeNull()
    expect(layoutControl).not.toBeNull()
    expect(diffContainer.getAttribute('data-diff-style')).toBe('split')
    const firstDiffCall = multiFileDiffSpy.mock.calls[0]?.[0]

    expect(multiFileDiffSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        oldFile: expect.objectContaining({
          name: '/Users/wibus/dev/Cradle/apps/server/src/index.ts',
          contents: expect.stringContaining('app.listen'),
        }),
        newFile: expect.objectContaining({
          name: '/Users/wibus/dev/Cradle/apps/server/src/index.ts',
          contents: expect.stringContaining('reusePort'),
        }),
        options: expect.objectContaining({
          diffStyle: 'split',
          theme: {
            dark: 'pierre-dark',
            light: 'pierre-light',
          },
        }),
      }),
      undefined,
    )
    expect(firstDiffCall?.options).not.toHaveProperty('collapsed')
  })

  it('keeps the layout control visible and switches Diffs to unified style for stacked view', () => {
    renderToolCallBlock(
      {
        toolName: 'Edit File',
        toolCallId: 'call-edit-file-layout',
        state: 'output-available',
        input: {
          file_path: '/repo/src/app.tsx',
          old_string: 'old',
          new_string: 'new',
        },
        output: 'updated',
      },
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Stacked diff layout' }))

    expect(screen.getByLabelText('Diff layout')).not.toBeNull()
    expect(screen.getByTestId('mock-diffs-container').getAttribute('data-diff-style')).toBe('unified')
  })
})
