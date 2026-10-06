/**
 * 调律 store：维护调律记录与批量提交动作。
 * 编辑携带原始行（base），两个标签页并发保存时由持久化层按字段合并、
 * 同字段冲突保留双方值进入待确认；提交后音分与复调标记在同一事务内立即重算。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Tuning } from '$lib/types/tuning';
import type { TuningRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { commitBatch } from './syncStore';

export const TUNING_FILTER_KEYS = ['pianoIds', 'pitchRaisedOnly'];

/** 调律记录筛选条件（含「仅看需复调」开关） */
export const tuningFilters: Writable<FilterModel> = writable({
  keyword: '',
  pianoIds: [],
  switch: false
});

export function setTuningFilters(next: FilterModel): void {
  tuningFilters.set(next);
}

export function resetTuningFilters(): void {
  tuningFilters.set({ keyword: '', pianoIds: [], switch: false });
}

/** 新建调律记录（source 为数据来源，缺失时持久化层会标待确认） */
export async function createTuning(payload: Omit<Tuning, 'id'>): Promise<string> {
  const row = buildRow(payload, 'tuning');
  await commitBatch([{ table: 'tunings', op: 'create', payload: row as unknown as Record<string, unknown> }]);
  return row.id;
}

/** 编辑调律记录：携带编辑前原始行用于并发三方合并 */
export async function editTuning(id: string, patch: Partial<Tuning>, base?: TuningRow | null): Promise<void> {
  const payload = { ...(base ?? { id }), ...patch, id } as unknown as Record<string, unknown>;
  await commitBatch([
    {
      table: 'tunings',
      op: 'update',
      id,
      payload,
      base: (base ?? null) as unknown as Record<string, unknown> | null
    }
  ]);
}

export async function deleteTuning(id: string): Promise<void> {
  await commitBatch([{ table: 'tunings', op: 'delete', id }]);
}
