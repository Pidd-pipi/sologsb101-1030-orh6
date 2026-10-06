/**
 * 调律 store：维护调律记录筛选条件与保存动作。
 *
 * 保存后由保存引擎立即重算该琴最近调律音分与复调标记、周期提醒；
 * 与另一标签页同字段冲突时，先到一方的调律记录保持已生效，后到一方登记待确认。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Tuning } from '$lib/types/tuning';
import type { TuningRow } from '$lib/utils/db';
import { deleteRecord, saveBatch, type SaveOutcome } from '$lib/utils/conflict';
import { currentActor } from '$lib/utils/client';
import type { SaveParams } from '$lib/types/edit';

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
  const outcomes = await saveBatch(currentActor(), [{ table: 'tunings', payload, idPrefix: 'tn' }]);
  return outcomes[0]?.id ?? '';
}

export async function editTuning(id: string, params: SaveParams<Omit<Tuning, 'id'>>): Promise<SaveOutcome> {
  const base = params.context?.base as TuningRow | undefined;
  const outcomes = await saveBatch(
    currentActor(),
    [
      {
        table: 'tunings',
        id,
        payload: params.payload,
        base: base as never,
        baseRevision: base?.revision,
        idPrefix: 'tn'
      }
    ],
    params.intentId
  );
  return outcomes[0] as SaveOutcome;
}

export async function deleteTuning(id: string): Promise<void> {
  await deleteRecord('tunings', id);
}
