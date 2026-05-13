import { createContext, useCallback, useContext, useRef, useState } from 'react'

import { DirectoryBrowserDialog } from '~/features/filesystem/directory-browser-dialog'

interface DirectoryPickerContextValue {
  selectDirectory: (options?: { title?: string, description?: string }) => Promise<string | null>
}

const DirectoryPickerContext = createContext<DirectoryPickerContextValue | null>(null)

export function useDirectoryPicker() {
  const ctx = useContext(DirectoryPickerContext)
  if (!ctx) {
    throw new Error('useDirectoryPicker must be used within DirectoryPickerProvider')
  }
  return ctx
}

export function DirectoryPickerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [dialogProps, setDialogProps] = useState<{ title?: string, description?: string }>({})
  const resolverRef = useRef<((value: string | null) => void) | null>(null)

  const selectDirectory = useCallback((options?: { title?: string, description?: string }) => {
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve
      setDialogProps(options ?? {})
      setOpen(true)
    })
  }, [])

  const handleSelect = useCallback((path: string) => {
    resolverRef.current?.(path)
    resolverRef.current = null
  }, [])

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      resolverRef.current?.(null)
      resolverRef.current = null
    }
  }, [])

  return (
    <DirectoryPickerContext value={{ selectDirectory }}>
      {children}
      <DirectoryBrowserDialog
        open={open}
        onOpenChange={handleOpenChange}
        onSelect={handleSelect}
        {...dialogProps}
      />
    </DirectoryPickerContext>
  )
}
