// Input: @tiptap/core Heading extension
// Output: HeadingId extension — adds slugified IDs to heading elements
// Position: Tiptap extension for anchor-linkable headings

import Heading from '@tiptap/extension-heading'

const SLUG_NON_WORD_RE = /[^\w\u4E00-\u9FFF]+/g
const SLUG_TRIM_DASH_RE = /(^-|-$)/g

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_NON_WORD_RE, '-')
    .replace(SLUG_TRIM_DASH_RE, '')
}

export const HeadingWithId = Heading.extend({
  renderHTML({ node, HTMLAttributes }) {
    const level = node.attrs.level as number
    const text = node.textContent
    const id = slugify(text)

    return [
      `h${level}`,
      { ...HTMLAttributes, id },
      0,
    ]
  },
})
