<script lang="ts">
  /** EmptyPanel：空数据引导与新建入口，被全部列表页消费 */
  let {
    title = '暂无数据',
    description = '先新建一条记录，或调整筛选条件后再试。',
    showCreate = true,
    createText = '新建',
    oncreate,
    children
  }: {
    title?: string;
    description?: string;
    showCreate?: boolean;
    createText?: string;
    oncreate?: () => void;
    children?: import('svelte').Snippet;
  } = $props();
</script>

<div class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 bg-white/70 px-4 py-10 text-center">
  <div class="text-3xl" aria-hidden="true">🎹</div>
  <h3 class="text-base font-semibold text-stone-800">{title}</h3>
  <p class="text-xs text-stone-500">{description}</p>
  {#if showCreate && oncreate}
    <button
      type="button"
      class="mt-1 rounded-lg bg-walnut px-4 py-1.5 text-sm text-white transition hover:bg-stone-800"
      onclick={oncreate}
    >
      + {createText}
    </button>
  {/if}
  {@render children?.()}
</div>
