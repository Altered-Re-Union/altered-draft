import { defineConfig } from 'vitest/config'

// Integration tests: api/rooms/*.js against a REAL Postgres (see docker-compose.test.yml).
// Separate from vitest.config.js's unit suite so plain `npm test` never needs Docker.
// Run with `npm run test:integration` (handles the container lifecycle via globalSetup).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.js'],
    globalSetup: ['tests/integration/globalSetup.js'],
    fileParallelism: false, // all files share one Postgres container/table
  },
})
