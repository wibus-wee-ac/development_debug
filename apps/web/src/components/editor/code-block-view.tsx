// Input: @tiptap/react NodeViewWrapper/NodeViewContent, shiki bundledLanguages
// Output: CodeBlockView — React NodeView for Tiptap code block with language selector
// Position: NodeView component used by ShikiCodeBlock extension

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import { bundledLanguages } from 'shiki'

const ALL_LANGUAGES = Object.keys(bundledLanguages).sort()

// Lazy-load a language — calls the parent module's ensureLanguage
async function lazyLoadLang(lang: string): Promise<void> {
  const mod = await import('./shiki-code-block')
  await mod.ensureLanguage(lang)
}

export function CodeBlockView({ node, updateAttributes }: {
  node: ProseMirrorNode
  updateAttributes: (attrs: Record<string, unknown>) => void
}) {
  const language = (node.attrs.language as string) || ''

  return (
    <NodeViewWrapper className="relative group">
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
        <select
          value={language}
          onChange={(e) => {
            const lang = e.target.value
            updateAttributes({ language: lang })
            void lazyLoadLang(lang)
          }}
          className="h-6 rounded border border-border/50 bg-background/80 backdrop-blur-xs px-1.5 text-[10px] text-muted-foreground outline-none cursor-pointer hover:border-border"
        >
          <option value="">auto</option>
          {ALL_LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      <pre className="bg-muted! rounded-lg! border! border-border! p-4! pr-24! text-[13px]! leading-relaxed! font-mono!">
        <NodeViewContent as="div" className="whitespace-pre" />
      </pre>
    </NodeViewWrapper>
  )
}
