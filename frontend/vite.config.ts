import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Exposed on the LAN so phones/tablets can open the UI. API calls are proxied under the same
  // origin, which keeps the backend bound to loopback and avoids CORS changes.
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            // Node holds response headers until the first body byte. The SSE stream can stay
            // quiet for a minute, which would delay EventSource's `open`; flush early.
            if (!res.headersSent && String(proxyRes.headers['content-type']).includes('text/event-stream')) {
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
              res.flushHeaders()
            }
          })
        },
      },
    },
    // `allow: ['..']` so the layout test can import backend/app/rooms.py?raw and pin the room
    // contract to the backend module instead of duplicating it.
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
