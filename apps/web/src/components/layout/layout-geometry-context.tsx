// Input: React context, ResizeObserver
// Output: Layout geometry contract exposing measured center-column and footer bounds
// Position: Layout-owned explicit geometry boundary consumed by overlay features such as Jarvis

import * as React from 'react'

type LayoutRect = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

interface LayoutGeometryContextValue {
  centerColumnRect: LayoutRect | null
  footerRect: LayoutRect | null
  registerCenterColumn: (node: HTMLDivElement | null) => void
  registerFooter: (node: HTMLElement | null) => void
}

const LayoutGeometryContext = React.createContext<LayoutGeometryContextValue | null>(null)

function toLayoutRect(element: Element | null): LayoutRect | null {
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

export function LayoutGeometryProvider({ children }: { children: React.ReactNode }) {
  const [centerColumnElement, setCenterColumnElement] = React.useState<HTMLDivElement | null>(null)
  const [footerElement, setFooterElement] = React.useState<HTMLElement | null>(null)
  const [centerColumnRect, setCenterColumnRect] = React.useState<LayoutRect | null>(null)
  const [footerRect, setFooterRect] = React.useState<LayoutRect | null>(null)

  const measure = React.useCallback(() => {
    setCenterColumnRect(toLayoutRect(centerColumnElement))
    setFooterRect(toLayoutRect(footerElement))
  }, [centerColumnElement, footerElement])

  React.useEffect(() => {
    measure()

    const observer = new ResizeObserver(() => measure())
    if (centerColumnElement) {
      observer.observe(centerColumnElement)
    }
    if (footerElement) {
      observer.observe(footerElement)
    }

    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [centerColumnElement, footerElement, measure])

  const value = React.useMemo<LayoutGeometryContextValue>(() => ({
    centerColumnRect,
    footerRect,
    registerCenterColumn: setCenterColumnElement,
    registerFooter: setFooterElement,
  }), [centerColumnRect, footerRect])

  return (
    <LayoutGeometryContext.Provider value={value}>
      {children}
    </LayoutGeometryContext.Provider>
  )
}

export function useLayoutGeometry(): LayoutGeometryContextValue {
  const value = React.useContext(LayoutGeometryContext)
  if (!value) {
    throw new Error('useLayoutGeometry must be used within LayoutGeometryProvider')
  }
  return value
}