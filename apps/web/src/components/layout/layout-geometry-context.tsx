import * as React from 'react'

interface LayoutGeometryContextValue {
  getCenterColumnElement: () => HTMLDivElement | null
  getFooterElement: () => HTMLElement | null
  registerCenterColumn: (node: HTMLDivElement | null) => void
  registerFooter: (node: HTMLElement | null) => void
}

const LayoutGeometryContext = React.createContext<LayoutGeometryContextValue | null>(null)

export function LayoutGeometryProvider({ children }: { children: React.ReactNode }) {
  const centerColumnElementRef = React.useRef<HTMLDivElement | null>(null)
  const footerElementRef = React.useRef<HTMLElement | null>(null)

  const registerCenterColumn = React.useCallback((node: HTMLDivElement | null) => {
    centerColumnElementRef.current = node
  }, [])

  const registerFooter = React.useCallback((node: HTMLElement | null) => {
    footerElementRef.current = node
  }, [])

  const getCenterColumnElement = React.useCallback(() => centerColumnElementRef.current, [])
  const getFooterElement = React.useCallback(() => footerElementRef.current, [])

  const value = React.useMemo<LayoutGeometryContextValue>(
    () => ({
      getCenterColumnElement,
      getFooterElement,
      registerCenterColumn,
      registerFooter,
    }),
    [getCenterColumnElement, getFooterElement, registerCenterColumn, registerFooter],
  )

  return <LayoutGeometryContext.Provider value={value}>{children}</LayoutGeometryContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLayoutGeometry(): LayoutGeometryContextValue {
  const value = React.useContext(LayoutGeometryContext)
  if (!value) {
    throw new Error('useLayoutGeometry must be used within LayoutGeometryProvider')
  }
  return value
}
