import {
  defaultMarkdownUrlTransform,
  MarkdownLink,
  StaticRender,
  type MarkdownComponents,
  type MarkdownUrlTransform,
} from '@cradle/streamdown'

import { cn } from '~/lib/cn'

import { isCradleAssetUrl, readAssetIdFromUrl, toAssetContentUrl } from './asset-url'

interface AssetMarkdownProps {
  content: string
  className?: string
  as?: 'div' | 'span'
}

interface AssetMarkdownImage {
  filename: string
  markdownUrl: string
}

const assetUrlTransform: MarkdownUrlTransform = (value) => {
  if (isCradleAssetUrl(value)) {
    return value
  }
  return defaultMarkdownUrlTransform(value)
}

const components: MarkdownComponents = {
  img({ src, alt, className, node, ref, ...props }) {
    const assetContentUrl = resolveAssetContentUrl(src)
    return (
      <img
        {...props}
        src={assetContentUrl ?? src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        data-cradle-asset-src={assetContentUrl ? src : undefined}
        className={cn(
          'my-2 max-h-[420px] max-w-full rounded-md border border-border object-contain',
          className,
        )}
      />
    )
  },
  a({ href, children, node, ref, ...props }) {
    const assetContentUrl = resolveAssetContentUrl(href)
    return (
      <MarkdownLink
        {...props}
        href={assetContentUrl ?? href}
        data-cradle-asset-href={assetContentUrl ? href : undefined}
      >
        {children}
      </MarkdownLink>
    )
  },
}

function resolveAssetContentUrl(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  const assetId = readAssetIdFromUrl(value)
  return assetId ? toAssetContentUrl(assetId) : null
}

function escapeImageAlt(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/]/g, '\\]')
}

export function toAssetImageMarkdown(asset: AssetMarkdownImage): string {
  return `![${escapeImageAlt(asset.filename)}](${asset.markdownUrl})`
}

export function AssetMarkdown({ content, className, as }: AssetMarkdownProps) {
  return (
    <StaticRender
      content={content}
      className={className}
      components={components}
      urlTransform={assetUrlTransform}
      as={as}
    />
  )
}
