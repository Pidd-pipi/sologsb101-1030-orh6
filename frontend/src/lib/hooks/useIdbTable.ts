/**
 * Dexie 表订阅与 Svelte store 响应式封装。
 * 页面统一通过它读取 IndexedDB，避免组件内部直接触碰 Dexie 实例；
 * 写入一律走 $lib/utils/conflict 的并发保存引擎，不再由本模块构造行。
 */
import { readable, type Readable } from 'svelte/store';
import { liveQuery, type Table } from 'dexie';

export interface IdbRecord {
  id: string;
  updatedAt?: number;
}

/** 默认排序：最近更新的排前面 */
function defaultCompare<T extends IdbRecord>(a: T, b: T): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/**
 * 订阅一张 Dexie 表的全量数据（Svelte readable store）。
 * 组件里可直接用 `$rows` 自动订阅；其他标签页写入后 liveQuery 同样会推送。
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
