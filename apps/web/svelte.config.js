import adapter from '@sveltejs/adapter-static'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Decent's UI is a static SPA served alongside the local daemon — no SSR.
    adapter: adapter({ fallback: 'index.html' }),
  },
}

export default config
