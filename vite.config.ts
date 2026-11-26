import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The public Stan compilation server only accepts browser requests from a fixed list of
// origins. For local work those are http://127.0.0.1:3000 (dev) and http://127.0.0.1:4173
// (preview), so both servers are pinned to them.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
})
