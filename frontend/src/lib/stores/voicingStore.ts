/**
 * 整音与维修 store：维护维修履历与完成状态。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Voicing } from '$lib/types/voicing';
import {
  completeVoicing as completeVoicingRow,
  markPianoPending,
  putVoicing,
  removeVoicing,
  updateVoicing as updateVoicingRow
} from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';

export const VOICING_FILTER_KEYS = ['types', 'parts', 'states'];

/** 维修记录筛选条件 */
export const voicingFilters: Writable<FilterModel> = writable({ keyword: '', types: [], parts: [], states: [] });

export function setVoicingFilters(next: FilterModel): void {
  voicingFilters.set(next);
}

export function resetVoicingFilters(): void {
  voicingFilters.set({ keyword: '', types: [], parts: [], states: [] });
}

/** 新建维修计划：同时把钢琴置为待修 */
export async function createVoicing(payload: Omit<Voicing, 'id'>): Promise<string> {
  const row = buildRow(payload, 'voicing');
  await putVoicing(row);
  if (payload.state === '计划') {
    await markPianoPending(payload.pianoId);
  }
  return row.id;
}

export async function editVoicing(id: string, patch: Partial<Voicing>): Promise<void> {
  await updateVoicingRow(id, patch);
}

/** 完成维修：回写钢琴状态 */
export async function completeVoicing(id: string): Promise<void> {
  await completeVoicingRow(id);
}

export async function deleteVoicing(id: string): Promise<void> {
  await removeVoicing(id);
}
