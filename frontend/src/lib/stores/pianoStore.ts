/**
 * 钢琴 store：维护琴档列表的筛选条件、当前选中钢琴与保存动作。
 *
 * 保存走并发保存引擎：编辑时带上打开弹窗时的整行与修订号，
 * 两个标签页同时保存时不同字段直接合并、同字段冲突登记待确认操作；
 * 一次提交在单事务内完成，任何失败整批回滚。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Piano } from '$lib/types/piano';
import type { PianoRow } from '$lib/utils/db';
import { deleteRecord, saveBatch, type SaveOutcome } from '$lib/utils/conflict';
import { currentActor } from '$lib/utils/client';
import type { SaveParams } from '$lib/types/edit';

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

/** 新建琴档（单条提交，整批单事务） */
export async function createPiano(payload: Omit<Piano, 'id'>): Promise<string> {
  const outcomes = await saveBatch(currentActor(), [{ table: 'pianos', payload, idPrefix: 'pn' }]);
  return outcomes[0]?.id ?? '';
}

/** 编辑琴档：带打开时的整行与修订号，参与三方合并 */
export async function editPiano(id: string, params: SaveParams<Omit<Piano, 'id'>>): Promise<SaveOutcome> {
  const base = params.context?.base as PianoRow | undefined;
  const outcomes = await saveBatch(
    currentActor(),
    [
      {
        table: 'pianos',
        id,
        payload: params.payload,
        base: base as never,
        baseRevision: base?.revision,
        idPrefix: 'pn'
      }
    ],
    params.intentId
  );
  return outcomes[0] as SaveOutcome;
}

/** 删除琴档（级联删除调律 / 维修 / 环境 / 提醒与待确认操作） */
export async function deletePiano(id: string): Promise<void> {
  await deleteRecord('pianos', id);
  selectedPianoId.update((current) => (current === id ? null : current));
}
