/**
 * Output: Codex app-server user input and provider-native command projections.
 * Input: Cradle UIMessage/string turns, file parts, and selected skill context parts.
 * Position: Codex provider package boundary from Chat Runtime input to app-server UserInput.
 */

import { fileURLToPath } from 'node:url'

import type { UIMessage } from 'ai'

import { readChatSkillContextPart } from '../../chat-runtime/context-parts'
import { readGoalMessageObjective } from '../../chat-runtime/message-snapshots'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { extractUiMessageText } from '../../chat-runtime/ui-message-input'
import { CODEX_RUNTIME_KIND } from './metadata'

export type CodexRuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]

export type CodexUserInput = { type: 'text', text: string, text_elements: [] }
  | { type: 'image', detail?: 'high' | 'original', url: string }
  | { type: 'localImage', detail?: 'high' | 'original', path: string }
  | { type: 'skill', name: string, path: string }

export function readCodexGoalCommandObjective(message: CodexRuntimeMessageInput): string | null {
  if (typeof message !== 'string') {
    const metadataObjective = readGoalMessageObjective(message)
    if (metadataObjective) {
      return metadataObjective
    }
  }
  const text = extractUiMessageText(message).trim()
  if (!text.startsWith('/goal')) {
    return null
  }
  const objective = text.slice('/goal'.length).trim()
  return objective.length > 0 ? objective : null
}

export function isCodexCompactCommand(message: CodexRuntimeMessageInput): boolean {
  const text = extractUiMessageText(message).trim()
  if (!text.startsWith('/compact')) {
    return false
  }
  const nextChar = text.charAt('/compact'.length)
  return !nextChar || nextChar === ' ' || nextChar === '\t'
}

export function projectCodexUserInput(message: CodexRuntimeMessageInput, runtimeLabel: string): CodexUserInput[] {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
    }
    return [toTextUserInput(text)]
  }

  const input: CodexUserInput[] = []
  const unsupportedParts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text) {
        input.push(toTextUserInput(text))
      }
      continue
    }
    if (part.type === 'file') {
      if (part.mediaType.startsWith('image/')) {
        input.push(toCodexImageInput(part))
      }
      else {
        unsupportedParts.push(describeUnsupportedFilePart(part))
      }
      continue
    }
    const skillPart = readChatSkillContextPart(part)
    if (skillPart) {
      input.push({ type: 'skill', name: skillPart.name, path: skillPart.path })
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} only supports text, image, and skill input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (input.length === 0) {
    throw codexRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
  }
  return input
}

export function describeCodexUserInput(input: CodexUserInput[], text: string): string {
  const imageCount = input.filter(item => item.type === 'image' || item.type === 'localImage').length
  const skillCount = input.filter(item => item.type === 'skill').length
  if (imageCount === 0 && skillCount === 0) {
    return text
  }
  const suffixParts = [
    imageCount > 0 ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : '',
    skillCount > 0 ? `${skillCount} skill${skillCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
  const suffix = `[${suffixParts.join(', ')}]`
  return text ? `${text}\n${suffix}` : suffix
}

function toTextUserInput(text: string): CodexUserInput {
  return { type: 'text', text, text_elements: [] }
}

function toCodexImageInput(part: Extract<MessagePart, { type: 'file' }>): CodexUserInput {
  if (part.url.startsWith('file:')) {
    return { type: 'localImage', path: fileURLToPath(part.url) }
  }
  return { type: 'image', url: part.url }
}

function describeUnsupportedFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  const filename = part.filename ? ` (${part.filename})` : ''
  return `file${filename} (${part.mediaType})`
}

function codexRequestError(method: string, detail: string): ProviderRuntimeError {
  return new ProviderRuntimeError(ProviderErrors.requestFailed(CODEX_RUNTIME_KIND, method, detail))
}
