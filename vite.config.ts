import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
  // Локально API живёт на отдельном Node-сервере (npm run dev:api),
  // на Vercel — в той же выдаче. Прокси делает адрес одинаковым: /api.
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
})
