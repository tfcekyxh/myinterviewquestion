import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 本地开发时 API 走 Express
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // 由 Express 托管，输出到 web/dist
    outDir: 'dist',
    emptyOutDir: true,
  },
})
