import './global.css'

import { RootProvider } from 'fumadocs-ui/provider/next'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'

import { appName } from '@/lib/shared'

const inter = Inter({
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: 'Cradle product and developer documentation.',
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
