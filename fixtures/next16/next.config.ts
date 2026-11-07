import { join } from 'node:path'
import type { NextConfig } from 'next'

// the package is linked from the repository root (file:../..), so the root must include it
const config: NextConfig = { turbopack: { root: join(import.meta.dirname, '../..') } }

export default config
