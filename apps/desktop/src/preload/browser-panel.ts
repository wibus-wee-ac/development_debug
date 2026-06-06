import { contextBridge, ipcRenderer } from 'electron'

const BROWSER_SEND_PROMPT_CHANNEL = 'desktop:browser-send-prompt'

interface BrowserPanelPromptAttachment {
  filename?: string
  mediaType?: string
  url: string
}

type BrowserPanelAttachmentInput =
  | string
  | Blob
  | {
      dataURL?: string
      dataUrl?: string
      filename?: string
      mediaType?: string
      mimeType?: string
      name?: string
      type?: string
      url?: string
    }

type BrowserPanelSendPromptInput =
  | string
  | {
      attachments?: BrowserPanelAttachmentInput[]
      files?: BrowserPanelAttachmentInput[]
      prompt?: string
      text?: string
    }

interface BrowserPanelSendPromptPayload {
  text: string
  attachments: BrowserPanelPromptAttachment[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function inferMediaTypeFromDataUrl(url: string): string | undefined {
  const match = /^data:([^;,]+)[;,]/i.exec(url)
  return match?.[1]
}

function inferFilenameFromUrl(url: string): string | undefined {
  if (url.startsWith('data:')) {
    return undefined
  }

  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).at(-1)
    return segment ? decodeURIComponent(segment) : undefined
  }
  catch {
    return undefined
  }
}

function isBlobLike(value: unknown): value is Blob {
  return isObject(value)
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
    && typeof (value as { type?: unknown }).type === 'string'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Browser prompt attachment did not produce a data URL.'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Failed to read browser prompt attachment.')))
    reader.readAsDataURL(blob)
  })
}

async function normalizeAttachment(input: BrowserPanelAttachmentInput): Promise<BrowserPanelPromptAttachment | null> {
  if (typeof input === 'string') {
    const url = input.trim()
    if (!url) {
      return null
    }
    return {
      filename: inferFilenameFromUrl(url),
      mediaType: inferMediaTypeFromDataUrl(url),
      url,
    }
  }

  if (isBlobLike(input)) {
    const url = await blobToDataUrl(input)
    const filename = readString((input as { name?: unknown }).name)
    return {
      filename,
      mediaType: readString(input.type) ?? inferMediaTypeFromDataUrl(url),
      url,
    }
  }

  if (!isObject(input)) {
    return null
  }

  const url = readString(input.url) ?? readString(input.dataURL) ?? readString(input.dataUrl)
  if (!url) {
    return null
  }

  return {
    filename: readString(input.filename) ?? readString(input.name) ?? inferFilenameFromUrl(url),
    mediaType:
      readString(input.mediaType)
      ?? readString(input.mimeType)
      ?? readString(input.type)
      ?? inferMediaTypeFromDataUrl(url),
    url,
  }
}

async function normalizeSendPromptPayload(
  input: BrowserPanelSendPromptInput,
  attachments: BrowserPanelAttachmentInput[] = [],
): Promise<BrowserPanelSendPromptPayload> {
  if (typeof input === 'string') {
    return {
      text: input,
      attachments: (await Promise.all(attachments.map(normalizeAttachment))).filter(
        attachment => attachment !== null,
      ),
    }
  }

  const inlineAttachments = [
    ...(Array.isArray(input.attachments) ? input.attachments : []),
    ...(Array.isArray(input.files) ? input.files : []),
    ...attachments,
  ]

  return {
    text: input.text ?? input.prompt ?? '',
    attachments: (await Promise.all(inlineAttachments.map(normalizeAttachment))).filter(
      attachment => attachment !== null,
    ),
  }
}

contextBridge.exposeInMainWorld('codex', {
  async sendPrompt(
    input: BrowserPanelSendPromptInput,
    attachments?: BrowserPanelAttachmentInput[],
  ): Promise<void> {
    await ipcRenderer.invoke(
      BROWSER_SEND_PROMPT_CHANNEL,
      await normalizeSendPromptPayload(input, attachments),
    )
  },
})
