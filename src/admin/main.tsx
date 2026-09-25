// Порядок стилей тот же, что у лендинга: токены → база → стекло.
import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/glass.css'
// Стили трассы поиска: админка показывает её тем же компонентом, что и чат.
import '../components/chat/chat.css'
import './admin.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '../theme/ThemeContext'
import { AdminApp } from './AdminApp'

// Админка только на русском: LocaleProvider лендинга здесь не нужен.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminApp />
    </ThemeProvider>
  </StrictMode>,
)
