import { defineConfig } from '@hey-api/openapi-ts'

// Typed client generated from the FastAPI spec. Regenerate after API changes:
//   uv run python scripts/export_openapi.py && npm --prefix apps/web run gen:api
export default defineConfig({
  input: './openapi.json',
  output: 'src/client',
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', '@hey-api/sdk'],
})
