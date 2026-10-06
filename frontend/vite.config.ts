import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'node:url';

// 纯前端 SPA：产物交给 nginx:alpine 托管，开发端口与宿主映射端口保持一致（22830）
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    port: 22830,
    strictPort: false
  },
  preview: {
    host: true,
    port: 22830
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  }
});
