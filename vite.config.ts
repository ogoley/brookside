import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        // Separate HTML entry so /derby gets its own <title>/og tags in link
        // previews (crawlers don't run JS); served via firebase.json rewrite
        derby: 'derby.html',
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://us-central1-brookside-14b4b.cloudfunctions.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        timeout: 120000,
        proxyTimeout: 120000,
      },
    },
  },
})
