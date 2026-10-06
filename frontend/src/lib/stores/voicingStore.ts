/**
 * 整音与维修 store：维护维修履历、完成状态与批量提交动作。
 * 新建「计划」维修与把钢琴置为待修放在同一次批量提交（同一事务，失败整批回滚）；
 * 完成维修后钢琴档案状态在同一事务内立即重算。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Voicing } from '$lib/types/voicing';
import type { VoicingRow } from '$lib/utils/db';
import { completeVoicing as completeVoicingRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { commitBatch } from './syncStore';
import { broadcast, currentActorName } from '$lib/utils/syncBus';

export const VOICING_FILTER_KEYS = ['types', 'parts', 'states'];

/** 维修记录筛选条件 */
export const voicingFilters: Writable<FilterModel> = writable({ keyword: '', types: [], parts: [], states: [] });

export function setVoicingFilters(next: FilterModel): void {
  voicingFilters.set(next);
}

export function resetVoicingFilters(): void {
  voicingFilters.set({ keyword: '', types: [], parts: [], states: [] });
}

/** 新建维修计划：计划状态在同一事务内把钢琴置为待修（任一失败整批回滚） */
export async function createVoicing(payload: Omit<Voicing, 'id'>): Promise<string> {
  const row = buildRow(payload, 'voicing');
  await commitBatch([{ table: 'voicings', op: 'create', payload: row as unknown as Record<string, unknown> }]);
  // 钢琴状态由持久化层的提交后重算统一维护（计划维修 → 待修），无需单独写入
  return row.id;
}

export async function editVoicing(id: string, patch: Partial<Voicing>, base?: VoicingRow | null): Promise<void> {
  const payload = { ...(base ?? { id }), ...patch, id } as unknown as Record<string, unknown>;
  await commitBatch([
    {
      table: 'voicings',
      op: 'update',
      id,
      payload,
      base: (base ?? null) as unknown as Record<string, unknown> | null
    }
  ]);
}

/** 完成维修：回写钢琴状态（同事务立即重算）并通知其他标签页 */
export async function completeVoicing(id: string): Promise<void> {
  const pianoId = await completeVoicingRow(id, currentActorName());
  broadcast(['voicings', 'pianos', 'reminders'], pianoId ? [pianoId] : []);
}

export async function deleteVoicing(id: string): Promise<void> {
  await commitBatch([{ table: 'voicings', op: 'delete', id }]);
}
