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
  onSave?: (markdown: string) => void
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
  onSave,
  readonly = false,
  placeholder = '开始编写...',
  className,
  smartMentions,
}: MarkdownEditorProps) {
  const onSaveRef = useRef(onSave)
  const readonlyRef = useRef(readonly)
  const smartMentionsRef = useRef(smartMentions)
  const documentIdRef = useRef(documentId)
  const externalContentRef = useRef(content ?? '')

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    readonlyRef.current = readonly
  }, [readonly])

  useEffect(() => {
    smartMentionsRef.current = smartMentions
  }, [smartMentions])

  const getSmartMentionItems = useCallback((query: string) => {
    return smartMentionsRef.current?.getItems(query) ?? []
  }, [])

  const handleSmartMentionOpen = useCallback((attrs: SmartMentionAttrs) => {
    smartMentionsRef.current?.onOpen?.(attrs)
  }, [])

  const smartMentionsEnabled = !!smartMentions

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
              getItems: getSmartMentionItems,
              onOpen: handleSmartMentionOpen,
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
      if (!readonlyRef.current && onSaveRef.current) {
        const md = getMarkdownContent(e.storage)
        onSaveRef.current(md)
      }
    },
  }, [getSmartMentionItems, handleSmartMentionOpen, placeholder, smartMentionsEnabled])

  useEffect(() => {
    editor?.setEditable(!readonly)
  }, [editor, readonly])

  useEffect(() => {
    if (!editor) {
      return
    }

    const nextContent = content ?? ''
    const currentContent = getMarkdownContent(editor.storage)
    const documentChanged = documentIdRef.current !== documentId
    const hasLocalEdits = currentContent !== externalContentRef.current

    if (documentChanged) {
      documentIdRef.current = documentId
      externalContentRef.current = nextContent
      if (currentContent !== nextContent) {
        editor.commands.setContent(nextContent)
      }
      return
    }

    if (nextContent === externalContentRef.current) {
      return
    }

    externalContentRef.current = nextContent
    if (!hasLocalEdits && currentContent !== nextContent) {
      editor.commands.setContent(nextContent)
    }
  }, [content, documentId, editor])

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    if (!editor || readonly) {
      return
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        const md = getMarkdownContent(editor.storage)
        onSaveRef.current?.(md)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editor, readonly])

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
