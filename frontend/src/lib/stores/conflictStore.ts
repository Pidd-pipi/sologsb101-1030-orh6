/**
 * 待确认操作 store：订阅 pendingOperations，提供确认 / 放弃动作。
 *
 * - pendingOperations 实时订阅（liveQuery），多标签页下任一处处理后其余标签页立即同步；
 * - 确认 / 放弃后保存引擎立即重算钢琴档案、最近调律音分、复调标记与提醒；
 * - 单条或批量都在单事务内执行，失败整批回滚。
 */
import { derived, readable, writable, type Readable, type Writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import { db, type PendingOperationRow } from '$lib/utils/db';
import { resolveMany, resolvePending, type ResolveOptions } from '$lib/utils/conflict';
import { currentActorName, setActorName } from '$lib/utils/client';

/** 全部待确认操作（已确认 / 已放弃也保留，用于履历，最近更新在前） */
export const pendingOperations: Readable<PendingOperationRow[]> = readable<PendingOperationRow[]>([], (set) => {
  const live = liveQuery(() => db.pendingOperations.orderBy('updatedAt').reverse().toArray()).subscribe({
    next: (rows) => set(rows),
    error: (error: unknown) => console.error('订阅待确认操作失败', error)
  });
  return () => live.unsubscribe();
});

/** 待处理条数（全局角标） */
export const pendingConflictCount: Readable<number> = derived(pendingOperations, (list) =>
  list.filter((item) => item.state === 'pending').length
);

/** 当前操作人姓名（跨标签页共享的 localStorage） */
export const actorName: Writable<string> = writable(currentActorName());

export function updateActorName(name: string): void {
  setActorName(name);
  actorName.set(currentActorName());
}

/** 确认采用已生效值（待确认值作废） */
export async function keepEffective(id: string): Promise<void> {
  await resolvePending(id, { choice: 'effective' });
}

/** 确认采用待确认方的值（覆盖已生效内容，修订号 +1）；source 类用 sourceName 补来源 */
export async function acceptIncoming(id: string, valueOverride?: unknown, sourceName?: string): Promise<void> {
  const options: ResolveOptions = { choice: 'incoming' };
  if (valueOverride !== undefined) options.valueOverride = valueOverride;
  if (sourceName) options.sourceName = sourceName;
  await resolvePending(id, options);
}

/** 放弃待确认值（不覆盖已生效内容） */
export async function discardPending(id: string): Promise<void> {
  await resolvePending(id, { choice: 'effective' });
}

/** 补齐来源（旧数据迁移的缺来源待确认） */
export async function confirmSource(id: string, sourceName: string): Promise<void> {
  await resolvePending(id, { choice: 'incoming', sourceName });
}

/** 批量处理（单事务，任何一条失败整批回滚，不产生半确认状态） */
export async function resolveAll(ids: string[], options: ResolveOptions): Promise<void> {
  await resolveMany(ids, options);
}
