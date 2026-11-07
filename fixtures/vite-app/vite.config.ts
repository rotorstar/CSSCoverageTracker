import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['..', '../..'] } },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        bootstrap: 'bootstrap.html',
        bootstrapPurged: 'bootstrap-purged.html',
        lit: 'lit.html',
        csp: 'csp.html',
      },
    },
  },
})
