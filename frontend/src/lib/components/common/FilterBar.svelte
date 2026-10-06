<script lang="ts">
  /**
   * FilterBar：关键字 + 多选条件过滤。
   * 筛选模型由页面双向绑定，页面负责同步到 URL query（见 $lib/utils/query.ts）。
   */
  import type { FilterModel, FilterSelectConfig } from '$lib/types/filter';

  let {
    filters,
    selects = [],
    keywordPlaceholder = '搜索关键字…',
    switchLabel = '',
    onchange,
    onreset
  }: {
    filters: FilterModel;
    selects?: FilterSelectConfig[];
    keywordPlaceholder?: string;
    switchLabel?: string;
    onchange: (next: FilterModel) => void;
    onreset?: () => void;
  } = $props();

  const activeCount = $derived(
    Object.entries(filters)
      .filter(([key]) => key !== 'keyword')
      .reduce((sum, [, value]) => {
        if (Array.isArray(value)) return sum + value.length;
        if (typeof value === 'string' && value.length > 0) return sum + 1;
        if (typeof value === 'boolean' && value) return sum + 1;
        return sum;
      }, 0)
  );

  function asArray(value: string | string[] | boolean | undefined): string[] {
    if (Array.isArray(value)) return value;
    return typeof value === 'string' && value.length > 0 ? [value] : [];
  }

  function patch(key: string, value: string | string[] | boolean): void {
    onchange({ ...filters, [key]: value });
  }

  function toggleMulti(key: string, option: string): void {
    const current = asArray(filters[key]);
    const next = current.includes(option) ? current.filter((item) => item !== option) : [...current, option];
    patch(key, next);
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4">
  <div class="flex flex-1 flex-wrap items-center gap-3">
    <input
      class="w-56 rounded-lg border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-walnut"
      placeholder={keywordPlaceholder}
      value={String(filters.keyword ?? '')}
      oninput={(event) => patch('keyword', (event.currentTarget as HTMLInputElement).value)}
    />

    {#each selects as select (select.key)}
      <div class="flex items-center gap-2">
        <span class="text-xs text-stone-500">{select.label}</span>
        <div class="flex flex-wrap gap-1">
          {#each select.options as option (option.value)}
            {@const active = asArray(filters[select.key]).includes(option.value)}
            <button
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-xs transition {active
                ? 'border-walnut bg-walnut text-white'
                : 'border-stone-300 bg-white text-stone-600 hover:border-walnut hover:text-walnut'}"
              onclick={() => toggleMulti(select.key, option.value)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    {#if switchLabel}
      <label class="flex items-center gap-2 text-xs text-stone-600">
        <input
          type="checkbox"
          class="h-4 w-4 accent-walnut"
          checked={Boolean(filters.switch)}
          onchange={(event) => patch('switch', (event.currentTarget as HTMLInputElement).checked)}
        />
        {switchLabel}
      </label>
    {/if}
  </div>

  <div class="flex items-center gap-2">
    {#if activeCount > 0}
      <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{activeCount} 项条件</span>
    {/if}
    {#if onreset}
      <button
        type="button"
        class="rounded-lg border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:border-walnut hover:text-walnut"
        onclick={onreset}
      >
        重置
      </button>
    {/if}
  </div>
</div>
