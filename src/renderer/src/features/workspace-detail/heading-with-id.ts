// Input: @tiptap/core Heading extension
// Output: HeadingId extension — adds slugified IDs to heading elements
// Position: Tiptap extension for anchor-linkable headings

import Heading from '@tiptap/extension-heading'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/(^-|-$)/g, '')
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
