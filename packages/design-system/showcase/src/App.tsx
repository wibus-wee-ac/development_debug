import { useTheme } from './theme'
import { useLang, t } from './i18n'
import Hero from './sections/Hero'
import OutputSamples from './sections/OutputSamples'
import Manifesto from './sections/Manifesto'
import Color from './sections/Color'
import Typography from './sections/Typography'
import Spacing from './sections/Spacing'
import Components from './sections/Components'
import Snippets from './sections/Snippets'
import AntiPatterns from './sections/AntiPatterns'
import Decision from './sections/Decision'
import Background from './sections/Background'
import Footer from './sections/Footer'

export default function App() {
  const { theme, toggle } = useTheme()
  const { lang, setLang } = useLang()

  return (
    <>
      <div className="toolbar">
        <button onClick={toggle} data-active={theme === 'dark' ? 'true' : undefined}>
          {theme === 'light' ? 'light' : 'dark'}
        </button>
        <div className="sep" />
        <button onClick={() => setLang(lang === 'en' ? 'zh' : 'en')} data-active={undefined}>
          {lang}
        </button>
      </div>

      <div className="page">
        <Hero lang={lang} />
        <OutputSamples lang={lang} />
        <Manifesto lang={lang} />
        <Color lang={lang} />
        <Typography lang={lang} />
        <Spacing lang={lang} />
        <Components lang={lang} />
        <Snippets lang={lang} />
        <AntiPatterns lang={lang} />
        <Decision lang={lang} />
        <Background lang={lang} />
        <Footer />
      </div>
    </>
  )
}
