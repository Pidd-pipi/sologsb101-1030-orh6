/**
 * Dexie 表增删改查与 Svelte store 响应式订阅封装。
 * 页面统一通过它读取 IndexedDB，避免组件内部直接触碰 Dexie 实例。
 */
import { readable, type Readable } from 'svelte/store';
import { liveQuery, type Table } from 'dexie';
import { createId } from '$lib/utils/uuid';

export interface IdbRecord {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

/** 待写入的新记录（id 在前端生成；revision / 时间戳由 commitChanges 统一盖章） */
export interface DraftRow {
  id: string;
}

/** 默认排序：最近更新的排前面 */
function defaultCompare<T extends IdbRecord>(a: T, b: T): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/**
 * 订阅一张 Dexie 表的全量数据（Svelte readable store）。
 * 组件里可直接用 `$rows` 自动订阅。
 */
export function useIdbTable<T extends IdbRecord>(
  table: Table<T, string>,
  compare?: (a: T, b: T) => number
): Readable<T[]> {
  const comparator = compare ?? defaultCompare;
  return readable<T[]>([], (set) => {
    const subscription = liveQuery(async () => [...(await table.toArray())].sort(comparator)).subscribe({
      next: (rows) => set(rows as T[]),
      error: (error: unknown) => {
        console.error('订阅本地数据失败', error);
      }
    });
    return () => subscription.unsubscribe();
  });
}

/** 组装一条带前端 id 的新建记录（修订号 / 时间戳由持久化层统一补） */
export function buildRow<T extends object>(payload: T, prefix: string): T & DraftRow {
  return {
    ...payload,
    id: createId(prefix)
  } as T & DraftRow;
}
