<script lang="ts">
  /** 应用外壳：左侧导航 + 顶部概览 + 路由出口 */
  import { onMount } from 'svelte';
  import { activeNav, NAV_ITEMS, router } from '$lib/router';
  import RouteView from '$lib/router/RouteView.svelte';
  import { countAll, initDatabase, DB_NAME, DB_SCHEMA_VERSION } from '$lib/utils/db';

  let counts = $state<Record<string, number>>({});
  let dbReady = $state(false);
  let dbError = $state<string | null>(null);

  const activePath = $derived(activeNav(router.location));
  const currentTitle = $derived(
    NAV_ITEMS.find((item) => item.path === activePath)?.label ?? '钢琴调律与琴房环境档案'
  );

  async function refreshCounts(): Promise<void> {
    counts = await countAll();
  }

  onMount(() => {
    void (async () => {
      try {
        await initDatabase();
        dbReady = true;
        await refreshCounts();
      } catch (error) {
        dbError = error instanceof Error ? error.message : '本地数据库初始化失败';
      }
    })();
  });

  // 路径变化时刷新侧栏统计；未知路径由路由表 '*' 渲染兜底页，不做重定向，保留原地址便于用户改回
  $effect(() => {
    void router.location;
    void refreshCounts();
  });
</script>

<div class="flex min-h-screen bg-ivory text-stone-800">
  <aside class="flex w-56 flex-col bg-ebony text-stone-100">
    <div class="flex items-center gap-2.5 px-4 pb-3 pt-5">
      <span class="text-2xl" aria-hidden="true">🎹</span>
      <div>
        <div class="text-sm font-bold">钢琴调律与琴房环境</div>
        <div class="text-[11px] text-stone-400">gbpianotune · 琴房档案</div>
      </div>
    </div>

    <nav class="flex-1 px-2 py-2">
      {#each NAV_ITEMS as item (item.path)}
        <a
          href={item.path}
          aria-current={activePath === item.path ? 'page' : undefined}
          class="mb-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition {activePath === item.path
            ? 'bg-brass/25 text-white'
            : 'text-stone-300 hover:bg-white/10 hover:text-white'}"
        >
          <span aria-hidden="true">{item.icon}</span>
          <span class="flex-1">{item.label}</span>
          <span class="text-[10px] text-stone-500">{item.hint}</span>
        </a>
      {/each}
    </nav>

    <div class="px-4 pb-5 text-[11px] leading-relaxed text-stone-400">
      <div>本地库 {DB_NAME} · v{DB_SCHEMA_VERSION}</div>
      <div>钢琴 {counts.pianos ?? 0} · 调律 {counts.tunings ?? 0} · 维修 {counts.voicings ?? 0}</div>
      <div>环境 {counts.environments ?? 0} · 提醒 {counts.reminders ?? 0}</div>
      <div class="mt-1 text-stone-500">{dbReady ? '本地库已就绪' : '正在打开本地库…'}</div>
    </div>
  </aside>

  <div class="flex flex-1 flex-col">
    <header class="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
      <h1 class="text-base font-semibold">{currentTitle}</h1>
      <div class="text-xs text-stone-500">
        数据仅保存在本机浏览器（IndexedDB / Dexie），无后端服务
      </div>
    </header>

    {#if dbError}
      <div class="mx-6 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
        本地数据库初始化失败：{dbError}
      </div>
    {/if}

    <main class="flex-1 px-6 py-5">
      <RouteView />
    </main>

    <footer class="border-t border-stone-200 px-6 py-3 text-center text-xs text-stone-400">
      钢琴调律与琴房环境档案 · 全部数据保存在浏览器本地 IndexedDB（{DB_NAME}）
    </footer>
  </div>
</div>
