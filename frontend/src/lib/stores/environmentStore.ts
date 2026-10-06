/**
 * 琴房环境 store：维护温湿度记录筛选条件与批量提交动作。
 * 提交后超标标记在同一事务内按温湿度区间立即重算。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Environment } from '$lib/types/environment';
import type { EnvironmentRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { commitBatch } from './syncStore';

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
  await commitBatch([{ table: 'environments', op: 'create', payload: row as unknown as Record<string, unknown> }]);
  return row.id;
}

export async function editEnvironment(
  id: string,
  patch: Partial<Environment>,
  base?: EnvironmentRow | null
): Promise<void> {
  const payload = { ...(base ?? { id }), ...patch, id } as unknown as Record<string, unknown>;
  await commitBatch([
    {
      table: 'environments',
      op: 'update',
      id,
      payload,
      base: (base ?? null) as unknown as Record<string, unknown> | null
    }
  ]);
}

export async function deleteEnvironment(id: string): Promise<void> {
  await commitBatch([{ table: 'environments', op: 'delete', id }]);
}
