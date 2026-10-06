/**
 * 周期提醒 store：维护调律周期、超期排序与下次建议日期推算。
 *
 * 提醒本身保存时不触发「由调律重算提醒」（避免覆盖手填周期/日期）；
 * 调律记录保存、冲突确认/放弃后由保存引擎统一重算最近调律日期、下次建议日期与状态。
 */
import { writable, type Writable } from 'svelte/store';
import type { FilterModel } from '$lib/types/filter';
import type { Reminder, ReminderState } from '$lib/types/reminder';
import { addMonths, daysToDue, deriveReminderState } from '$lib/types/reminder';
import type { ReminderRow } from '$lib/utils/db';
import { deleteRecord, saveBatch, type SaveOutcome } from '$lib/utils/conflict';
import { currentActor } from '$lib/utils/client';
import type { SaveParams } from '$lib/types/edit';

export const REMINDER_FILTER_KEYS = ['states', 'venues'];

/** 提醒筛选条件 */
export const reminderFilters: Writable<FilterModel> = writable({ keyword: '', states: [], venues: [] });

/** 超期琴数量（页脚与徽标展示） */
export const overdueCount = writable(0);

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

/** 新建提醒：缺下次日期时按周期与上次调律日期补齐 */
export async function createReminder(payload: Omit<Reminder, 'id'>): Promise<string> {
  const nextDueDate = payload.nextDueDate || computeNextDue(payload.lastTuningDate, payload.cycleMonths);
  const outcomes = await saveBatch(
    currentActor(),
    [{ table: 'reminders', payload: { ...payload, nextDueDate, state: computeState(nextDueDate) }, idPrefix: 'rm' }]
  );
  return outcomes[0]?.id ?? '';
}

/** 更新周期或上次调律日期后自动重算下次建议日期与状态 */
export async function editReminder(
  id: string,
  params: SaveParams<Omit<Reminder, 'id'>>
): Promise<SaveOutcome> {
  const payload = { ...params.payload };
  if (params.payload.lastTuningDate !== undefined || params.payload.cycleMonths !== undefined) {
    const nextDueDate = computeNextDue(params.payload.lastTuningDate ?? '', params.payload.cycleMonths ?? 6);
    payload.nextDueDate = nextDueDate;
    payload.state = computeState(nextDueDate);
  }
  const base = params.context?.base as ReminderRow | undefined;
  const outcomes = await saveBatch(
    currentActor(),
    [
      {
        table: 'reminders',
        id,
        payload,
        base: base as never,
        baseRevision: base?.revision,
        idPrefix: 'rm'
      }
    ],
    params.intentId
  );
  return outcomes[0] as SaveOutcome;
}

export async function deleteReminder(id: string): Promise<void> {
  await deleteRecord('reminders', id);
}
