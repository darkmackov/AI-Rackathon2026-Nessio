import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// /api/* is proxied to FastAPI (local uvicorn or the IRIS container on :8000).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // jsdom workers starve each other on many-core machines and tests time out; half the cores is faster overall.
    maxWorkers: '50%',
    setupFiles: ['./src/test/setup.ts'],
    environmentOptions: { jsdom: { url: 'http://localhost:5173' } },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
