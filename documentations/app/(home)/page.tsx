import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
      <div className="max-w-3xl">
        <p className="mb-4 text-sm font-medium text-fd-muted-foreground">Cradle documentation</p>
        <h1 className="mb-6 text-4xl font-semibold text-fd-foreground sm:text-5xl">
          Local-first agent workspace documentation
        </h1>
        <p className="mb-8 text-lg leading-8 text-fd-muted-foreground">
          Read Cradle by task path, from the desktop app and local workspaces to Chat runtime,
          Issue agents, automation, Chronicle, plugins, and developer interfaces.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/docs"
            className="inline-flex h-10 items-center justify-center rounded-md bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Open docs
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
  );
}
