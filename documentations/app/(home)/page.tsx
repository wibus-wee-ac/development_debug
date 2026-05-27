import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Cradle Docs',
  description: 'Learn how to set up Cradle, configure agents, and extend the local workspace runtime.',
}

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
      <div className="max-w-3xl">
        <p className="mb-4 text-sm font-medium text-fd-muted-foreground">Cradle docs</p>
        <h1 className="mb-6 text-4xl font-semibold text-fd-foreground sm:text-5xl">
          Work with agents inside your local workspace
        </h1>
        <p className="mb-8 text-lg leading-8 text-fd-muted-foreground">
          Start with the desktop app, add a workspace, configure providers, then use Chat, Issue
          agents, automation, Chronicle, plugins, and Devtools from one product surface.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/plugin-marketplace"
            className="inline-flex h-10 items-center justify-center rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Plugin Marketplace
          </Link>
          <Link
            href="/docs"
            className="inline-flex h-10 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Open Cradle docs
          </Link>
          <Link
            href="https://github.com/wibus-wee/Cradle"
            className="inline-flex h-10 items-center justify-center rounded-md border border-fd-border px-4 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            GitHub
          </Link>
        </div>
      </div>
    </div>
  )
}
