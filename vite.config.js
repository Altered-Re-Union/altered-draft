import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Fail loudly when 5173 is taken (e.g. a forgotten `make dev` in another terminal)
    // instead of silently moving to 5174: the browser would keep talking to the old
    // server, and the dev Keycloak client only allows http://localhost:5173/*.
    port: 5173,
    strictPort: true,
    // Local dev: /api/* is served by server/index.js (see Makefile `make dev`).
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 8080}`,
    },
  },
})
