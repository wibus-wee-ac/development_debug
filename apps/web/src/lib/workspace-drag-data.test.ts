// Input: Vitest and browser DataTransfer
// Output: Regression tests for workspace file drag payload serialization
// Position: Shared renderer drag/drop protocol tests for workspace file paths

import { describe, expect, it } from 'vitest'

import {
  readWorkspaceFileDragText,
  serializeWorkspaceFileDragPayload,
  writeWorkspaceFileDragData,
} from './workspace-drag-data'

function createFakeDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, data: string) => {
      values.set(format, data)
    },
  } as DataTransfer
}

describe('workspace file drag data', () => {
  it('serializes absolute workspace paths and quotes spaces for terminal drops', () => {
    const dataTransfer = createFakeDataTransfer()
    const payload = serializeWorkspaceFileDragPayload({
      relativePath: 'src/app file.ts',
      workspacePath: '/Users/wibus/dev/Cradle',
    })

    writeWorkspaceFileDragData(dataTransfer, payload)

    expect(readWorkspaceFileDragText(dataTransfer)).toBe('"/Users/wibus/dev/Cradle/src/app file.ts"')
  })

  it('falls back to text/plain for external drags', () => {
    const dataTransfer = createFakeDataTransfer()
    dataTransfer.setData('text/plain', '/tmp/example.ts')

    expect(readWorkspaceFileDragText(dataTransfer)).toBe('/tmp/example.ts')
  })
})
