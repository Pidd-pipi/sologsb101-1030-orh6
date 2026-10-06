<script lang="ts">
  /** StatBadge：调律次数、平均偏差、超标天数等计数徽标 */
  let {
    label,
    value,
    suffix = '',
    percent,
    tone = 'walnut',
    icon = '♪',
    showPercent = false
  }: {
    label: string;
    value: number | string;
    suffix?: string;
    percent?: number;
    tone?: 'walnut' | 'brass' | 'green' | 'amber' | 'rose' | 'slate';
    icon?: string;
    showPercent?: boolean;
  } = $props();

  const toneMap: Record<string, { border: string; text: string; bar: string }> = {
    walnut: { border: 'border-l-walnut', text: 'text-walnut', bar: 'bg-walnut' },
    brass: { border: 'border-l-brass', text: 'text-amber-700', bar: 'bg-brass' },
    green: { border: 'border-l-emerald-600', text: 'text-emerald-700', bar: 'bg-emerald-600' },
    amber: { border: 'border-l-amber-500', text: 'text-amber-700', bar: 'bg-amber-500' },
    rose: { border: 'border-l-rose-600', text: 'text-rose-700', bar: 'bg-rose-600' },
    slate: { border: 'border-l-slate-500', text: 'text-slate-600', bar: 'bg-slate-500' }
  };

  const style = $derived(toneMap[tone] ?? toneMap.walnut);
  const display = $derived(showPercent && percent !== undefined ? `${percent}%` : value);
  const width = $derived(`${Math.min(100, Math.max(0, percent ?? 0))}%`);
</script>

<div class="flex min-w-[138px] flex-col gap-1.5 rounded-xl border border-l-4 border-stone-200 bg-white px-3.5 py-3 {style.border}">
  <div class="flex items-center gap-1.5 text-xs {style.text}">
    <span aria-hidden="true">{icon}</span>
    <span>{label}</span>
  </div>
  <div class="flex items-baseline gap-1">
    <span class="text-xl font-bold tabular-nums text-stone-800">{display}</span>
    {#if suffix}
      <span class="text-xs text-stone-400">{suffix}</span>
    {/if}
  </div>
  {#if percent !== undefined}
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
      <div class="h-full rounded-full {style.bar}" style="width: {width}"></div>
    </div>
  {/if}
</div>
