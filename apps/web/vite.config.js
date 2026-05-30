import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    // During dev, proxy /api to the local decentd so the SPA and daemon share
    // an origin and we avoid CORS fiddling.
    proxy: {
      '/api': `http://127.0.0.1:${process.env.DECENT_PORT || 8008}`,
    },
  },
})
