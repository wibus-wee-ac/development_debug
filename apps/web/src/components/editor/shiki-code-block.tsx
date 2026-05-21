import CodeBlock from '@tiptap/extension-code-block'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { BundledLanguage, BundledTheme, HighlighterGeneric } from 'shiki'
import { bundledLanguages, createHighlighter } from 'shiki'

import { CodeBlockView } from './code-block-view'

/* ─── Singleton Highlighter ──────────────────────────────── */

const POPULAR_LANGS: string[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'python',
  'rust',
  'go',
  'java',
  'cpp',
  'c',
  'html',
  'css',
  'scss',
  'json',
  'yaml',
  'toml',
  'markdown',
  'bash',
  'shell',
  'sql',
  'graphql',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dart',
  'dockerfile',
  'lua',
  'zig',
]

const LIGHT_THEME = 'github-light'
const DARK_THEME = 'github-dark'
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  kt: 'kotlin',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  text: 'plaintext',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

let highlighterPromise: Promise<Highlighter> | null = null
let highlighterInstance: Highlighter | null = null

function normalizeLanguage(language: string | null | undefined): string {
  if (!language) {
    return 'plaintext'
  }
  const lower = language.toLowerCase()
  return LANGUAGE_ALIASES[lower] ?? lower
}

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [LIGHT_THEME, DARK_THEME],
      langs: POPULAR_LANGS,
    }).then((h) => {
      highlighterInstance = h
      return h
    })
  }
  return highlighterPromise!
}

// Lazy-load a language if not yet loaded
export async function ensureLanguage(lang: string): Promise<boolean> {
  const language = normalizeLanguage(lang)
  const h = highlighterInstance ?? await getHighlighter()
  const loaded = h.getLoadedLanguages()
  if (loaded.includes(language)) {
    return true
  }
  if (language in bundledLanguages) {
    await h.loadLanguage(language as keyof typeof bundledLanguages)
    return true
  }
  return false
}

/* ─── Decoration builder ─────────────────────────────────── */

const pluginKey = new PluginKey('shikiHighlight')

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function hasCodeBlock(doc: ProseMirrorNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (node.type.name === 'codeBlock') {
      found = true
      return false
    }
  })
  return found
}

function buildDecorations(doc: ProseMirrorNode, highlighter: Highlighter): DecorationSet {
  const decorations: Decoration[] = []
  const theme = isDark() ? DARK_THEME : LIGHT_THEME

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') {
      return
    }
    const language = normalizeLanguage(node.attrs.language as string | null)
    const code = node.textContent

    if (!code) {
      return
    }

    const loaded = highlighter.getLoadedLanguages()
    if (!loaded.includes(language) && language !== 'plaintext') {
      return
    }

    try {
      const { tokens } = highlighter.codeToTokens(code, { lang: language as BundledLanguage, theme })

      let lineOffset = pos + 1
      for (const line of tokens) {
        let charOffset = lineOffset
        for (const token of line) {
          const from = charOffset
          const to = from + token.content.length

          if (token.color) {
            decorations.push(
              Decoration.inline(from, to, {
                style: `color: ${token.color}`,
              }),
            )
          }
          charOffset = to
        }
        lineOffset = charOffset + 1
      }
    }
    catch {
      // Language might not be loaded or code might be malformed
    }
  })

  return DecorationSet.create(doc, decorations)
}

const LANG_CLASS_RE = /language-(\w+)/

/* ─── Extension ──────────────────────────────────────────── */

export const ShikiCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const classAttr = element.firstElementChild?.getAttribute('class') ?? ''
          const match = LANG_CLASS_RE.exec(classAttr)
          return match ? match[1] : null
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.language) {
            return {}
          }
          return { class: `language-${attributes.language}` }
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? []

    const shikiPlugin = new Plugin({
      key: pluginKey,
      state: {
        init: (_, { doc }) => {
          if (highlighterInstance) {
            return buildDecorations(doc, highlighterInstance)
          }
          return DecorationSet.empty
        },
        apply: (tr, oldState) => {
          if (tr.getMeta(pluginKey) === 'loaded' || tr.getMeta(pluginKey) === 'theme-changed') {
            if (highlighterInstance) {
              return buildDecorations(tr.doc, highlighterInstance)
            }
          }
          if (tr.docChanged && highlighterInstance) {
            return buildDecorations(tr.doc, highlighterInstance)
          }
          if (!tr.docChanged) {
            return oldState
          }
          return oldState.map(tr.mapping, tr.doc)
        },
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
      view(editorView) {
        let requested = false
        const requestHighlightLoad = () => {
          if (requested || highlighterInstance || !hasCodeBlock(editorView.state.doc)) {
            return
          }
          requested = true
          void getHighlighter().then(() => {
            const { state } = editorView
            const tr = state.tr.setMeta(pluginKey, 'loaded')
            editorView.dispatch(tr)
          })
        }

        requestHighlightLoad()

        return {
          update() {
            requestHighlightLoad()
          },
        }
      },
    })

    return [...parentPlugins, shikiPlugin]
  },
})
