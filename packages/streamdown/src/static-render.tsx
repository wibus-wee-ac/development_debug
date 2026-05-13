import type { PluggableList } from 'unified'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { HighlightedCode, HighlightedPre } from './components/highlighted-code'

interface StaticRenderProps {
  content: string
  className?: string
  /** Custom ReactMarkdown components map */
  components?: Record<string, React.ComponentType<unknown>>
  /** Additional rehype plugins */
  rehypePlugins?: PluggableList
  /** Additional remark plugins */
  remarkPlugins?: PluggableList
}

const defaultComponents = {
  code: HighlightedCode,
  pre: HighlightedPre,
}

export function StaticRender({ content, className, components, rehypePlugins, remarkPlugins }: StaticRenderProps) {
  const merged = components
    ? { ...defaultComponents, ...components }
    : defaultComponents

  return (
    <div className={className} data-pre-mounted="">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, ...(remarkPlugins || [])]}
        rehypePlugins={[rehypeKatex, ...(rehypePlugins || [])]}
        components={merged as Record<string, React.ComponentType<never>>}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
