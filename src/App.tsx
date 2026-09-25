import { useT } from './i18n/LocaleContext'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Services } from './components/Services'
import { About } from './components/About'
import { Faq } from './components/Faq'
import { Contacts } from './components/Contacts'
import { Footer } from './components/Footer'
import { ChatWidget } from './components/chat/ChatWidget'
import { GirihPattern } from './graphics/GirihPattern'

export function App() {
  const t = useT()

  return (
    <>
      <a className="skip-link" href="#main">
        {t.nav.skipToContent}
      </a>
      {/* Фон во всю высоту страницы: ярко под героем, фактурой ниже. */}
      <GirihPattern />
      <Header />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Services />
        <About />
        <Faq />
        <Contacts />
      </main>
      <Footer />
      <ChatWidget />
    </>
  )
}
