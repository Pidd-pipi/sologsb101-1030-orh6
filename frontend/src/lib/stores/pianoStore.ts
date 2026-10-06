/**
 * 钢琴 store：维护琴档列表的筛选条件与当前选中钢琴。
 * 页面组件只读 store 并调用导出的动作函数更新，跨页状态不留在组件内部。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Piano } from '$lib/types/piano';
import type { PianoRow } from '$lib/utils/db';
import { putPiano, removePiano, updatePiano as updatePianoRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';

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

/** 新建琴档 */
export async function createPiano(payload: Omit<Piano, 'id'>): Promise<string> {
  const row = buildRow(payload, 'piano');
  await putPiano(row as PianoRow);
  selectedPianoId.set(row.id);
  return row.id;
}

export async function editPiano(id: string, patch: Partial<Piano>): Promise<void> {
  await updatePianoRow(id, patch);
}

/** 删除琴档（级联删除调律 / 维修 / 环境 / 提醒） */
export async function deletePiano(id: string): Promise<void> {
  await removePiano(id);
  selectedPianoId.update((current) => (current === id ? null : current));
}
