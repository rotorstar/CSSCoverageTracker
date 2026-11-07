import { defineConfig, type ViteUserConfig } from 'vitest/config'

/** Unit tests only — used by Stryker for mutation testing of core/selector. */
const config: ViteUserConfig = defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    env: { PROPERTY_RUNS: '300' },
    testTimeout: 30_000,
  },
})

export default config
