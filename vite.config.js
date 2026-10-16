import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Local dev: /api/* is served by server/index.js (see Makefile `make dev`).
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 8080}`,
    },
  },
})
