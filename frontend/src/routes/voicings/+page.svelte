<script lang="ts">
  /** /voicings 整音与维修：登记毡槌/击弦机/换弦事项并跟踪完成状态 */
  import { onMount } from 'svelte';
  import { push, router } from '$lib/router';
  import FilterBar from '$lib/components/common/FilterBar.svelte';
  import StatBadge from '$lib/components/common/StatBadge.svelte';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type PianoRow, type TuningRow, type VoicingRow } from '$lib/utils/db';
  import {
    createEmptyVoicing,
    VOICING_PARTS,
    VOICING_STATES,
    VOICING_TYPES,
    type Voicing
  } from '$lib/types/voicing';
  import {
    completeVoicing,
    createVoicing,
    deleteVoicing,
    editVoicing,
    resetVoicingFilters,
    setVoicingFilters,
    VOICING_FILTER_KEYS,
    voicingFilters
  } from '$lib/stores/voicingStore';
  import type { FilterModel } from '$lib/types/filter';
  import { queryToFilters, toQueryString } from '$lib/utils/query';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));
  const voicings = useIdbTable<VoicingRow>(db.voicings, (a, b) => b.date.localeCompare(a.date));
  const tunings = useIdbTable<TuningRow>(db.tunings, (a, b) => b.date.localeCompare(a.date));

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Omit<Voicing, 'id'>>(createEmptyVoicing());
  let formError = $state<string | null>(null);

  function asArray(value: string | string[] | boolean | undefined): string[] {
    return Array.isArray(value) ? value : [];
  }

  function pianoLabel(pianoId: string): string {
    const piano = $pianos.find((item) => item.id === pianoId);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  /** 关联到最近一次调律（维修履历的上下文） */
  function latestTuningOf(pianoId: string): TuningRow | null {
    return $tunings.find((item) => item.pianoId === pianoId) ?? null;
  }

  const filtered = $derived(
    $voicings.filter((voicing) => {
      const keyword = String($voicingFilters.keyword ?? '').trim().toLowerCase();
      const types = asArray($voicingFilters.types);
      const parts = asArray($voicingFilters.parts);
      const states = asArray($voicingFilters.states);
      const label = `${pianoLabel(voicing.pianoId)} ${voicing.material} ${voicing.operator}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (types.length > 0 && !types.includes(voicing.type)) return false;
      if (parts.length > 0 && !parts.includes(voicing.parts)) return false;
      if (states.length > 0 && !states.includes(voicing.state)) return false;
      return true;
    })
  );

  /** 按钢琴分组的维修履历 */
  const grouped = $derived.by(() => {
    const map = new Map<string, VoicingRow[]>();
    filtered.forEach((item) => {
      const list = map.get(item.pianoId) ?? [];
      list.push(item);
      map.set(item.pianoId, list);
    });
    return Array.from(map.entries()).map(([pianoId, items]) => ({
      pianoId,
      label: pianoLabel(pianoId),
      latestTuning: latestTuningOf(pianoId),
      items: [...items].sort((a, b) => b.date.localeCompare(a.date))
    }));
  });

  const totals = $derived.by(() => {
    const planned = $voicings.filter((item) => item.state === '计划').length;
    return {
      total: $voicings.length,
      planned,
      done: $voicings.filter((item) => item.state === '已完成').length,
      typeCount: new Set($voicings.map((item) => item.type)).size,
      partsCount: new Set($voicings.map((item) => item.parts)).size
    };
  });

  function openCreate(pianoId?: string): void {
    editingId = null;
    form = createEmptyVoicing();
    const preset = pianoId ?? (typeof router.querystring === 'string' && router.querystring.includes('pianoIds=')
      ? (router.querystring.split('pianoIds=')[1] ?? '').split('&')[0]
      : '');
    form.pianoId = preset || $pianos[0]?.id || '';
    formError = null;
    dialogOpen = true;
  }

  function openEdit(voicing: VoicingRow): void {
    editingId = voicing.id;
    form = {
      pianoId: voicing.pianoId,
      type: voicing.type,
      parts: voicing.parts,
      material: voicing.material,
      date: voicing.date,
      operator: voicing.operator,
      state: voicing.state
    };
    formError = null;
    dialogOpen = true;
  }

  async function submit(): Promise<void> {
    if (!form.pianoId) {
      formError = '请选择钢琴';
      return;
    }
    if (!form.operator.trim()) {
      formError = '请填写操作人';
      return;
    }
    if (editingId) {
      await editVoicing(editingId, { ...form });
    } else {
      await createVoicing({ ...form });
    }
    dialogOpen = false;
  }

  async function complete(voicing: VoicingRow): Promise<void> {
    await completeVoicing(voicing.id);
  }

  async function remove(voicing: VoicingRow): Promise<void> {
    if (!window.confirm(`删除 ${voicing.date} 的「${voicing.type}」记录？`)) return;
    await deleteVoicing(voicing.id);
  }

  function applyFilters(next: FilterModel): void {
    setVoicingFilters(next);
    void push(`/voicings${toQueryString(next)}`);
  }

  onMount(() => {
    const query: Record<string, string> = {};
    new URLSearchParams(router.querystring ?? '').forEach((value, key) => {
      query[key] = value;
    });
    setVoicingFilters(queryToFilters(query, VOICING_FILTER_KEYS));
  });
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2 class="page-title">整音与维修</h2>
      <p class="page-subtitle">登记毡槌整音、击弦机调整、换弦与踏板事项；完成维修会回写钢琴状态。</p>
    </div>
    <button type="button" class="btn-primary" onclick={() => openCreate()} disabled={$pianos.length === 0}>+ 新增维修事项</button>
  </div>

  <div class="badge-row">
    <StatBadge label="维修记录" value={totals.total} suffix="条" tone="walnut" icon="🛠️" />
    <StatBadge label="计划中" value={totals.planned} suffix="条" tone="amber" icon="!" />
    <StatBadge label="已完成" value={totals.done} suffix="条" tone="green" icon="✓" />
    <StatBadge label="维修类型" value={totals.typeCount} suffix="类" tone="brass" icon="≡" />
    <StatBadge label="涉及部件" value={totals.partsCount} suffix="种" tone="slate" icon="⚙" />
  </div>

  <FilterBar
    filters={$voicingFilters}
    selects={[
      { key: 'types', label: '类型', options: VOICING_TYPES.map((item) => ({ label: item, value: item })) },
      { key: 'parts', label: '部件', options: VOICING_PARTS.map((item) => ({ label: item, value: item })) },
      { key: 'states', label: '状态', options: VOICING_STATES.map((item) => ({ label: item, value: item })) }
    ]}
    keywordPlaceholder="搜索钢琴 / 材料 / 操作人…"
    onchange={applyFilters}
    onreset={() => {
      resetVoicingFilters();
      void push('/voicings');
    }}
  />

  {#if grouped.length === 0}
    <EmptyPanel
      title="暂无维修记录"
      description="登记整音、换弦、击弦机调整等事项，完成后会自动回写钢琴状态。"
      showCreate={$pianos.length > 0}
      createText="新增维修事项"
      oncreate={() => openCreate()}
    />
  {:else}
    {#each grouped as group (group.pianoId)}
      <div class="card">
        <div class="card-title mb-3">
          <span>{group.label} · 维修履历</span>
          <span class="muted">
            {#if group.latestTuning}
              关联最近调律 {group.latestTuning.date}（{group.latestTuning.technician}）
            {:else}
              尚无调律记录
            {/if}
          </span>
        </div>
        <table class="w-full text-sm">
          <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
            <tr>
              <th class="py-2">日期</th>
              <th class="py-2">类型</th>
              <th class="py-2">部件</th>
              <th class="py-2">材料与规格</th>
              <th class="py-2">操作人</th>
              <th class="py-2">状态</th>
              <th class="py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {#each group.items as voicing (voicing.id)}
              <tr class="border-b border-stone-100">
                <td class="py-2">{voicing.date}</td>
                <td class="py-2">{voicing.type}</td>
                <td class="py-2">{voicing.parts}</td>
                <td class="py-2">{voicing.material || '—'}</td>
                <td class="py-2">{voicing.operator}</td>
                <td class="py-2">
                  <span
                    class="rounded-full px-2 py-0.5 text-xs {voicing.state === '已完成'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'}">{voicing.state}</span
                  >
                </td>
                <td class="py-2">
                  {#if voicing.state === '计划'}
                    <button type="button" class="btn mr-2" onclick={() => complete(voicing)}>完成</button>
                  {/if}
                  <button type="button" class="btn mr-2" onclick={() => openEdit(voicing)}>编辑</button>
                  <button type="button" class="btn-danger" onclick={() => remove(voicing)}>删除</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="mt-3">
          <button type="button" class="btn" onclick={() => openCreate(group.pianoId)}>为该琴新增维修事项</button>
        </div>
      </div>
    {/each}
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
      <h3 class="mb-4 text-base font-semibold">{editingId ? '编辑维修事项' : '新增维修事项'}</h3>
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
          <span class="label">维修类型</span>
          <select class="field" bind:value={form.type}>
            {#each VOICING_TYPES as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
        <div>
          <span class="label">部件</span>
          <select class="field" bind:value={form.parts}>
            {#each VOICING_PARTS as item (item)}
              <option value={item}>{item}</option>
            {/each}
          </select>
        </div>
        <div class="md:col-span-2">
          <span class="label">材料与规格</span>
          <input class="field" bind:value={form.material} placeholder="如：德国 Roslau 0.9mm" />
        </div>
        <div>
          <span class="label">操作人</span>
          <input class="field" bind:value={form.operator} placeholder="如：陆师傅" />
        </div>
        <div>
          <span class="label">状态</span>
          <select class="field" bind:value={form.state}>
            {#each VOICING_STATES as item (item)}
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
