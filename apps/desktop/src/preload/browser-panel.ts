import { contextBridge, ipcRenderer } from 'electron'

const SEND_PROMPT_CHANNEL = 'cradle:send-prompt'

type SendPromptAttachmentInput = string | Blob | {
  dataURL?: unknown
  dataUrl?: unknown
  filename?: unknown
  mediaType?: unknown
  mimeType?: unknown
  name?: unknown
  type?: unknown
  url?: unknown
}

interface NormalizedSendPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined'
    && typeof value === 'object'
    && value !== null
    && typeof (value as Blob).arrayBuffer === 'function'
    && typeof (value as Blob).type === 'string'
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readAttachmentUrl(input: Record<string, unknown>): string | undefined {
  return readString(input.url)
    ?? readString(input.dataUrl)
    ?? readString(input.dataURL)
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(String(event.target?.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment'))
    reader.readAsDataURL(blob)
  })
}

async function normalizeAttachment(input: SendPromptAttachmentInput): Promise<NormalizedSendPromptAttachment | null> {
  if (typeof input === 'string') {
    return input.length > 0 ? { url: input } : null
  }

  if (isBlob(input)) {
    const url = await readBlobAsDataUrl(input)
    if (!url) {
      return null
    }
    return {
      filename: 'name' in input && typeof input.name === 'string' ? input.name : undefined,
      mediaType: input.type || undefined,
      url,
    }
  }

  if (!isRecord(input)) {
    return null
  }

  const url = readAttachmentUrl(input)
  if (!url) {
    return null
  }

  return {
    filename: readString(input.filename) ?? readString(input.name),
    mediaType: readString(input.mediaType) ?? readString(input.mimeType) ?? readString(input.type),
    url,
  }
}

function readAttachmentInputs(input: unknown, fallback: unknown): SendPromptAttachmentInput[] {
  if (Array.isArray(fallback)) {
    return fallback as SendPromptAttachmentInput[]
  }
  if (isRecord(input) && Array.isArray(input.attachments)) {
    return input.attachments as SendPromptAttachmentInput[]
  }
  if (isRecord(input) && Array.isArray(input.files)) {
    return input.files as SendPromptAttachmentInput[]
  }
  return []
}

function readPromptText(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }
  if (!isRecord(input)) {
    return ''
  }
  return readString(input.text) ?? readString(input.prompt) ?? ''
}

async function sendPrompt(input: unknown, attachments?: unknown): Promise<void> {
  const text = readPromptText(input)
  const normalizedAttachments = await Promise.all(
    readAttachmentInputs(input, attachments).map(normalizeAttachment),
  )

  ipcRenderer.sendToHost(SEND_PROMPT_CHANNEL, {
    attachments: normalizedAttachments.filter(attachment => attachment !== null),
    text,
  })
}

contextBridge.exposeInMainWorld('codex', {
  sendPrompt,
})
