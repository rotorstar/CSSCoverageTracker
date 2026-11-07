import { playwright } from '@vitest/browser-playwright'
import { defineConfig, type ViteUserConfig } from 'vitest/config'
import pkg from './package.json' with { type: 'json' }

const config: ViteUserConfig = defineConfig({
  define: { __CSS_COVERAGE_VERSION__: JSON.stringify(pkg.version) },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          // performance acceptance (plan AC-B): run with `npm run bench` on a quiet machine
          name: 'bench',
          include: ['test/bench/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/browser/**/*.test.{ts,tsx}'],
          globalSetup: ['test/browser/global-setup.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }],
          },
        },
      },
    ],
  },
})

export default config
