/** 调律周期状态 */
export type ReminderState = '正常' | '临近' | '超期';

/** 调律周期提醒 */
export interface Reminder {
  id: string;
  /** 所属钢琴 */
  pianoId: string;
  /** 建议周期（月） */
  cycleMonths: number;
  /** 上次调律日期 */
  lastTuningDate: string;
  /** 下次建议日期 */
  nextDueDate: string;
  /** 周期状态 */
  state: ReminderState;
}

export const REMINDER_STATES: ReminderState[] = ['正常', '临近', '超期'];

/** 在日期上增加月数 */
export function addMonths(date: string, months: number): string {
  if (!date) return '';
  const base = new Date(`${date}T00:00:00`);
  if (Number.isNaN(base.getTime())) return '';
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
}

/** 按「下次建议日期」与今天的天数差推导周期状态：<0 超期，<=30 临近，其余正常 */
export function deriveReminderState(nextDueDate: string, today = new Date().toISOString().slice(0, 10)): ReminderState {
  if (!nextDueDate) return '正常';
  const due = new Date(`${nextDueDate}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) return '正常';
  const days = Math.round((due - now) / 86400000);
  if (days < 0) return '超期';
  if (days <= 30) return '临近';
  return '正常';
}

/** 距离下次建议日期的天数（负数表示已超期） */
export function daysToDue(nextDueDate: string, today = new Date().toISOString().slice(0, 10)): number {
  if (!nextDueDate) return 0;
  const due = new Date(`${nextDueDate}T00:00:00`).getTime();
  const now = new Date(`${today}T00:00:00`).getTime();
  if (Number.isNaN(due) || Number.isNaN(now)) return 0;
  return Math.round((due - now) / 86400000);
}

export function createEmptyReminder(): Omit<Reminder, 'id'> {
  const today = new Date().toISOString().slice(0, 10);
  return { pianoId: '', cycleMonths: 6, lastTuningDate: today, nextDueDate: addMonths(today, 6), state: '正常' };
}
