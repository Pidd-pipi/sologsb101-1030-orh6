<script lang="ts">
  /** /tunings 调律记录：录入基准音高与各音区音分偏差、标记需复调 */
  import { onMount } from 'svelte';
  import { push, router } from '$lib/router';
  import FilterBar from '$lib/components/common/FilterBar.svelte';
  import StatBadge from '$lib/components/common/StatBadge.svelte';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import CentsTag from '$lib/components/common/CentsTag.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { summarizeCents } from '$lib/hooks/useCentsDeviation';
  import { db, type PianoRow, type TuningRow } from '$lib/utils/db';
  import {
    createEmptyTuning,
    REPITCH_AVG_THRESHOLD,
    REPITCH_MAX_THRESHOLD,
    STANDARD_PITCH_HZ,
    ZONE_LABELS,
    type Tuning
  } from '$lib/types/tuning';
  import {
    createTuning,
    deleteTuning,
    editTuning,
    resetTuningFilters,
    setTuningFilters,
    TUNING_FILTER_KEYS,
    tuningFilters
  } from '$lib/stores/tuningStore';
  import { bandColor, barHeight, centsFromStandardPitch, formatCents, needsRepitch } from '$lib/utils/cents';
  import type { FilterModel, FilterSelectConfig } from '$lib/types/filter';
  import { queryToFilters, toQueryString } from '$lib/utils/query';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));
  const tunings = useIdbTable<TuningRow>(db.tunings, (a, b) => b.date.localeCompare(a.date));

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Omit<Tuning, 'id'>>(createEmptyTuning());
  let formError = $state<string | null>(null);

  const selects = $derived<FilterSelectConfig[]>([
    {
      key: 'pianoIds',
      label: '钢琴',
      options: $pianos.map((item) => ({ label: `${item.brand} ${item.model}`, value: item.id }))
    }
  ]);

  function asArray(value: string | string[] | boolean | undefined): string[] {
    return Array.isArray(value) ? value : [];
  }

  function pianoLabel(pianoId: string): string {
    const piano = $pianos.find((item) => item.id === pianoId);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  const filtered = $derived(
    $tunings.filter((tuning) => {
      const keyword = String($tuningFilters.keyword ?? '').trim().toLowerCase();
      const pianoIds = asArray($tuningFilters.pianoIds);
      const label = `${pianoLabel(tuning.pianoId)} ${tuning.technician} ${tuning.date}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (pianoIds.length > 0 && !pianoIds.includes(tuning.pianoId)) return false;
      if ($tuningFilters.switch && !tuning.pitchRaised) return false;
      return true;
    })
  );

  /** 各音区偏差条形图数据（取列表中出现过的音区最大值作为参考） */
  const zoneRows = $derived(
    ZONE_LABELS.map((zone) => {
      const value = filtered.length > 0 ? filtered[0].zones[zone.key] : 0;
      return { ...zone, value };
    })
  );

  const totals = $derived.by(() => {
    const all = $tunings;
    const repitch = all.filter((item) => item.pitchRaised).length;
    const avg = all.length > 0 ? all.reduce((sum, item) => sum + item.avgDeviationCents, 0) / all.length : 0;
    const maxAbs = all.reduce((max, item) => Math.max(max, Math.abs(item.maxDeviationCents)), 0);
    return {
      tuningCount: all.length,
      repitchCount: repitch,
      repitchRatio: all.length > 0 ? Math.round((repitch / all.length) * 100) : 0,
      avgDeviation: Number(avg.toFixed(1)),
      maxDeviation: Number(maxAbs.toFixed(1)),
      pianoCovered: new Set(all.map((item) => item.pianoId)).size
    };
  });

  /** 由三个音区偏差自动推导平均值与最大值 */
  function recalc(): void {
    const values = [form.zones.bass, form.zones.mid, form.zones.treble];
    form.avgDeviationCents = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
    form.maxDeviationCents = Number(
      values.reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst), values[0]).toFixed(1)
    );
    form.pitchRaised = needsRepitch(form.avgDeviationCents, form.maxDeviationCents);
  }

  function openCreate(): void {
    editingId = null;
    form = createEmptyTuning();
    if ($pianos.length > 0) form.pianoId = $pianos[0].id;
    formError = null;
    dialogOpen = true;
  }

  function openEdit(tuning: TuningRow): void {
    editingId = tuning.id;
    form = {
      pianoId: tuning.pianoId,
      date: tuning.date,
      basePitchHz: tuning.basePitchHz,
      avgDeviationCents: tuning.avgDeviationCents,
      maxDeviationCents: tuning.maxDeviationCents,
      zones: { ...tuning.zones },
      technician: tuning.technician,
      pitchRaised: tuning.pitchRaised
    };
    formError = null;
    dialogOpen = true;
  }

  async function submit(): Promise<void> {
    if (!form.pianoId) {
      formError = '请选择钢琴';
      return;
    }
    if (!form.technician.trim()) {
      formError = '请填写调律师';
      return;
    }
    if (form.basePitchHz < 400 || form.basePitchHz > 480) {
      formError = '基准音高应在 400–480 Hz 之间';
      return;
    }
    recalc();
    const payload = { ...form, zones: { ...form.zones } };
    if (editingId) {
      await editTuning(editingId, payload);
    } else {
      await createTuning(payload);
    }
    dialogOpen = false;
  }

  async function remove(tuning: TuningRow): Promise<void> {
    if (!window.confirm(`删除 ${tuning.date} 的调律记录？`)) return;
    await deleteTuning(tuning.id);
  }

  function applyFilters(next: FilterModel): void {
    setTuningFilters(next);
    void push(`/tunings${toQueryString(next)}`);
  }

  onMount(() => {
    const query: Record<string, string> = {};
    new URLSearchParams(router.querystring ?? '').forEach((value, key) => {
      query[key] = value;
    });
    setTuningFilters(queryToFilters(query, TUNING_FILTER_KEYS));
  });

  /** 当前选中钢琴的音分小结，用于弹窗里的实时提示 */
  const dialogSummary = $derived(form.pianoId ? summarizeCents($tunings, form.pianoId) : null);
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2 class="page-title">调律记录</h2>
      <p class="page-subtitle">
        标准音 A4 = {STANDARD_PITCH_HZ} Hz；平均偏差超过 {REPITCH_AVG_THRESHOLD} 音分或最大偏差超过 {REPITCH_MAX_THRESHOLD} 音分自动标记需复调。
      </p>
    </div>
    <button type="button" class="btn-primary" onclick={openCreate} disabled={$pianos.length === 0}>+ 新增调律记录</button>
  </div>

  <div class="badge-row">
    <StatBadge label="调律次数" value={totals.tuningCount} suffix="次" tone="walnut" icon="🎼" />
    <StatBadge label="需复调" value={totals.repitchCount} suffix="次" tone="rose" icon="!" />
    <StatBadge label="复调占比" value={totals.repitchRatio} percent={totals.repitchRatio} showPercent tone="amber" icon="%" />
    <StatBadge label="平均偏差" value={totals.avgDeviation} suffix="音分" tone="brass" icon="≈" />
    <StatBadge label="最大偏差" value={totals.maxDeviation} suffix="音分" tone="slate" icon="‼" />
    <StatBadge label="覆盖钢琴" value={totals.pianoCovered} suffix="台" tone="green" icon="🎹" />
  </div>

  <FilterBar
    filters={$tuningFilters}
    {selects}
    keywordPlaceholder="搜索钢琴 / 调律师 / 日期…"
    switchLabel="仅看需复调"
    onchange={applyFilters}
    onreset={() => {
      resetTuningFilters();
      void push('/tunings');
    }}
  />

  {#if filtered.length === 0}
    <EmptyPanel
      title="暂无调律记录"
      description="选择一台钢琴，录入基准音高与低/中/高音区的音分偏差。"
      showCreate={$pianos.length > 0}
      createText="新增调律记录"
      oncreate={openCreate}
    />
  {:else}
    <div class="card">
      <div class="card-title mb-3">
        <span>音区偏差条形图（{pianoLabel(filtered[0].pianoId)} · {filtered[0].date}）</span>
        <span class="muted">以 ±40 音分为满格</span>
      </div>
      <div class="flex items-end gap-6">
        {#each zoneRows as zone (zone.key)}
          <div class="flex w-28 flex-col items-center gap-1">
            <span class="text-xs tabular-nums text-stone-500">{formatCents(zone.value)}</span>
            <div class="flex h-32 w-full items-end rounded-lg bg-stone-100">
              <div
                class="w-full rounded-t-lg transition-all"
                style="height: {barHeight(zone.value)}%; background-color: {bandColor(zone.value)}"
              ></div>
            </div>
            <span class="text-xs text-stone-500">{zone.label}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
          <tr>
            <th class="py-2">钢琴</th>
            <th class="py-2">日期</th>
            <th class="py-2">基准音高</th>
            <th class="py-2">平均偏差</th>
            <th class="py-2">最大偏差</th>
            <th class="py-2">低 / 中 / 高音区</th>
            <th class="py-2">调律师</th>
            <th class="py-2">复调</th>
            <th class="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as tuning (tuning.id)}
            <tr class="border-b border-stone-100">
              <td class="py-2">{pianoLabel(tuning.pianoId)}</td>
              <td class="py-2">{tuning.date}</td>
              <td class="py-2 tabular-nums">
                {tuning.basePitchHz} Hz
                <div class="muted">{formatCents(centsFromStandardPitch(tuning.basePitchHz))}</div>
              </td>
              <td class="py-2"><CentsTag cents={tuning.avgDeviationCents} size="sm" /></td>
              <td class="py-2"><CentsTag cents={tuning.maxDeviationCents} size="sm" /></td>
              <td class="py-2 tabular-nums text-xs text-stone-500">
                {tuning.zones.bass} / {tuning.zones.mid} / {tuning.zones.treble}
              </td>
              <td class="py-2">{tuning.technician}</td>
              <td class="py-2">
                {#if tuning.pitchRaised}
                  <span class="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700">需复调</span>
                {:else}
                  <span class="muted">正常</span>
                {/if}
              </td>
              <td class="py-2">
                <button type="button" class="btn mr-2" onclick={() => openEdit(tuning)}>编辑</button>
                <button type="button" class="btn-danger" onclick={() => remove(tuning)}>删除</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
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
      <h3 class="mb-4 text-base font-semibold">{editingId ? '编辑调律记录' : '新增调律记录'}</h3>
      {#if formError}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}

      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <span class="label">钢琴</span>
          <select class="field" bind:value={form.pianoId} onchange={recalc}>
            {#each $pianos as piano (piano.id)}
              <option value={piano.id}>{piano.brand} {piano.model}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">调律日期</span>
          <input class="field" type="date" bind:value={form.date} />
        </div>
        <div>
          <span class="label">基准音高 Hz</span>
          <input class="field" type="number" step="0.1" bind:value={form.basePitchHz} oninput={recalc} />
        </div>
        <div>
          <span class="label">调律师</span>
          <input class="field" bind:value={form.technician} placeholder="如：陆师傅" />
        </div>
      </div>

      <div class="mt-4">
        <div class="mb-1 text-xs text-stone-500">各音区音分偏差（自动计算平均与最大值）</div>
        <div class="grid gap-3 md:grid-cols-3">
          {#each ZONE_LABELS as zone (zone.key)}
            <div>
              <span class="label">{zone.label}</span>
              <input
                class="field"
                type="number"
                step="0.1"
                bind:value={form.zones[zone.key]}
                oninput={recalc}
              />
            </div>
          {/each}
        </div>
      </div>

      <div class="mt-4 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
        平均 {form.avgDeviationCents} 音分 · 最大 {form.maxDeviationCents} 音分 ·
        {form.pitchRaised ? '判定需二次复调' : '偏差在可接受区间'}
        {#if dialogSummary && dialogSummary.tuningCount > 0}
          <div class="mt-1 text-stone-400">该琴历史调律 {dialogSummary.tuningCount} 次，上次 {dialogSummary.lastTuningDate}</div>
        {/if}
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" onclick={() => (dialogOpen = false)}>取消</button>
        <button type="button" class="btn-primary" onclick={submit}>保存</button>
      </div>
    </div>
  </div>
{/if}
