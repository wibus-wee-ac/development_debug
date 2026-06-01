export function Footer() {
  return (
    <footer className="py-20 border-t border-[rgba(255,255,255,0.06)]">
      <div className="max-w-[960px] mx-auto px-6 text-center">
        <h2 className="text-xl font-semibold text-[#f5f5f5]">Ready?</h2>
        <a
          href="#get-started"
          className="text-sm text-[#a3a3a3] hover:text-[#f5f5f5] mt-3 inline-block transition-colors"
        >
          Get started →
        </a>
        <div className="mt-10 flex gap-6 justify-center">
          <a
            href="https://github.com"
            className="text-[11px] text-[#525252] hover:text-[#8a8a8a] transition-colors"
          >
            GitHub
          </a>
          <a
            href="#docs"
            className="text-[11px] text-[#525252] hover:text-[#8a8a8a] transition-colors"
          >
            Docs
          </a>
          <a
            href="#discord"
            className="text-[11px] text-[#525252] hover:text-[#8a8a8a] transition-colors"
          >
            Discord
          </a>
        </div>
        <p className="text-[11px] text-[#525252] mt-6">© 2026 Cradle</p>
      </div>
    </footer>
  )
}
