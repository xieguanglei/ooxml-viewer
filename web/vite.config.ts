import { defineConfig } from 'vite';

const repoName = 'ooxml-viewer';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? `/${repoName}/` : '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    open: true,
    port: 5173,
  },
}));
