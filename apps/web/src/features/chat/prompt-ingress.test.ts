import type { FileUIPart } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import {
  registerChatPromptIngressHandler,
  submitChatPromptIngress,
} from './prompt-ingress'

describe('chat prompt ingress', () => {
  it('routes prompt payloads to the registered session handler', () => {
    const handler = vi.fn()
    const filePart: FileUIPart = {
      type: 'file',
      filename: 'screen.png',
      mediaType: 'image/png',
      url: 'data:image/png;base64,abc',
    }
    const cleanup = registerChatPromptIngressHandler('session-a', handler)

    expect(submitChatPromptIngress('session-a', {
      text: 'Improve this page.',
      files: [filePart],
    })).toBe(true)

    expect(handler).toHaveBeenCalledWith({
      text: 'Improve this page.',
      files: [filePart],
    })

    cleanup()
  })

  it('returns false after unregistering the active session handler', () => {
    const handler = vi.fn()
    const cleanup = registerChatPromptIngressHandler('session-b', handler)

    cleanup()

    expect(submitChatPromptIngress('session-b', {
      text: 'Ignored prompt.',
      files: [],
    })).toBe(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('does not let an older cleanup remove a newer handler', () => {
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const cleanupFirst = registerChatPromptIngressHandler('session-c', firstHandler)
    const cleanupSecond = registerChatPromptIngressHandler('session-c', secondHandler)

    cleanupFirst()

    expect(submitChatPromptIngress('session-c', {
      text: 'Route to the latest handler.',
      files: [],
    })).toBe(true)
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledWith({
      text: 'Route to the latest handler.',
      files: [],
    })

    cleanupSecond()
  })
})
