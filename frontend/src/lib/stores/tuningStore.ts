/**
 * 调律 store：维护调律记录、基准音高与音分偏差派生值。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Tuning } from '$lib/types/tuning';
import { putTuning, updateTuning as updateTuningRow, removeTuning } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';

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

export async function createTuning(payload: Omit<Tuning, 'id'>): Promise<string> {
  const row = buildRow(payload, 'tuning');
  await putTuning(row);
  return row.id;
}

export async function editTuning(id: string, patch: Partial<Tuning>): Promise<void> {
  await updateTuningRow(id, patch);
}

export async function deleteTuning(id: string): Promise<void> {
  await removeTuning(id);
}
