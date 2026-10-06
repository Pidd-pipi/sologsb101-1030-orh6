<script lang="ts">
  /**
   * /conflicts 待确认中心
   * 两个标签页并发保存产生的同字段冲突、旧数据缺来源记录都在这里处理：
   * - 字段冲突逐字段选择保留已生效值或采用后到值，确认前已生效内容不会被覆盖；
   * - 缺来源先补来源再确认，也可直接放弃后到修改；
   * - 全部操作走同一事务，任一失败整批回滚；确认 / 放弃后档案、音分、复调与提醒立即重算。
   */
  import { push } from '$lib/router';
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { db, type PianoRow } from '$lib/utils/db';
  import { ENTITY_LABELS } from '$lib/utils/entityFields';
  import type { PendingChangeRow } from '$lib/types/pending';
  import { actorName, confirmPending, dropPending, pendingListStore, updateActorName } from '$lib/stores/syncStore';

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));

  /** 每条待确认的逐字段选择（默认保留已生效值）与补填来源 */
  let choices = $state<Record<string, Record<string, 'current' | 'incoming'>>>({});
  let sources = $state<Record<string, string>>({});
  let busy = $state(false);
  let actionError = $state<string | null>(null);
  let nameDraft = $state($actorName);

  const pending = $derived($pendingListStore);
  const pendingOnly = $derived(pending.filter((item) => item.status === 'pending'));
  const resolved = $derived(pending.filter((item) => item.status !== 'pending'));

  function pianoLabel(pianoId: string): string {
    const piano = $pianos.find((item) => item.id === pianoId);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  function choiceOf(item: PendingChangeRow, field: string): 'current' | 'incoming' {
    return choices[item.id]?.[field] ?? 'current';
  }

  function setChoice(item: PendingChangeRow, field: string, value: 'current' | 'incoming'): void {
    choices = { ...choices, [item.id]: { ...(choices[item.id] ?? {}), [field]: value } };
  }

  function sourceOf(item: PendingChangeRow): string {
    return sources[item.id] ?? (item.source ?? '');
  }

  function setSource(item: PendingChangeRow, value: string): void {
    sources = { ...sources, [item.id]: value };
  }

  function formatValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '（空）';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  async function confirmOne(item: PendingChangeRow): Promise<void> {
    actionError = null;
    if (item.sourceMissing && !sourceOf(item).trim()) {
      actionError = `${ENTITY_LABELS[item.table]}记录请先补填数据来源再确认。`;
      return;
    }
    busy = true;
    try {
      await confirmPending([
        {
          pendingId: item.id,
          choices: choices[item.id] ?? {},
          source: sourceOf(item).trim() || undefined,
          resolvedBy: $actorName
        }
      ]);
    } catch (error) {
      actionError = error instanceof Error ? error.message : '确认失败，整批修改已回滚';
    } finally {
      busy = false;
    }
  }

  async function discardOne(item: PendingChangeRow): Promise<void> {
    if (!window.confirm('放弃后后到一方的修改不会生效，是否继续？')) return;
    actionError = null;
    busy = true;
    try {
      await dropPending([item.id]);
    } catch (error) {
      actionError = error instanceof Error ? error.message : '放弃失败';
    } finally {
      busy = false;
    }
  }

  /** 批量确认：同一事务，任一失败整批回滚 */
  async function confirmAll(): Promise<void> {
    const missing = pendingOnly.filter((item) => item.sourceMissing && !(sources[item.id] ?? '').trim());
    if (missing.length > 0) {
      actionError = `还有 ${missing.length} 条缺来源记录，请先补填来源再批量确认。`;
      return;
    }
    busy = true;
    actionError = null;
    try {
      await confirmPending(
        pendingOnly.map((item) => ({
          pendingId: item.id,
          choices: choices[item.id] ?? {},
          source: (sources[item.id] ?? '').trim() || undefined,
          resolvedBy: $actorName
        }))
      );
    } catch (error) {
      actionError = error instanceof Error ? error.message : '批量确认失败，整批已回滚';
    } finally {
      busy = false;
    }
  }

  async function discardAll(): Promise<void> {
    if (pendingOnly.length === 0) return;
    if (!window.confirm(`放弃全部 ${pendingOnly.length} 条待确认？后到一方的修改都不会生效。`)) return;
    busy = true;
    actionError = null;
    try {
      await dropPending(pendingOnly.map((item) => item.id));
    } catch (error) {
      actionError = error instanceof Error ? error.message : '批量放弃失败';
    } finally {
      busy = false;
    }
  }

  function saveActorName(): void {
    updateActorName(nameDraft);
  }

  function timeOf(ts: number): string {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  }
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h2 class="page-title">待确认中心</h2>
      <p class="page-subtitle">
        多标签页并发保存时，不同字段已自动合并；同一字段的冲突会保留双方的值与操作人，确认前不会覆盖已生效内容。
      </p>
    </div>
    <button type="button" class="btn" onclick={() => push('/pianos')}>返回钢琴档案</button>
  </div>

  <div class="card mb-4 flex flex-wrap items-center gap-3">
    <span class="text-sm text-stone-600">当前标签页操作人</span>
    <input class="field w-56" bind:value={nameDraft} placeholder="如：陆师傅" />
    <button type="button" class="btn" onclick={saveActorName}>保存操作人</button>
    <span class="muted">冲突双方会分别显示操作人标签</span>
  </div>

  {#if actionError}
    <div class="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{actionError}</div>
  {/if}

  {#if pendingOnly.length > 0}
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-sm text-stone-600">{pendingOnly.length} 条待处理</span>
      <button type="button" class="btn-primary" disabled={busy} onclick={confirmAll}>全部确认（同一事务）</button>
      <button type="button" class="btn-danger" disabled={busy} onclick={discardAll}>全部放弃</button>
    </div>
  {/if}

  {#if pending.length === 0}
    <EmptyPanel
      title="没有待确认事项"
      description="两个标签页同时修改同一字段、或旧数据缺来源时，冲突会自动汇集到这里。"
      showCreate={false}
    />
  {/if}

  {#each pending as item (item.id)}
    <div class="card mb-4 border-l-4 {item.status === 'pending'
      ? item.kind === 'source'
        ? 'border-amber-400'
        : 'border-rose-400'
      : 'border-stone-200'}">
      <div class="card-title">
        <span>
          {ENTITY_LABELS[item.table]} · {pianoLabel(item.pianoId)}
          <span class="ml-2 rounded-full px-2 py-0.5 text-xs {item.status === 'pending'
            ? item.kind === 'source'
              ? 'bg-amber-100 text-amber-700'
              : 'bg-rose-100 text-rose-700'
            : item.status === 'confirmed'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-stone-200 text-stone-600'}">
            {item.status === 'pending' ? (item.kind === 'source' ? '缺来源待确认' : '字段冲突') : item.status === 'confirmed' ? '已确认' : '已放弃'}
          </span>
        </span>
        <span class="muted">{timeOf(item.createdAt)} · 基于修订号 {item.baseRevision}</span>
      </div>

      <div class="mb-3 text-xs text-stone-500">
        后保存：<span class="font-semibold text-stone-700">{item.actorName}</span>
        {#if item.currentActorName}
          ；已生效一方：<span class="font-semibold text-stone-700">{item.currentActorName}</span>
        {/if}
      </div>

      {#if item.kind === 'field' && item.conflicts.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b border-stone-200 text-left text-xs text-stone-500">
              <tr>
                <th class="py-2">冲突字段</th>
                <th class="py-2">已生效值（{item.currentActorName ?? '先保存一方'}）</th>
                <th class="py-2">后到值（{item.actorName}）</th>
                <th class="py-2">采用</th>
              </tr>
            </thead>
            <tbody>
              {#each item.conflicts as conflict (conflict.field)}
                <tr class="border-b border-stone-100 align-top">
                  <td class="py-2 font-medium">{conflict.field}</td>
                  <td class="py-2">
                    <label class="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`${item.id}-${conflict.field}`}
                        checked={choiceOf(item, conflict.field) === 'current'}
                        onchange={() => setChoice(item, conflict.field, 'current')}
                        disabled={item.status !== 'pending' || busy}
                      />
                      <span class="rounded bg-emerald-50 px-2 py-1 text-emerald-800">{formatValue(conflict.currentValue)}</span>
                    </label>
                  </td>
                  <td class="py-2">
                    <label class="flex cursor-pointer items-start gap-2">
                      <input
                        type="radio"
                        name={`${item.id}-${conflict.field}`}
                        checked={choiceOf(item, conflict.field) === 'incoming'}
                        onchange={() => setChoice(item, conflict.field, 'incoming')}
                        disabled={item.status !== 'pending' || busy}
                      />
                      <span class="rounded bg-rose-50 px-2 py-1 text-rose-800">{formatValue(conflict.incomingValue)}</span>
                    </label>
                  </td>
                  <td class="py-2 text-xs">
                    {choiceOf(item, conflict.field) === 'current' ? '保留已生效' : '采用后到值'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if item.sourceMissing}
        <div class="mt-3 grid gap-2 md:grid-cols-[12rem_1fr]">
          <span class="label self-center">补填数据来源</span>
          <input
            class="field"
            value={sourceOf(item)}
            oninput={(event) => setSource(item, event.currentTarget.value)}
            placeholder="如：陆师傅 · 现场录入（确认后写回记录）"
            disabled={item.status !== 'pending' || busy}
          />
        </div>
      {/if}

      {#if item.status === 'pending'}
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="btn" disabled={busy} onclick={() => discardOne(item)}>放弃后到修改</button>
          <button type="button" class="btn-primary" disabled={busy} onclick={() => confirmOne(item)}>确认并重算</button>
        </div>
      {:else}
        <div class="muted mt-3 text-xs">
          {item.status === 'confirmed' ? `已于 ${item.resolvedAt ? timeOf(item.resolvedAt) : ''} 由 ${item.resolvedBy ?? ''} 确认` : `已由 ${item.resolvedBy ?? ''} 放弃`}
        </div>
      {/if}
    </div>
  {/each}

  {#if resolved.length > 0 && pendingOnly.length === 0}
    <p class="muted text-xs">已处理的确认 / 放弃记录保留为审计历史，不再影响数据。</p>
  {/if}
</div>
