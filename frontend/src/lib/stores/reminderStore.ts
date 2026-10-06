/**
 * 周期提醒 store：维护调律周期、超期排序与批量提交动作。
 * 更新周期 / 上次调律日期后，下次建议日期与状态由持久化层提交后立即重算；
 * 调律记录变化也会在同一事务内联动重算提醒。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Reminder } from '$lib/types/reminder';
import { addMonths, daysToDue, deriveReminderState, type ReminderState } from '$lib/types/reminder';
import type { ReminderRow } from '$lib/utils/db';
import { buildRow } from '$lib/hooks/useIdbTable';
import { commitBatch } from './syncStore';

export const REMINDER_FILTER_KEYS = ['states', 'venues'];

/** 提醒筛选条件 */
export const reminderFilters: Writable<FilterModel> = writable({ keyword: '', states: [], venues: [] });

export function setReminderFilters(next: FilterModel): void {
  reminderFilters.set(next);
}

export function resetReminderFilters(): void {
  reminderFilters.set({ keyword: '', states: [], venues: [] });
}

/** 由周期与上次调律日期推算下次建议日期 */
export function computeNextDue(lastTuningDate: string, cycleMonths: number): string {
  return addMonths(lastTuningDate, cycleMonths);
}

/** 重新计算某条提醒的状态 */
export function computeState(nextDueDate: string): ReminderState {
  return deriveReminderState(nextDueDate);
}

/** 超期优先排序：超期 → 临近 → 正常，其次按剩余天数升序 */
export function sortByUrgency<T extends { state: ReminderState; nextDueDate: string }>(list: T[]): T[] {
  const weight: Record<ReminderState, number> = { 超期: 0, 临近: 1, 正常: 2 };
  return [...list].sort(
    (a, b) => weight[a.state] - weight[b.state] || daysToDue(a.nextDueDate) - daysToDue(b.nextDueDate)
  );
}

export async function createReminder(payload: Omit<Reminder, 'id'>): Promise<string> {
  const nextDueDate = payload.nextDueDate || computeNextDue(payload.lastTuningDate, payload.cycleMonths);
  const row = buildRow({ ...payload, nextDueDate, state: computeState(nextDueDate) }, 'reminder');
  await commitBatch([{ table: 'reminders', op: 'create', payload: row as unknown as Record<string, unknown> }]);
  return row.id;
}

/** 更新周期或上次调律日期：同步推算下次建议日期与状态后整行提交 */
export async function editReminder(id: string, patch: Partial<Reminder>, base?: ReminderRow | null): Promise<void> {
  const next: Partial<Reminder> = { ...patch };
  if (patch.lastTuningDate !== undefined || patch.cycleMonths !== undefined) {
    const cycle = patch.cycleMonths ?? base?.cycleMonths ?? 6;
    const last = patch.lastTuningDate ?? base?.lastTuningDate ?? '';
    const nextDueDate = computeNextDue(last, cycle);
    next.nextDueDate = nextDueDate;
    next.state = computeState(nextDueDate);
  }
  const payload = { ...(base ?? { id }), ...next, id } as unknown as Record<string, unknown>;
  await commitBatch([
    {
      table: 'reminders',
      op: 'update',
      id,
      payload,
      base: (base ?? null) as unknown as Record<string, unknown> | null
    }
  ]);
}

export async function deleteReminder(id: string): Promise<void> {
  await commitBatch([{ table: 'reminders', op: 'delete', id }]);
}
