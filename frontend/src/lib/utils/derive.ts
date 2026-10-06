/**
 * 派生态重算（纯函数 + 事务内复用）
 *
 * 调律 / 维修 / 提醒落库后，以及待确认操作被确认或放弃后，立即重算：
 * - 最近一次调律的复调标记（平均 / 最大偏差超阈值，或记录自带标记）；
 * - 周期提醒的上次调律日期、下次建议日期与状态；
 * - 钢琴状态（存在「计划」维修 → 待修，否则正常；「停用」不参与自动回写）。
 */
import type { Tuning } from '$lib/types/tuning';
import type { Reminder, ReminderState } from '$lib/types/reminder';
import { addMonths, deriveReminderState } from '$lib/types/reminder';
import { needsRepitch } from './cents';

/** 重算后提醒应有的三个字段 */
export interface RecomputedReminder {
  lastTuningDate: string;
  nextDueDate: string;
  state: ReminderState;
}

/** 某台琴最近一次调律（按日期，同日按更新时间） */
export function latestTuningOf<T extends Pick<Tuning, 'pianoId' | 'date'>>(
  tunings: T[],
  pianoId: string
): T | undefined {
  return tunings
    .filter((item) => item.pianoId === pianoId)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** 由调律记录重算复调标记 */
export function tuningNeedsRepitch(tuning: Pick<Tuning, 'pitchRaised' | 'avgDeviationCents' | 'maxDeviationCents'>): boolean {
  return tuning.pitchRaised || needsRepitch(tuning.avgDeviationCents, tuning.maxDeviationCents);
}

/**
 * 由最近一次调律重算提醒；没有调律时沿用提醒里已有的上次日期，仍无日期则返回 null。
 */
export function recomputeReminder(
  pianoId: string,
  cycleMonths: number,
  tunings: Tuning[],
  fallbackLastDate = ''
): RecomputedReminder | null {
  const last = latestTuningOf(tunings, pianoId)?.date ?? fallbackLastDate;
  if (!last) return null;
  const nextDueDate = addMonths(last, cycleMonths);
  return { lastTuningDate: last, nextDueDate, state: deriveReminderState(nextDueDate) };
}

/** 提醒是否确实需要回写（避免无意义的修订号 +1） */
export function reminderChanged(reminder: Reminder, next: RecomputedReminder): boolean {
  return (
    reminder.lastTuningDate !== next.lastTuningDate ||
    reminder.nextDueDate !== next.nextDueDate ||
    reminder.state !== next.state
  );
}
