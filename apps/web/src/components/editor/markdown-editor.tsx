import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback, useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'

import { cn } from '~/lib/cn'

import { EditorBubbleMenu } from './editor-bubble-menu'
import { HeadingWithId } from './heading-with-id'
import { ShikiCodeBlock } from './shiki-code-block'
import { SlashCommand } from './slash-command'
import { SmartMention } from './smart-mention'
import type { SmartMentionAttrs, SmartMentionItem } from './smart-mention-utils'

function getMarkdownContent(storage: unknown): string {
  const s = storage as { markdown: { getMarkdown: () => string } }
  return s.markdown.getMarkdown()
}

interface MarkdownEditorProps {
  content: string | null
  documentId?: string
  onChange?: (markdown: string) => void
  onSave?: (markdown: string) => void | Promise<void>
  saveOnBlur?: boolean
  readonly?: boolean
  placeholder?: string
  className?: string
  smartMentions?: {
    getItems: (query: string) => SmartMentionItem[] | Promise<SmartMentionItem[]>
    onOpen?: (attrs: SmartMentionAttrs) => void
  }
}

export function MarkdownEditor({
  content,
  documentId,
  onChange,
  onSave,
  saveOnBlur = true,
  readonly = false,
  placeholder = '开始编写...',
  className,
  smartMentions,
}: MarkdownEditorProps) {
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)
  const readonlyRef = useRef(readonly)
  const documentIdRef = useRef(documentId)
  const confirmedContentRef = useRef(content ?? '')
  const saveRequestRef = useRef(0)
  const smartMentionsRef = useRef(smartMentions)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    readonlyRef.current = readonly
  }, [readonly])

  useEffect(() => {
    smartMentionsRef.current = smartMentions
  }, [smartMentions])

  const smartMentionsEnabled = !!smartMentions

  const saveCurrentDraft = useCallback((currentEditor: Editor, options: { force?: boolean } = {}) => {
    if (readonlyRef.current || !onSaveRef.current) {
      return
    }

    const md = getMarkdownContent(currentEditor.storage)
    if (!options.force && md === confirmedContentRef.current) {
      return
    }

    const requestId = saveRequestRef.current + 1
    saveRequestRef.current = requestId

    try {
      const result = onSaveRef.current(md)
      void Promise.resolve(result)
        .then(() => {
          if (saveRequestRef.current === requestId) {
            confirmedContentRef.current = md
          }
        })
        .catch(() => {})
    }
    catch {
      // Keep the previous confirmed snapshot so later refreshes do not treat a failed write as saved.
    }
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: false,
        link: false,
      }),
      HeadingWithId,
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Typography,
      TaskList,
      TaskItem.configure({ nested: true }),
      ShikiCodeBlock,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      Image,
      SlashCommand,
      ...(smartMentionsEnabled
        ? [
            SmartMention.configure({
              getItems: (query: string) => smartMentionsRef.current?.getItems(query) ?? [],
              onOpen: (attrs: SmartMentionAttrs) => smartMentionsRef.current?.onOpen?.(attrs),
            }),
          ]
        : []),
    ],
    content: content ?? '',
    editable: !readonly,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-48',
      },
    },
    // Auto-save on blur
    onBlur: ({ editor: e }) => {
      if (saveOnBlur) {
        saveCurrentDraft(e)
      }
    },
    onUpdate: ({ editor: e }) => {
      if (!readonlyRef.current) {
        onChangeRef.current?.(getMarkdownContent(e.storage))
      }
    },
  }, [placeholder, saveCurrentDraft, saveOnBlur, smartMentionsEnabled])

  useEffect(() => {
    editor?.setEditable(!readonly)
  }, [editor, readonly, saveCurrentDraft])

  useEffect(() => {
    if (!editor) {
      return
    }

    const nextContent = content ?? ''
    const currentContent = getMarkdownContent(editor.storage)
    const documentChanged = documentIdRef.current !== documentId
    const hasLocalEdits = currentContent !== confirmedContentRef.current

    if (documentChanged) {
      documentIdRef.current = documentId
      confirmedContentRef.current = nextContent
      if (currentContent !== nextContent) {
        editor.commands.setContent(nextContent)
      }
      return
    }

    if (nextContent === confirmedContentRef.current) {
      return
    }

    if (hasLocalEdits) {
      return
    }

    confirmedContentRef.current = nextContent
    if (currentContent !== nextContent) {
      editor.commands.setContent(nextContent)
    }
  }, [content, documentId, editor])

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    if (!editor || readonly) {
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey)
        && e.key.toLowerCase() === 's'
        && (editor.isFocused || editor.view.dom.contains(document.activeElement))
      ) {
        e.preventDefault()
        saveCurrentDraft(editor, { force: true })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editor, readonly, saveCurrentDraft])

  return (
    <div className={cn('tiptap-editor', className)}>
      {editor && !readonly && <EditorBubbleMenu editor={editor} />}
      <EditorContent
        editor={editor}
        className={cn(
          'prose prose-neutral dark:prose-invert max-w-none',
          'prose-headings:font-heading prose-headings:tracking-tight',
          'prose-h1:text-2xl prose-h1:font-semibold prose-h1:mb-4',
          'prose-h2:text-xl prose-h2:font-semibold prose-h2:mb-3 prose-h2:mt-8',
          'prose-h3:text-lg prose-h3:font-medium prose-h3:mb-2 prose-h3:mt-6',
          'prose-p:leading-[1.75] prose-p:text-[15px]',
          'prose-code:text-[13px] prose-code:font-mono',
          'prose-pre:bg-muted prose-pre:rounded-lg prose-pre:border prose-pre:border-border',
          'prose-a:text-foreground prose-a:underline prose-a:underline-offset-4 prose-a:decoration-border hover:prose-a:decoration-foreground',
          'prose-img:rounded-lg',
          'prose-li:text-[15px]',
          '[&_.is-editor-empty:first-child::before]:text-muted-foreground/40 [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:pointer-events-none',
        )}
      />
    </div>
  )
}
