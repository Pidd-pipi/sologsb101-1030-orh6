<script lang="ts">
  /**
   * CentsTag：按音分偏差区间（±5 / ±10 / ±20 / ±20 以上）渲染底色与图标。
   * 被钢琴台账、调律记录页与提醒页消费。
   */
  import { bandClass, bandIcon, centsBand, formatCents } from '$lib/utils/cents';

  let {
    cents,
    size = 'md',
    showBand = true
  }: { cents: number; size?: 'sm' | 'md' | 'lg'; showBand?: boolean } = $props();

  const tone = $derived(bandClass(cents));
  const icon = $derived(bandIcon(cents));
  const band = $derived(centsBand(cents));
  const text = $derived(formatCents(cents));

  const sizeClass = $derived(
    size === 'sm' ? 'text-xs px-2 py-0.5' : size === 'lg' ? 'text-base px-3 py-1' : 'text-sm px-2.5 py-0.5'
  );
</script>

<span
  class="inline-flex items-center gap-1 rounded-full ring-1 font-medium tabular-nums {tone} {sizeClass}"
  title="偏差分档 {band}"
>
  <span aria-hidden="true">{icon}</span>
  <span>{text}</span>
  {#if showBand}
    <span class="opacity-70">· {band}</span>
  {/if}
</span>
