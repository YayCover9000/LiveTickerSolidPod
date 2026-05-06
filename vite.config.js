import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@inrupt/solid-client-authn-browser', '@inrupt/solid-client'],
  },
  server: {
    proxy: {
      '/events': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
