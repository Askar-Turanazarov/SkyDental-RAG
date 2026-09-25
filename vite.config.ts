import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url))

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Две страницы: лендинг и админка. У админки свой бандл —
    // лендинг её код не загружает.
    rollupOptions: { input: { main: page('index.html'), admin: page('admin.html') } },
  },
  // Локально API живёт на отдельном Node-сервере (npm run dev:api),
  // на Vercel — в той же выдаче. Прокси делает адрес одинаковым: /api.
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
})
