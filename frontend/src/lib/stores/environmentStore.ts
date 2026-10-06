/**
 * 琴房环境 store：维护温湿度记录的筛选条件与增删改动作。
 * 并发保存遵循字段级合并与待确认操作规则，单事务提交、失败整批回滚。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Environment } from '$lib/types/environment';
import type { EnvironmentRow } from '$lib/utils/db';
import { deleteRecord, saveBatch, type SaveOutcome } from '$lib/utils/conflict';
import { currentActor } from '$lib/utils/client';
import type { SaveParams } from '$lib/types/edit';

/** 参与 URL 同步的筛选键（switch 为「仅看超标记录」开关） */
export const ENVIRONMENT_FILTER_KEYS = ['pianoIds', 'switch'];

/** 环境记录筛选条件 */
export const environmentFilters: Writable<FilterModel> = writable({
  keyword: '',
  pianoIds: [],
  switch: false
});

export function setEnvironmentFilters(next: FilterModel): void {
  environmentFilters.set(next);
}

export function resetEnvironmentFilters(): void {
  environmentFilters.set({ keyword: '', pianoIds: [], switch: false });
}

export async function createEnvironment(payload: Omit<Environment, 'id'>): Promise<string> {
  const outcomes = await saveBatch(currentActor(), [{ table: 'environments', payload, idPrefix: 'en' }]);
  return outcomes[0]?.id ?? '';
}

export async function editEnvironment(id: string, params: SaveParams<Omit<Environment, 'id'>>): Promise<SaveOutcome> {
  const base = params.context?.base as EnvironmentRow | undefined;
  const outcomes = await saveBatch(
    currentActor(),
    [
      {
        table: 'environments',
        id,
        payload: params.payload,
        base: base as never,
        baseRevision: base?.revision,
        idPrefix: 'en'
      }
    ],
    params.intentId
  );
  return outcomes[0] as SaveOutcome;
}

export async function deleteEnvironment(id: string): Promise<void> {
  await deleteRecord('environments', id);
}
