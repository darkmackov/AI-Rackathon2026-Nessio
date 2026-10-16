const mode = import.meta.env.VITE_API_MODE ?? 'mock'

if (mode !== 'mock' && mode !== 'real') {
  throw new Error('VITE_API_MODE must be mock or real')
}

export const apiMode = mode
