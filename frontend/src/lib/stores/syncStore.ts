/**
 * 协同 store：统一的提交入口与跨标签页通知。
 * 各实体 store 不直接写 IndexedDB，而是把一次操作打包成 CommitItem[] 交给 commitBatch：
 * - 持久化层保证一批一个事务、失败整批回滚；
 * - 提交成功后通过 localStorage storage 事件通知其他标签页立即重算。
 */
import { readable, writable } from 'svelte/store';
import { liveQuery } from 'dexie';
import {
  commitChanges,
  db,
  listPending,
  resolvePendingBatch,
  discardPendingBatch,
  type CommitItem,
  type CommitResult,
  type BatchResolution
} from '$lib/utils/db';
import { broadcast, currentActorId, currentActorName, onNotify, setActorName as persistActorName, type SyncEvent } from '$lib/utils/syncBus';

/** 当前标签页操作人姓名（冲突双方展示用） */
export const actorName = writable<string>(currentActorName());

export function updateActorName(name: string): void {
  persistActorName(name);
  actorName.set(currentActorName());
}

/** 数据版本号：本标签页提交或收到其他标签页通知时 +1，页面可据此强制刷新 */
export const syncPulse = writable(0);

/** 待确认数量（徽标实时展示，跨标签页自动更新） */
export const pendingCountStore = readable<number>(0, (set) => {
  const subscription = liveQuery(() => db.pendingChanges.where('status').equals('pending').count()).subscribe({
    next: (value) => set(value),
    error: (error: unknown) => console.error('订阅待确认数量失败', error)
  });
  return () => subscription.unsubscribe();
});

/** 待确认列表（待确认中心使用） */
export const pendingListStore = readable<Awaited<ReturnType<typeof listPending>>>([], (set) => {
  const subscription = liveQuery(() => listPending()).subscribe({
    next: (rows) => set(rows),
    error: (error: unknown) => console.error('订阅待确认列表失败', error)
  });
  return () => subscription.unsubscribe();
});

function bumpPulse(): void {
  syncPulse.update((value) => value + 1);
}

/**
 * 提交一批写入。任何条目失败由持久化层整批回滚并向上抛出，调用方提示后本标签页数据保持原状。
 */
export async function commitBatch(items: CommitItem[]): Promise<CommitResult> {
  const result = await commitChanges({ actorId: currentActorId(), actorName: currentActorName(), items });
  bumpPulse();
  const tables = new Set(items.map((item) => item.table));
  broadcast(Array.from(tables), result.pianoIds);
  return result;
}

/** 批量确认待确认，随后广播让其他标签页刷新（实体行由 liveQuery 自动更新） */
export async function confirmPending(items: BatchResolution[]): Promise<void> {
  const pianoId = await resolvePendingBatch(items, currentActorName());
  bumpPulse();
  broadcast(['pending'], pianoId ? [pianoId] : []);
}

/** 批量放弃待确认 */
export async function dropPending(pendingIds: string[]): Promise<void> {
  const pianoId = await discardPendingBatch(pendingIds, currentActorName());
  bumpPulse();
  broadcast(['pending'], pianoId ? [pianoId] : []);
}

/** 安装跨标签页监听（App.svelte onMount 调用一次） */
export function installSyncListener(handler?: (event: SyncEvent) => void): () => void {
  return onNotify((event) => {
    bumpPulse();
    handler?.(event);
  });
}
