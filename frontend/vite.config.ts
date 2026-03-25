import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward all /api requests to the Go backend during dev
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // SSE needs these so the connection isn't buffered
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Cache-Control', 'no-cache');
          });
        },
      },
    },
  },
})
