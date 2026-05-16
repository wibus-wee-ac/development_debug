// Input: @tiptap/react, @tiptap/starter-kit, tiptap-markdown, ShikiCodeBlock, SlashCommand, BubbleMenu
// Output: MarkdownEditor — WYSIWYG Tiptap editor that reads/writes Markdown
// Position: Shared editor component for workspace-detail feature

import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'
import { Markdown } from 'tiptap-markdown'

import { cn } from '~/lib/cn'

import { EditorBubbleMenu } from './editor-bubble-menu'
import { HeadingWithId } from './heading-with-id'
import { ShikiCodeBlock } from './shiki-code-block'
import { SlashCommand } from './slash-command'

function getMarkdownContent(storage: unknown): string {
  const s = storage as { markdown: { getMarkdown: () => string } }
  return s.markdown.getMarkdown()
}

interface MarkdownEditorProps {
  content: string | null
  onSave?: (markdown: string) => void
  readonly?: boolean
  placeholder?: string
  className?: string
}

export function MarkdownEditor({
  content,
  onSave,
  readonly = false,
  placeholder = '开始编写...',
  className,
}: MarkdownEditorProps) {
  const onSaveRef = useRef(onSave)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

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
      if (!readonly && onSaveRef.current) {
        const md = getMarkdownContent(e.storage)
        onSaveRef.current(md)
      }
    },
  }, [readonly])

  // Update content when external content changes (initial load)
  const initialSetRef = useRef(false)
  useEffect(() => {
    if (editor && content !== null && !initialSetRef.current) {
      editor.commands.setContent(content)
      initialSetRef.current = true
    }
  }, [editor, content])

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
