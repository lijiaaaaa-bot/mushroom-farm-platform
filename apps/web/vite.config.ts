import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // The contracts package is CommonJS. Prebundle it so browser named imports resolve.
  optimizeDeps: {
    include: ['@mushroom/contracts'],
  },
  server: {
    host: '0.0.0.0',
    port: 43123,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:41821',
        changeOrigin: true,
      },
    },
  },
});
