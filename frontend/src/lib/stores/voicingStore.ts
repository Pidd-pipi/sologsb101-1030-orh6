/**
 * 整音与维修 store：维护维修履历、完成状态与保存动作。
 *
 * - 新建「计划」维修后，保存引擎在同一事务内把钢琴置为待修并重算派生态；
 * - 「完成」回写已完成并重算钢琴状态（无计划项则恢复正常）；
 * - 并发保存遵循字段级合并与待确认操作规则。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Voicing } from '$lib/types/voicing';
import type { VoicingRow } from '$lib/utils/db';
import { completeVoicingRecord, deleteRecord, saveBatch, type SaveOutcome } from '$lib/utils/conflict';
import { currentActor } from '$lib/utils/client';
import type { SaveParams } from '$lib/types/edit';

export const VOICING_FILTER_KEYS = ['types', 'parts', 'states'];

/** 维修记录筛选条件 */
export const voicingFilters: Writable<FilterModel> = writable({ keyword: '', types: [], parts: [], states: [] });

export function setVoicingFilters(next: FilterModel): void {
  voicingFilters.set(next);
}

export function resetVoicingFilters(): void {
  voicingFilters.set({ keyword: '', types: [], parts: [], states: [] });
}

/** 新建维修事项（计划项会在同事务内把钢琴置为待修） */
export async function createVoicing(payload: Omit<Voicing, 'id'>): Promise<string> {
  const outcomes = await saveBatch(currentActor(), [{ table: 'voicings', payload, idPrefix: 'vo' }]);
  return outcomes[0]?.id ?? '';
}

export async function editVoicing(id: string, params: SaveParams<Omit<Voicing, 'id'>>): Promise<SaveOutcome> {
  const base = params.context?.base as VoicingRow | undefined;
  const outcomes = await saveBatch(
    currentActor(),
    [
      {
        table: 'voicings',
        id,
        payload: params.payload,
        base: base as never,
        baseRevision: base?.revision,
        idPrefix: 'vo'
      }
    ],
    params.intentId
  );
  return outcomes[0] as SaveOutcome;
}

/** 完成维修：回写钢琴状态与派生态（单事务） */
export async function completeVoicing(id: string): Promise<void> {
  await completeVoicingRecord(id, currentActor());
}

export async function deleteVoicing(id: string): Promise<void> {
  await deleteRecord('voicings', id);
}
