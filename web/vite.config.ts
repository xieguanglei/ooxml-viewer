import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  server: {
    open: true,
    port: 5173,
  },
});
