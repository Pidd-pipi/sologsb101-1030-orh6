<script lang="ts">
  /** /pianos 钢琴档案台账：新建琴档、按品牌/类型/场所筛选、显示最近调律与音分偏差 */
  import { onMount } from 'svelte';
  import { push, router } from '$lib/router';
  import FilterBar from '$lib/components/common/FilterBar.svelte';
  import StatBadge from '$lib/components/common/StatBadge.svelte';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import CentsTag from '$lib/components/common/CentsTag.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { summarizeCents } from '$lib/hooks/useCentsDeviation';
  import { db, type PianoRow, type ReminderRow, type TuningRow } from '$lib/utils/db';
  import { PIANO_STATES, PIANO_TYPES, PIANO_VENUES, createEmptyPiano, type Piano } from '$lib/types/piano';
  import { daysToDue } from '$lib/types/reminder';
  import {
    createPiano,
    deletePiano,
    editPiano,
    PIANO_FILTER_KEYS,
    pianoFilters,
    resetPianoFilters,
    setPianoFilters
  } from '$lib/stores/pianoStore';
  import type { FilterModel, FilterSelectConfig } from '$lib/types/filter';
  import { queryToFilters, toQueryString } from '$lib/utils/query';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));
  const tunings = useIdbTable<TuningRow>(db.tunings);
  const reminders = useIdbTable<ReminderRow>(db.reminders);

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Omit<Piano, 'id'>>(createEmptyPiano());
  let formError = $state<string | null>(null);

  const brands = $derived(Array.from(new Set($pianos.map((item) => item.brand))).sort());
  const selects = $derived<FilterSelectConfig[]>([
    { key: 'brands', label: '品牌', options: brands.map((item) => ({ label: item, value: item })) },
    { key: 'venues', label: '场所', options: PIANO_VENUES.map((item) => ({ label: item, value: item })) },
    { key: 'states', label: '状态', options: PIANO_STATES.map((item) => ({ label: item, value: item })) }
  ]);

  function asArray(value: string | string[] | boolean | undefined): string[] {
    return Array.isArray(value) ? value : [];
  }

  const filtered = $derived(
    $pianos.filter((piano) => {
      const keyword = String($pianoFilters.keyword ?? '').trim().toLowerCase();
      const brandList = asArray($pianoFilters.brands);
      const venueList = asArray($pianoFilters.venues);
      const stateList = asArray($pianoFilters.states);
      const label = `${piano.brand} ${piano.model} ${piano.serialNo}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (brandList.length > 0 && !brandList.includes(piano.brand)) return false;
      if (venueList.length > 0 && !venueList.includes(piano.venue)) return false;
      if (stateList.length > 0 && !stateList.includes(piano.state)) return false;
      return true;
    })
  );

  function reminderOf(pianoId: string): ReminderRow | null {
    return $reminders.find((item) => item.pianoId === pianoId) ?? null;
  }

  const totals = $derived.by(() => {
    const all = $pianos;
    const deviations = all.map((piano) => Math.abs(summarizeCents($tunings, piano.id).avgDeviationCents));
    const avg = deviations.length > 0 ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length : 0;
    const overdue = all.filter((piano) => reminderOf(piano.id)?.state === '超期').length;
    return {
      pianoCount: all.length,
      normal: all.filter((item) => item.state === '正常').length,
      needRepair: all.filter((item) => item.state === '待修').length,
      overdue,
      avgDeviation: Number(avg.toFixed(1))
    };
  });

  function openCreate(): void {
    editingId = null;
    form = createEmptyPiano();
    formError = null;
    dialogOpen = true;
  }

  function openEdit(piano: PianoRow): void {
    editingId = piano.id;
    form = {
      brand: piano.brand,
      model: piano.model,
      serialNo: piano.serialNo,
      type: piano.type,
      venue: piano.venue,
      purchaseYear: piano.purchaseYear,
      state: piano.state
    };
    formError = null;
    dialogOpen = true;
  }

  async function submit(): Promise<void> {
    if (!form.brand.trim() || !form.model.trim()) {
      formError = '请填写品牌与型号';
      return;
    }
    if (editingId) {
      await editPiano(editingId, { ...form });
    } else {
      await createPiano({ ...form });
    }
    dialogOpen = false;
  }

  async function remove(piano: PianoRow): Promise<void> {
    const confirmed = window.confirm(`删除「${piano.brand} ${piano.model}」会级联删除其调律、维修、环境与提醒记录，是否继续？`);
    if (!confirmed) return;
    await deletePiano(piano.id);
  }

  function applyFilters(next: FilterModel): void {
    setPianoFilters(next);
    void push(`/pianos${toQueryString(next)}`);
  }

  onMount(() => {
    const query: Record<string, string> = {};
    new URLSearchParams(router.querystring ?? '').forEach((value, key) => {
      query[key] = value;
    });
    setPianoFilters(queryToFilters(query, PIANO_FILTER_KEYS));
  });
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2 class="page-title">钢琴档案台账</h2>
      <p class="page-subtitle">新建琴档后即可录入调律与维修记录；卡片回显最近调律日期、平均音分偏差与下次建议日期。</p>
    </div>
    <button type="button" class="btn-primary" onclick={openCreate}>+ 新建琴档</button>
  </div>

  <div class="badge-row">
    <StatBadge label="钢琴总数" value={totals.pianoCount} suffix="台" tone="walnut" icon="🎹" />
    <StatBadge label="状态正常" value={totals.normal} suffix="台" tone="green" icon="✓" />
    <StatBadge label="待修" value={totals.needRepair} suffix="台" tone="amber" icon="!" />
    <StatBadge label="调律超期" value={totals.overdue} suffix="台" tone="rose" icon="⏰" />
    <StatBadge label="平均偏差" value={totals.avgDeviation} suffix="音分" tone="brass" icon="🎼" />
  </div>

  <FilterBar
    filters={$pianoFilters}
    {selects}
    keywordPlaceholder="搜索品牌 / 型号 / 序列号…"
    onchange={applyFilters}
    onreset={() => {
      resetPianoFilters();
      void push('/pianos');
    }}
  />

  {#if filtered.length === 0}
    <EmptyPanel
      title="还没有匹配的钢琴档案"
      description="新建一台钢琴的档案，或调整品牌 / 场所 / 状态筛选条件。"
      createText="新建琴档"
      oncreate={openCreate}
    />
  {:else}
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {#each filtered as piano (piano.id)}
        {@const summary = summarizeCents($tunings, piano.id)}
        {@const reminder = reminderOf(piano.id)}
        <div class="card flex flex-col gap-3">
          <div class="card-title">
            <span>{piano.brand} {piano.model}</span>
            <span
              class="rounded-full px-2 py-0.5 text-xs {piano.state === '正常'
                ? 'bg-emerald-100 text-emerald-700'
                : piano.state === '待修'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-stone-200 text-stone-600'}">{piano.state}</span
            >
          </div>

          <div class="text-xs text-stone-500">
            <div>类型：{piano.type} · 场所：{piano.venue}</div>
            <div>序列号：{piano.serialNo || '—'} · 购入 {piano.purchaseYear} 年</div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span class="muted">最近调律 {summary.lastTuningDate}</span>
            {#if summary.tuningCount > 0}
              <CentsTag cents={summary.avgDeviationCents} size="sm" />
              {#if summary.needsRepitch}
                <span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">需复调</span>
              {/if}
            {:else}
              <span class="muted">暂无调律记录</span>
            {/if}
          </div>

          <div class="text-xs text-stone-500">
            {#if reminder}
              下次建议 {reminder.nextDueDate}
              <span class="ml-1 {reminder.state === '超期' ? 'text-rose-600' : 'text-stone-400'}">
                （{daysToDue(reminder.nextDueDate)} 天 / {reminder.state}）
              </span>
            {:else}
              尚未建立周期提醒
            {/if}
          </div>

          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="btn" onclick={() => push(`/tunings?pianoIds=${piano.id}`)}>去调律</button>
            <button type="button" class="btn" onclick={() => push(`/voicings?pianoIds=${piano.id}`)}>维修履历</button>
            <button type="button" class="btn" onclick={() => push(`/environments?pianoIds=${piano.id}`)}>环境</button>
            <button type="button" class="btn" onclick={() => openEdit(piano)}>编辑</button>
            <button type="button" class="btn-danger" onclick={() => remove(piano)}>删除</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if dialogOpen}
  <div class="modal-mask">
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      aria-label="关闭弹窗"
      onclick={() => (dialogOpen = false)}
    ></button>
    <div class="modal-panel relative" role="dialog" aria-modal="true">
      <h3 class="mb-4 text-base font-semibold">{editingId ? '编辑琴档' : '新建琴档'}</h3>
      {#if formError}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <span class="label">品牌</span>
          <input class="field" bind:value={form.brand} placeholder="如：YAMAHA" />
        </div>
        <div>
          <span class="label">型号</span>
          <input class="field" bind:value={form.model} placeholder="如：U1" />
        </div>
        <div>
          <span class="label">序列号</span>
          <input class="field" bind:value={form.serialNo} placeholder="如：U1-6132457" />
        </div>
        <div>
          <span class="label">购入年份</span>
          <input class="field" type="number" bind:value={form.purchaseYear} min="1900" max="2100" />
        </div>
        <div>
          <span class="label">类型</span>
          <select class="field" bind:value={form.type}>
            {#each PIANO_TYPES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">使用场所</span>
          <select class="field" bind:value={form.venue}>
            {#each PIANO_VENUES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">状态</span>
          <select class="field" bind:value={form.state}>
            {#each PIANO_STATES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" onclick={() => (dialogOpen = false)}>取消</button>
        <button type="button" class="btn-primary" onclick={submit}>保存</button>
      </div>
    </div>
  </div>
{/if}
