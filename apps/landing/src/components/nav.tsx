import { useEffect, useState } from 'react'

export function Nav() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center transition-all duration-200"
      style={{
        background: scrolled ? 'rgba(20,20,20,0.8)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent',
      }}
    >
      <div className="max-w-[960px] mx-auto px-6 w-full flex items-center justify-between">
        <span className="text-sm font-medium text-[#f5f5f5]">Cradle</span>
        <a
          href="#get-started"
          className="text-sm text-[#8a8a8a] hover:text-[#f5f5f5] transition-colors"
        >
          Get Started →
        </a>
      </div>
    </nav>
  )
}
