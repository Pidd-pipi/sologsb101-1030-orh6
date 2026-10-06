/**
 * 确认 / 放弃待确认（以及任何提交）后的立即重算：
 * - 最近调律音分（avgDeviationCents / maxDeviationCents 与各音区一致）；
 * - 复调标记（pitchRaised：显式标记或超阈值）；
 * - 琴房环境超标标记（abnormal）；
 * - 钢琴档案状态（存在未完成维修则待修）；
 * - 提醒（上次调律日期、下次建议日期、周期状态）。
 *
 * 所有函数只在 Dexie 事务内调用，与写入同成败。
 */
import type { Table } from 'dexie';
import type { EnvironmentRow, PianoRow, ReminderRow, TuningRow, VoicingRow } from './db';
import { needsRepitch } from './cents';
import { isAbnormal } from '$lib/types/environment';
import { addMonths, deriveReminderState } from '$lib/types/reminder';

function avgOf(zones: { bass: number; mid: number; treble: number }): number {
  return Number(((zones.bass + zones.mid + zones.treble) / 3).toFixed(1));
}

function maxOf(zones: { bass: number; mid: number; treble: number }): number {
  const values = [zones.bass, zones.mid, zones.treble];
  return Number(values.reduce((worst, value) => (Math.abs(value) > Math.abs(worst) ? value : worst), values[0]).toFixed(1));
}

/** 重算单条调律：音分与 zones 对齐、复调标记同步 */
export async function recomputeTuningRow(table: Table<TuningRow, string>, id: string, now: number): Promise<void> {
  const row = await table.get(id);
  if (!row || !row.zones) return;
  const avgDeviationCents = avgOf(row.zones);
  const maxDeviationCents = maxOf(row.zones);
  const pitchRaised = row.pitchRaised || needsRepitch(avgDeviationCents, maxDeviationCents);
  if (
    row.avgDeviationCents !== avgDeviationCents ||
    row.maxDeviationCents !== maxDeviationCents ||
    row.pitchRaised !== pitchRaised
  ) {
    await table.update(id, { avgDeviationCents, maxDeviationCents, pitchRaised, updatedAt: now } as never);
  }
}

/** 重算单条环境记录：温湿度区间判定 */
export async function recomputeEnvironmentRow(table: Table<EnvironmentRow, string>, id: string, now: number): Promise<void> {
  const row = await table.get(id);
  if (!row) return;
  const abnormal = isAbnormal(row.tempC, row.humidityPct);
  if (row.abnormal !== abnormal) {
    await table.update(id, { abnormal, updatedAt: now } as never);
  }
}

/** 重算钢琴档案状态：有未完成维修 → 待修（停用为人工停用，不被自动改回） */
export async function recomputePianoState(
  voicings: Table<VoicingRow, string>,
  pianos: Table<PianoRow, string>,
  pianoId: string,
  now: number
): Promise<void> {
  const piano = await pianos.get(pianoId);
  if (!piano) return;
  const pendingCount = await voicings
    .where('pianoId')
    .equals(pianoId)
    .filter((item) => item.state !== '已完成')
    .count();
  const state = piano.state === '停用' ? '停用' : pendingCount > 0 ? '待修' : '正常';
  if (piano.state !== state) {
    await pianos.update(pianoId, { state, updatedAt: now } as never);
  }
}

/**
 * 重算某台琴的周期提醒：最近调律日期 → 下次建议日期 → 周期状态。
 * lastTuningDate 单调向前：新录入更晚的调律才推进，手填日期与回填的较早调律不回退。
 */
export async function recomputeReminderForPiano(
  tunings: Table<TuningRow, string>,
  reminders: Table<ReminderRow, string>,
  pianoId: string,
  now: number
): Promise<void> {
  const reminder = await reminders.where('pianoId').equals(pianoId).first();
  if (!reminder) return;
  const latest = await tunings
    .where('pianoId')
    .equals(pianoId)
    .sortBy('date');
  const latestTuningDate = latest.length > 0 ? latest[latest.length - 1].date : '';
  const lastTuningDate =
    latestTuningDate && latestTuningDate > reminder.lastTuningDate ? latestTuningDate : reminder.lastTuningDate;
  const nextDueDate = addMonths(lastTuningDate, reminder.cycleMonths) || reminder.nextDueDate;
  const state = deriveReminderState(nextDueDate);
  if (
    reminder.lastTuningDate !== lastTuningDate ||
    reminder.nextDueDate !== nextDueDate ||
    reminder.state !== state
  ) {
    await reminders.update(reminder.id, { lastTuningDate, nextDueDate, state, updatedAt: now } as never);
  }
}

/** 一台琴的全量重算：调律音分 → 复调 → 钢琴状态 → 提醒（在调用方事务内执行） */
export async function recomputePiano(
  tables: {
    pianos: Table<PianoRow, string>;
    tunings: Table<TuningRow, string>;
    voicings: Table<VoicingRow, string>;
    environments: Table<EnvironmentRow, string>;
    reminders: Table<ReminderRow, string>;
  },
  pianoId: string,
  now: number
): Promise<void> {
  const tuningRows = await tables.tunings.where('pianoId').equals(pianoId).toArray();
  for (const row of tuningRows) {
    await recomputeTuningRow(tables.tunings, row.id, now);
  }
  const environmentRows = await tables.environments.where('pianoId').equals(pianoId).toArray();
  for (const row of environmentRows) {
    await recomputeEnvironmentRow(tables.environments, row.id, now);
  }
  await recomputePianoState(tables.voicings, tables.pianos, pianoId, now);
  await recomputeReminderForPiano(tables.tunings, tables.reminders, pianoId, now);
}
