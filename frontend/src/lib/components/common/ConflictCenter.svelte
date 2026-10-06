<script lang="ts">
  /**
   * ConflictCenter：待确认操作中心（右侧抽屉）
   *
   * - 同字段冲突：展示已生效方与待确认方的值、操作人与时间，三选一
   *   「保留已生效 / 采用待确认（覆盖，修订号 +1）/ 放弃」；
   * - 缺来源（旧数据迁移）：补填来源操作人后确认；
   * - 批量操作单事务执行，任何失败整批回滚；
   * - 已确认 / 已放弃项折叠为履历；多标签页实时同步。
   */
  import { pushNotice } from '$lib/stores/noticeStore';
  import {
    acceptIncoming,
    actorName,
    confirmSource,
    discardPending,
    keepEffective,
    pendingConflictCount,
    pendingOperations,
    resolveAll,
    updateActorName
  } from '$lib/stores/conflictStore';
  import { db, type PianoRow, type PendingOperationRow } from '$lib/utils/db';
  import { useIdbTable } from '$lib/hooks/useIdbTable';
  import { fieldLabel, formatValue, TABLE_LABELS } from '$lib/utils/labels';
  import { SOURCE_FIELD, type ConflictTable } from '$lib/types/conflict';

  let { open = false, onclose }: { open?: boolean; onclose: () => void } = $props();

  const pianos = useIdbTable<PianoRow>(db.pianos, (a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN'));

  let showResolved = $state(false);
  let busy = $state(false);
  let sourceDraft = $state<Record<string, string>>({});

  const pending = $derived($pendingOperations.filter((item) => item.state === 'pending'));
  const resolved = $derived($pendingOperations.filter((item) => item.state !== 'pending'));
  const visible = $derived(showResolved ? $pendingOperations : pending);

  function pianoLabelOf(table: ConflictTable, recordId: string, pianoId?: string): string {
    if (table === 'pianos') {
      const piano = $pianos.find((item) => item.id === recordId);
      return piano ? `${piano.brand} ${piano.model}` : '已删除的钢琴';
    }
    const id = pianoId ?? recordId;
    const piano = $pianos.find((item) => item.id === id);
    return piano ? `${piano.brand} ${piano.model}` : '钢琴已删除';
  }

  function formatTime(at: number): string {
    return new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  async function guard(action: () => Promise<void>, ok: string): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
      pushNotice(ok, 'success');
    } catch (error) {
      pushNotice(error instanceof Error ? error.message : '操作失败，已整批回滚', 'error', 6000);
    } finally {
      busy = false;
    }
  }

  function onKeep(item: PendingOperationRow): void {
    void guard(() => keepEffective(item.id), '已保留已生效内容');
  }

  function onAccept(item: PendingOperationRow): void {
    void guard(() => acceptIncoming(item.id), '已采用待确认值并立即重算');
  }

  function onDiscard(item: PendingOperationRow): void {
    void guard(() => discardPending(item.id), '已放弃待确认值');
  }

  function onConfirmSource(item: PendingOperationRow): void {
    const name = (sourceDraft[item.id] ?? $actorName).trim();
    if (!name) {
      pushNotice('请填写来源操作人', 'warn');
      return;
    }
    void guard(() => confirmSource(item.id, name), '已补齐来源');
  }

  async function keepAll(): Promise<void> {
    if (pending.length === 0) return;
    await guard(
      () => resolveAll(pending.map((item) => item.id), { choice: 'effective' }),
      `已批量处理 ${pending.length} 条（全部保留已生效值）`
    );
  }

  function onActorInput(event: Event): void {
    updateActorName((event.currentTarget as HTMLInputElement).value);
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50">
    <button type="button" class="absolute inset-0 bg-stone-900/40" aria-label="关闭待确认中心" onclick={onclose}></button>
    <aside class="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-stone-50 shadow-2xl">
      <div class="flex items-center justify-between border-b border-stone-200 bg-white px-5 py-4">
        <div>
          <h2 class="text-base font-semibold text-stone-800">待确认操作</h2>
          <p class="text-xs text-stone-500">同字段冲突保留双方值，确认前不覆盖已生效内容</p>
        </div>
        <button type="button" class="btn" onclick={onclose}>关闭</button>
      </div>

      <div class="border-b border-stone-200 bg-white px-5 py-3">
        <label class="label" for="actor-name">当前操作人（冲突记录的来源署名）</label>
        <input id="actor-name" class="field" value={$actorName} oninput={onActorInput} placeholder="如：陆师傅" />
      </div>

      <div class="flex items-center justify-between px-5 py-3 text-xs text-stone-500">
        <span>待处理 <span class="font-semibold text-rose-600">{$pendingConflictCount}</span> 条 · 履历 {resolved.length} 条</span>
        <div class="flex gap-2">
          <button type="button" class="btn" disabled={busy || pending.length === 0} onclick={keepAll}>全部保留已生效</button>
          <button type="button" class="btn" onclick={() => (showResolved = !showResolved)}>
            {showResolved ? '隐藏履历' : '显示履历'}
          </button>
        </div>
      </div>

      <div class="flex-1 space-y-3 overflow-y-auto px-5 pb-6">
        {#if visible.length === 0}
          <div class="mt-16 flex flex-col items-center gap-2 text-center text-sm text-stone-400">
            <div class="text-4xl" aria-hidden="true">✅</div>
            <div>没有待确认操作</div>
            <div class="text-xs">不同标签页保存同一字段且值不同时，会在这里等待确认。</div>
          </div>
        {:else}
          {#each visible as item (item.id)}
            {@const isSource = item.kind === 'source' || item.field === SOURCE_FIELD}
            <div class="rounded-xl border bg-white p-4 {item.state === 'pending' ? 'border-amber-300' : 'border-stone-200 opacity-75'}">
              <div class="mb-2 flex items-center justify-between gap-2">
                <div class="text-sm font-semibold text-stone-800">
                  {TABLE_LABELS[item.table]} · {pianoLabelOf(item.table, item.recordId)}
                </div>
                {#if item.state === 'pending'}
                  <span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">待确认</span>
                {:else if item.state === 'confirmed'}
                  <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">已确认</span>
                {:else}
                  <span class="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-600">已放弃</span>
                {/if}
              </div>

              <div class="mb-1 text-xs text-stone-500">
                冲突字段：{fieldLabel(item.table, item.field)}
                {#if isSource}<span class="ml-1 text-amber-600">（旧数据缺来源）</span>{/if}
              </div>

              {#if isSource}
                <div class="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
                  该记录当前来源为「{formatValue(item.effective.value)}」，请补填真实来源操作人。
                </div>
                {#if item.state === 'pending'}
                  <div class="mt-2 flex gap-2">
                    <input
                      class="field"
                      placeholder="来源操作人"
                      value={sourceDraft[item.id] ?? $actorName}
                      oninput={(e) => (sourceDraft = { ...sourceDraft, [item.id]: (e.currentTarget as HTMLInputElement).value })}
                    />
                    <button type="button" class="btn-primary whitespace-nowrap" disabled={busy} onclick={() => onConfirmSource(item)}>确认来源</button>
                  </div>
                {/if}
              {:else}
                <div class="grid grid-cols-2 gap-2 text-xs">
                  <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
                    <div class="mb-1 font-semibold text-emerald-800">已生效（先保存）</div>
                    <div class="break-all text-sm text-stone-800">{formatValue(item.effective.value)}</div>
                    <div class="mt-1 text-stone-500">{item.effective.actor} · {formatTime(item.effective.at)}</div>
                  </div>
                  <div class="rounded-lg border border-amber-300 bg-amber-50 p-2">
                    <div class="mb-1 font-semibold text-amber-800">待确认（后保存）</div>
                    <div class="break-all text-sm text-stone-800">{formatValue(item.incoming.value)}</div>
                    <div class="mt-1 text-stone-500">{item.incoming.actor} · {formatTime(item.incoming.at)}</div>
                  </div>
                </div>
                {#if item.state === 'pending'}
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button type="button" class="btn" disabled={busy} onclick={() => onKeep(item)}>保留已生效</button>
                    <button type="button" class="btn-primary" disabled={busy} onclick={() => onAccept(item)}>采用待确认（覆盖）</button>
                    <button type="button" class="btn-danger" disabled={busy} onclick={() => onDiscard(item)}>放弃</button>
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </aside>
  </div>
{/if}
