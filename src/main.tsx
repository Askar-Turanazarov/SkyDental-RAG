// Стили подключаются ДО компонентов: иначе CSS компонентов (girih, chat)
// попадёт в бандл раньше токенов. Порядок: токены → база → стекло → секции.
import './styles/tokens.css'
import './styles/base.css'
import './styles/glass.css'
import './styles/sections.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LocaleProvider } from './i18n/LocaleContext'
import { ThemeProvider } from './theme/ThemeContext'
import { App } from './App'


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
)
