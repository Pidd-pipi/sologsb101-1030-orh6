<script lang="ts">
  /**
   * 未匹配路径兜底页：保留当前地址不变，给出友好提示与五个模块入口
   * （history 模式下未知路径同样由 nginx / vite 回退 index.html，不会白屏）
   */
  import { NAV_ITEMS, router } from '$lib/router';
</script>

<div class="mx-auto max-w-2xl rounded-xl border border-dashed border-stone-300 bg-white p-10 text-center">
  <div class="text-3xl" aria-hidden="true">🧭</div>
  <h2 class="mt-3 text-lg font-semibold text-stone-700">未找到该页面</h2>
  <p class="mt-2 text-sm text-stone-500">
    当前地址 <code class="rounded bg-stone-100 px-1.5 py-0.5">{router.location}</code>
    不在本应用的 5 个模块（/pianos、/tunings、/voicings、/environments、/reminders）之内。
  </p>
  <div class="mt-5 flex flex-wrap justify-center gap-2">
    {#each NAV_ITEMS as item (item.path)}
      <a class="btn" href={item.path}>{item.icon} {item.label}</a>
    {/each}
  </div>
</div>
