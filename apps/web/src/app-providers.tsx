import { domAnimation, LazyMotion } from 'motion/react'
import { useEffect } from 'react'

import { ToastProvider } from '~/components/ui/toast'
import { TooltipProvider } from '~/components/ui/tooltip'
import { DirectoryPickerProvider } from '~/features/filesystem/directory-picker-provider'
import { ShortcutProvider } from '~/lib/shortcut-provider'
import { useResolvedThemeMode } from '~/store/theme'

export function AppEnvironmentProviders({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation}>
      <ToastProvider>
        <TooltipProvider>
          <ShortcutProvider>
            <DirectoryPickerProvider>{children}</DirectoryPickerProvider>
          </ShortcutProvider>
        </TooltipProvider>
      </ToastProvider>
    </LazyMotion>
  )
}

export function useThemeClass(): void {
  const resolvedMode = useResolvedThemeMode()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedMode === 'dark')
  }, [resolvedMode])
}
