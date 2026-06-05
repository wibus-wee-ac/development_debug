/**
 * Output: Claude Agent provider-private types shared by package modules.
 * Input: Claude Agent SDK message content and AI SDK UIMessage parts.
 * Position: Claude Agent provider package type boundary.
 */

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage } from 'ai'

export interface ClaudeAgentSessionInfo {
  summary?: string
  customTitle?: string
}

export type RuntimeMessageInput = UIMessage | string
export type MessagePart = UIMessage['parts'][number]
export type ClaudeAgentUserContent = SDKUserMessage['message']['content']
export type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
export type ClaudeAgentContentBlock
  = | { type: 'text', text: string }
    | {
      type: 'image'
      source:
        | { type: 'base64', media_type: AnthropicImageMediaType, data: string }
        | { type: 'url', url: string }
    }
