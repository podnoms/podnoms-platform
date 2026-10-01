import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts, whose Start/Nitro plugins build the app and
// aren't wanted in tests. DOM tests opt in with `// @vitest-environment happy-dom`.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Database tests start an in-process Postgres and run the migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
