/**
 * 琴房环境 store：维护温湿度记录的筛选条件与增删改动作。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Environment } from '$lib/types/environment';
import { putEnvironment, removeEnvironment, updateEnvironment as updateEnvironmentRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';

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
  const row = buildRow(payload, 'environment');
  await putEnvironment(row);
  return row.id;
}

export async function editEnvironment(id: string, patch: Partial<Environment>): Promise<void> {
  await updateEnvironmentRow(id, patch);
}

export async function deleteEnvironment(id: string): Promise<void> {
  await removeEnvironment(id);
}
