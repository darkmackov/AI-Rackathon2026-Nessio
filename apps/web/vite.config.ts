import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// /api/* is proxied to FastAPI (local uvicorn or the IRIS container on :8000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})
