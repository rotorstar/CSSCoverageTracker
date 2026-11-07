import { defineConfig, type UserConfig } from 'tsdown'
import pkg from './package.json' with { type: 'json' }

const define = { __CSS_COVERAGE_VERSION__: JSON.stringify(pkg.version) }
const browserExternal = ['react', 'react-dom', 'react/jsx-runtime']

const config: UserConfig[] = defineConfig([
  {
    // npm package, browser side (code-split: UI and report are lazy chunks)
    entry: { index: 'src/index.ts', react: 'src/react/index.ts', auto: 'src/auto/index.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    dts: true,
    sourcemap: true,
    clean: true,
    external: browserExternal,
    define,
  },
  {
    // single-file artifacts: <script> tag / bookmarklet / copy-paste, and one-file ESM
    entry: { 'css-coverage-tracker.iife': 'src/auto/index.ts' },
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    clean: false,
    define,
    outputOptions: { inlineDynamicImports: true, entryFileNames: '[name].js' },
  },
  {
    entry: { 'css-coverage-tracker.standalone': 'src/standalone.ts' },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    clean: false,
    define,
    outputOptions: { inlineDynamicImports: true, entryFileNames: '[name].js' },
  },
  {
    // Node: Playwright fixture and CLI
    entry: {
      playwright: 'src/playwright/index.ts',
      cli: 'src/cli/index.ts',
      schema: 'src/schema/report.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: { entry: ['src/playwright/index.ts'] },
    clean: false,
    external: ['@playwright/test', 'zod'],
    define,
  },
])

export default config
