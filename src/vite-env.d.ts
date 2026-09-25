/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL бэкенда RAG-бота. Пусто — виджет работает на мок-ответах. */
  readonly VITE_RAG_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
