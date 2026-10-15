import { defineConfig } from 'vite';

// The compiled site goes to docs/ so GitHub Pages can serve it straight from
// the repository. Relative asset paths make it work under any URL prefix
// (e.g. https://<user>.github.io/looper/ or a custom domain).
export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
});
