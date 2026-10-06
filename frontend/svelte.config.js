import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Svelte 5 配置：启用 TypeScript 预处理 */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    runes: true
  }
};
