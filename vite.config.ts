import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
/** GitHub Pages project URL is /<repo-name>/ — keep this in sync with the GitHub repo (currently spending-tracker). */
const BASE = '/spending-tracker/'

/** Root-absolute favicon URLs so Safari/bookmarks work even when the page URL has no trailing slash. */
function injectBaseInIndexHtml(): Plugin {
  return {
    name: 'inject-base-index-html',
    transformIndexHtml(html) {
      return html.replace(/__BASE__/g, BASE)
    },
  }
}

export default defineConfig({
  base: BASE,
  server: {
    open: BASE,
  },
  plugins: [react(), injectBaseInIndexHtml()],
})
