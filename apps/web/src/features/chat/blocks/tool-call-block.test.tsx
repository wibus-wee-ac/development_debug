// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import type { ToolCallItem } from '~/features/chat/chat-render-plan'

import { GroupedToolCallBlock } from './grouped-tool-call-block'
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

function renderGroupedToolCallBlock(props: ComponentProps<typeof GroupedToolCallBlock>) {
  return render(
    <TooltipProvider>
      <GroupedToolCallBlock {...props} />
    </TooltipProvider>,
  )
}

describe('tool call block file edit previews', () => {
  it('shows a streaming Edit File payload preview before output is available', () => {
    renderToolCallBlock(
      {
        toolName: 'Edit File',
        toolCallId: 'call-edit-file-streaming',
        state: 'input-streaming',
        input: {
          input: '{"file_path":"/repo/src/app.tsx","old_string":"const value = 1","new_string":"const value = 2',
        },
      },
    )

    const block = screen.getByTestId('chat-tool-call-call-edit-file-streaming')

    expect(block.getAttribute('data-tool-kind')).toBe('file-diff')
    expect(within(block).getByText('Receiving file edit')).not.toBeNull()
    expect(within(block).getByText('93 chars')).not.toBeNull()
    expect(within(block).queryByTestId('chat-edit-file-block')).toBeNull()
    expect(multiFileDiffSpy).not.toHaveBeenCalled()
  })

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

    fireEvent.click(screen.getByRole('radio', { name: 'Stacked' }))

    expect(screen.getByLabelText('Diff layout')).not.toBeNull()
    expect(screen.getByTestId('mock-diffs-container').getAttribute('data-diff-style')).toBe('unified')
  })
})

describe('tool call block terminal output', () => {
  it('shows command and output together when a terminal call is expanded', () => {
    renderToolCallBlock({
      toolName: 'Bash',
      toolCallId: 'call-bash',
      state: 'output-available',
      input: {
        command: 'pnpm test -- --runInBand',
      },
      output: {
        stdout: 'tests passed\n',
        stderr: '',
      },
    })

    const block = screen.getByTestId('chat-tool-call-call-bash')

    expect(within(block).queryByText('Command')).toBeNull()
    expect(within(block).queryByText('tests passed')).toBeNull()

    fireEvent.click(within(block).getByRole('button', { name: /Run command/ }))

    expect(within(block).getByText('Command')).not.toBeNull()
    expect(within(block).getAllByText('pnpm test -- --runInBand').length).toBeGreaterThan(0)
    expect(within(block).getByText(/Output/)).not.toBeNull()
    expect(within(block).getByText('tests passed')).not.toBeNull()
  })

  it('expands grouped terminal rows with command and output in the same panel', () => {
    const items: ToolCallItem[] = [
      {
        key: 'call-a',
        subagentMessages: [],
        part: {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call-a',
          state: 'output-available',
          input: { command: 'pwd' },
          output: { stdout: '/repo\n' },
        },
      },
      {
        key: 'call-b',
        subagentMessages: [],
        part: {
          type: 'dynamic-tool',
          toolName: 'Bash',
          toolCallId: 'call-b',
          state: 'output-available',
          input: { command: 'ls' },
          output: { stdout: 'package.json\n' },
        },
      },
    ]

    renderGroupedToolCallBlock({ items, uiKind: 'terminal' })

    expect(screen.queryByText('package.json')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /ls/ }))

    expect(screen.getByText('Command')).not.toBeNull()
    expect(screen.getAllByText('ls').length).toBeGreaterThan(0)
    expect(screen.getByText('package.json')).not.toBeNull()
  })
})
