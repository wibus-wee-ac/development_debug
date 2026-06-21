import { mergeAttributes } from '@tiptap/core'
import Image from '@tiptap/extension-image'

import { readAssetIdFromUrl, toAssetContentUrl } from '~/features/assets/asset-url'

export const AssetImage = Image.extend({
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-cradle-asset-src') ?? element.getAttribute('src'),
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const canonicalSrc = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : null
    const assetId = canonicalSrc ? readAssetIdFromUrl(canonicalSrc) : null

    if (!assetId || !canonicalSrc) {
      return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
    }

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: toAssetContentUrl(assetId),
        'data-cradle-asset-src': canonicalSrc,
      }),
    ]
  },
})
