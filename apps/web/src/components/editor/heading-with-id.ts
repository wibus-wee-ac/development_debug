// Input: @tiptap/core Heading extension
// Output: HeadingId extension — adds slugified IDs to heading elements
// Position: Tiptap extension for anchor-linkable headings

import Heading from '@tiptap/extension-heading'

const RE_NON_WORD = /[^\w\u4E00-\u9FFF]+/g
const RE_BOUNDARY_DASH = /(^-|-$)/g

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(RE_NON_WORD, '-')
    .replace(RE_BOUNDARY_DASH, '')
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
