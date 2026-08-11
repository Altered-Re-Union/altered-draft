import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Unit tests only: pure logic, no DB/Docker. Integration tests (api/rooms/* against a
// real Postgres) live under tests/integration and run via `npm run test:integration`
// with vitest.integration.config.js instead — see docker-compose.test.yml.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'api/**/*.test.js'],
    exclude: ['tests/integration/**'],
  },
})
