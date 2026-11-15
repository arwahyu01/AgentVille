import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// `/api` is proxied to the backend. When port 8000 is taken by another project, start the backend
// elsewhere and point the proxy at it:  AGENTVILLE_API=http://127.0.0.1:8001 npm run dev
export default defineConfig(({ mode }) => {
  const apiTarget = loadEnv(mode, '.', '').AGENTVILLE_API || 'http://127.0.0.1:8000'
  return {
    plugins: [react()],
    // Exposed on the LAN so phones/tablets can open the UI. API calls are proxied under the same
    // origin, which keeps the backend bound to loopback and avoids CORS changes.
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
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
  }
})
