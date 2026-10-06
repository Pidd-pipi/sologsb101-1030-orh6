<script lang="ts">
  /** /environments 琴房温湿度记录：按日期录入并高亮超标区间 */
  import { onMount } from 'svelte';
  import { push, router } from '$lib/router';
  import FilterBar from '$lib/components/common/FilterBar.svelte';
  import StatBadge from '$lib/components/common/StatBadge.svelte';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type EnvironmentRow, type PianoRow } from '$lib/utils/db';
  import {
    abnormalHint,
    createEmptyEnvironment,
    ENV_DEVICES,
    HUMIDITY_RANGE,
    isAbnormal,
    TEMP_RANGE,
    type Environment
  } from '$lib/types/environment';
  import {
    createEnvironment,
    deleteEnvironment,
    editEnvironment,
    ENVIRONMENT_FILTER_KEYS,
    environmentFilters,
    resetEnvironmentFilters,
    setEnvironmentFilters
  } from '$lib/stores/environmentStore';
  import type { FilterModel } from '$lib/types/filter';
  import { queryToFilters, toQueryString } from '$lib/utils/query';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));
  const environments = useIdbTable<EnvironmentRow>(db.environments, (a, b) => b.date.localeCompare(a.date));

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Omit<Environment, 'id'>>(createEmptyEnvironment());
  let formError = $state<string | null>(null);

  function asArray(value: string | string[] | boolean | undefined): string[] {
    return Array.isArray(value) ? value : [];
  }

  function pianoLabel(pianoId: string): string {
    const piano = $pianos.find((item) => item.id === pianoId);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  const filtered = $derived(
    $environments.filter((row) => {
      const keyword = String($environmentFilters.keyword ?? '').trim().toLowerCase();
      const pianoIds = asArray($environmentFilters.pianoIds);
      const label = `${pianoLabel(row.pianoId)} ${row.device} ${row.date}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (pianoIds.length > 0 && !pianoIds.includes(row.pianoId)) return false;
      if ($environmentFilters.switch && !row.abnormal) return false;
      return true;
    })
  );

  const totals = $derived.by(() => {
    const abnormal = $environments.filter((item) => item.abnormal).length;
    const avgTemp =
      $environments.length > 0
        ? $environments.reduce((sum, item) => sum + item.tempC, 0) / $environments.length
        : 0;
    const avgHumidity =
      $environments.length > 0
        ? $environments.reduce((sum, item) => sum + item.humidityPct, 0) / $environments.length
        : 0;
    return {
      total: $environments.length,
      abnormal,
      abnormalRatio: $environments.length > 0 ? Math.round((abnormal / $environments.length) * 100) : 0,
      avgTemp: Number(avgTemp.toFixed(1)),
      avgHumidity: Number(avgHumidity.toFixed(1)),
      pianoCovered: new Set($environments.map((item) => item.pianoId)).size
    };
  });

  function openCreate(): void {
    editingId = null;
    form = createEmptyEnvironment();
    form.pianoId = $pianos[0]?.id ?? '';
    form.abnormal = isAbnormal(form.tempC, form.humidityPct);
    formError = null;
    dialogOpen = true;
  }

  function openEdit(row: EnvironmentRow): void {
    editingId = row.id;
    form = {
      pianoId: row.pianoId,
      date: row.date,
      tempC: row.tempC,
      humidityPct: row.humidityPct,
      device: row.device,
      abnormal: row.abnormal
    };
    formError = null;
    dialogOpen = true;
  }

  /** 录入即时判定是否超标 */
  function recalc(): void {
    form.abnormal = isAbnormal(form.tempC, form.humidityPct);
  }

  async function submit(): Promise<void> {
    if (!form.pianoId) {
      formError = '请选择钢琴';
      return;
    }
    if (form.tempC < -10 || form.tempC > 45 || form.humidityPct < 0 || form.humidityPct > 100) {
      formError = '温度应在 -10 ~ 45 ℃，湿度应在 0 ~ 100 %';
      return;
    }
    recalc();
    if (editingId) {
      await editEnvironment(editingId, { ...form });
    } else {
      await createEnvironment({ ...form });
    }
    dialogOpen = false;
  }

  async function remove(row: EnvironmentRow): Promise<void> {
    if (!window.confirm(`删除 ${row.date} 的环境记录？`)) return;
    await deleteEnvironment(row.id);
  }

  function applyFilters(next: FilterModel): void {
    setEnvironmentFilters(next);
    void push(`/environments${toQueryString(next)}`);
  }

  onMount(() => {
    const query: Record<string, string> = {};
    new URLSearchParams(router.querystring ?? '').forEach((value, key) => {
      query[key] = value;
    });
    setEnvironmentFilters(queryToFilters(query, ENVIRONMENT_FILTER_KEYS));
  });
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2 class="page-title">琴房温湿度记录</h2>
      <p class="page-subtitle">
        建议区间：温度 {TEMP_RANGE[0]}–{TEMP_RANGE[1]} ℃、湿度 {HUMIDITY_RANGE[0]}–{HUMIDITY_RANGE[1]} %；超出即自动标记异常。
      </p>
    </div>
    <button type="button" class="btn-primary" onclick={openCreate} disabled={$pianos.length === 0}>+ 新增环境记录</button>
  </div>

  <div class="badge-row">
    <StatBadge label="环境记录" value={totals.total} suffix="条" tone="walnut" icon="🌡️" />
    <StatBadge label="超标天数" value={totals.abnormal} suffix="天" tone="rose" icon="!" />
    <StatBadge label="超标占比" value={totals.abnormalRatio} percent={totals.abnormalRatio} showPercent tone="amber" icon="%" />
    <StatBadge label="平均温度" value={totals.avgTemp} suffix="℃" tone="brass" icon="≈" />
    <StatBadge label="平均湿度" value={totals.avgHumidity} suffix="%" tone="slate" icon="💧" />
    <StatBadge label="覆盖钢琴" value={totals.pianoCovered} suffix="台" tone="green" icon="🎹" />
  </div>

  <FilterBar
    filters={$environmentFilters}
    selects={[
      {
        key: 'pianoIds',
        label: '钢琴',
        options: $pianos.map((item) => ({ label: `${item.brand} ${item.model}`, value: item.id }))
      }
    ]}
    keywordPlaceholder="搜索钢琴 / 监测方式 / 日期…"
    switchLabel="仅看超标记录"
    onchange={applyFilters}
    onreset={() => {
      resetEnvironmentFilters();
      void push('/environments');
    }}
  />

  {#if filtered.length === 0}
    <EmptyPanel
      title="暂无环境记录"
      description="按日期录入琴房温度与相对湿度，超标记录会自动高亮。"
      showCreate={$pianos.length > 0}
      createText="新增环境记录"
      oncreate={openCreate}
    />
  {:else}
    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
          <tr>
            <th class="py-2">钢琴</th>
            <th class="py-2">日期</th>
            <th class="py-2">温度 ℃</th>
            <th class="py-2">湿度 %</th>
            <th class="py-2">监测方式</th>
            <th class="py-2">判定</th>
            <th class="py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as row (row.id)}
            <tr class="border-b border-stone-100 {row.abnormal ? 'bg-rose-50/70' : ''}">
              <td class="py-2">{pianoLabel(row.pianoId)}</td>
              <td class="py-2">{row.date}</td>
              <td class="py-2 tabular-nums {row.abnormal && (row.tempC < TEMP_RANGE[0] || row.tempC > TEMP_RANGE[1]) ? 'font-semibold text-rose-700' : ''}">
                {row.tempC}
              </td>
              <td class="py-2 tabular-nums {row.abnormal && (row.humidityPct < HUMIDITY_RANGE[0] || row.humidityPct > HUMIDITY_RANGE[1]) ? 'font-semibold text-rose-700' : ''}">
                {row.humidityPct}
              </td>
              <td class="py-2">{row.device}</td>
              <td class="py-2">
                <span
                  class="rounded-full px-2 py-0.5 text-xs {row.abnormal
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-emerald-100 text-emerald-700'}">{row.abnormal ? '超标' : '正常'}</span
                >
                <div class="muted mt-0.5">{abnormalHint(row.tempC, row.humidityPct)}</div>
              </td>
              <td class="py-2">
                <button type="button" class="btn mr-2" onclick={() => openEdit(row)}>编辑</button>
                <button type="button" class="btn-danger" onclick={() => remove(row)}>删除</button>
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
      <h3 class="mb-4 text-base font-semibold">{editingId ? '编辑环境记录' : '新增环境记录'}</h3>
      {#if formError}
        <div class="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{formError}</div>
      {/if}
      <div class="grid gap-3 md:grid-cols-2">
        <div>
          <span class="label">钢琴</span>
          <select class="field" bind:value={form.pianoId}>
            {#each $pianos as piano (piano.id)}
              <option value={piano.id}>{piano.brand} {piano.model}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">日期</span>
          <input class="field" type="date" bind:value={form.date} />
        </div>
        <div>
          <span class="label">温度 ℃</span>
          <input class="field" type="number" step="0.1" bind:value={form.tempC} oninput={recalc} />
        </div>
        <div>
          <span class="label">相对湿度 %</span>
          <input class="field" type="number" step="1" bind:value={form.humidityPct} oninput={recalc} />
        </div>
        <div>
          <span class="label">监测方式</span>
          <select class="field" bind:value={form.device}>
            {#each ENV_DEVICES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
      </div>
      <div class="mt-4 rounded-lg px-3 py-2 text-xs {form.abnormal ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}">
        {form.abnormal ? '自动判定：超标' : '自动判定：处于建议区间'} · {abnormalHint(form.tempC, form.humidityPct)}
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn" onclick={() => (dialogOpen = false)}>取消</button>
        <button type="button" class="btn-primary" onclick={submit}>保存</button>
      </div>
    </div>
  </div>
{/if}
