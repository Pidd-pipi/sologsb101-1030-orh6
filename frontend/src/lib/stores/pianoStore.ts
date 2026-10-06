/**
 * 钢琴 store：维护琴档列表的筛选条件与当前选中钢琴。
 * 所有写操作打包为一次批量提交（一个事务，失败整批回滚）；
 * 编辑时携带编辑前的原始行，供持久化层做字段级三方合并。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Piano } from '$lib/types/piano';
import type { PianoRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { commitBatch } from './syncStore';

/** 参与 URL 同步的筛选键 */
export const PIANO_FILTER_KEYS = ['brands', 'venues', 'states'];

/** 钢琴列表筛选条件 */
export const pianoFilters: Writable<FilterModel> = writable({ keyword: '', brands: [], venues: [], states: [] });

/** 当前选中的钢琴 id */
export const selectedPianoId: Writable<string | null> = writable(null);

export function setPianoFilters(next: FilterModel): void {
  pianoFilters.set(next);
}

export function resetPianoFilters(): void {
  pianoFilters.set({ keyword: '', brands: [], venues: [], states: [] });
}

export function selectPiano(id: string | null): void {
  selectedPianoId.set(id);
}

/** 新建琴档（一次批量提交） */
export async function createPiano(payload: Omit<Piano, 'id'>): Promise<string> {
  const row = buildRow(payload, 'piano');
  await commitBatch([{ table: 'pianos', op: 'create', payload: row as unknown as Record<string, unknown> }]);
  selectedPianoId.set(row.id);
  return row.id;
}

/**
 * 编辑琴档。
 * @param base 编辑开始时读取到的原始行（含 revision），缺省视为无并发基线
 */
export async function editPiano(id: string, patch: Partial<Piano>, base?: PianoRow | null): Promise<void> {
  const payload = { ...(base ?? { id }), ...patch, id } as unknown as Record<string, unknown>;
  await commitBatch([
    {
      table: 'pianos',
      op: 'update',
      id,
      payload,
      base: (base ?? null) as unknown as Record<string, unknown> | null
    }
  ]);
}

/** 删除琴档（级联删除调律 / 维修 / 环境 / 提醒 / 待确认，同一事务） */
export async function deletePiano(id: string): Promise<void> {
  await commitBatch([{ table: 'pianos', op: 'delete', id }]);
  selectedPianoId.update((current) => (current === id ? null : current));
}
