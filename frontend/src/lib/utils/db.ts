/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbpianotune-db，数据结构版本号 version(1) 与 upgrade() 迁移逻辑
 * - 钢琴 / 调律 / 整音维修 / 琴房环境 / 周期提醒 五张表分表存储
 * - 首次打开自动播种互相引用的演示数据（含超期琴与异常环境），保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Piano } from '$lib/types/piano';
import type { Tuning } from '$lib/types/tuning';
import type { Voicing } from '$lib/types/voicing';
import type { Environment } from '$lib/types/environment';
import type { Reminder } from '$lib/types/reminder';
import { nowIso } from './uuid';
import { seedDatabase } from './seed';

/** 数据库名 */
export const DB_NAME = 'gbpianotune-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 1;

/** 行结构修订号 */
export const ROW_REVISION = 1;

/** 带时间戳与修订号的持久化实体 */
export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type PianoRow = Piano & Revisioned;
export type TuningRow = Tuning & Revisioned;
export type VoicingRow = Voicing & Revisioned;
export type EnvironmentRow = Environment & Revisioned;
export type ReminderRow = Reminder & Revisioned;

class GbPianoTuneDatabase extends Dexie {
  pianos!: Table<PianoRow, string>;
  tunings!: Table<TuningRow, string>;
  voicings!: Table<VoicingRow, string>;
  environments!: Table<EnvironmentRow, string>;
  reminders!: Table<ReminderRow, string>;

  constructor() {
    super(DB_NAME);

    this.version(DB_SCHEMA_VERSION)
      .stores({
        pianos: 'id, brand, model, serialNo, type, venue, state, updatedAt',
        tunings: 'id, pianoId, date, technician, pitchRaised, updatedAt',
        voicings: 'id, pianoId, type, parts, state, date, updatedAt',
        environments: 'id, pianoId, date, device, abnormal, updatedAt',
        reminders: 'id, pianoId, state, nextDueDate, updatedAt'
      })
      .upgrade(async (tx) => {
        // 结构迁移：为历史行补齐行修订号与时间戳；新建库时各表为空，迁移天然幂等
        const tableNames = ['pianos', 'tunings', 'voicings', 'environments', 'reminders'];
        for (const name of tableNames) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              row.revision = ROW_REVISION;
              if (typeof row.createdAt !== 'number') row.createdAt = Date.now();
              if (typeof row.updatedAt !== 'number') row.updatedAt = row.createdAt;
            });
        }
      });
  }
}

export const db = new GbPianoTuneDatabase();

/** 打开数据库：首次使用时灌入演示数据（幂等：表非空不播） */
export async function initDatabase(): Promise<void> {
  await db.open();
  if ((await db.pianos.count()) === 0) {
    await seedDatabase();
  }
}

/* ------------------------------ 钢琴 ------------------------------ */

export async function listPianos(): Promise<PianoRow[]> {
  const rows = await db.pianos.toArray();
  return rows.sort((a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN') || a.model.localeCompare(b.model, 'zh-Hans-CN'));
}

export async function putPiano(row: PianoRow): Promise<void> {
  await db.pianos.put(row);
}

export async function updatePiano(id: string, patch: Partial<Piano>): Promise<void> {
  await db.pianos.update(id, { ...patch, updatedAt: Date.now() } as never);
}

/** 删除钢琴：级联删除其调律 / 维修 / 环境 / 提醒 */
export async function removePiano(id: string): Promise<void> {
  await db.transaction('rw', [db.pianos, db.tunings, db.voicings, db.environments, db.reminders], async () => {
    await db.tunings.where('pianoId').equals(id).delete();
    await db.voicings.where('pianoId').equals(id).delete();
    await db.environments.where('pianoId').equals(id).delete();
    await db.reminders.where('pianoId').equals(id).delete();
    await db.pianos.delete(id);
  });
}

/* ------------------------------ 调律 ------------------------------ */

export async function listTunings(): Promise<TuningRow[]> {
  const rows = await db.tunings.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function putTuning(row: TuningRow): Promise<void> {
  await db.tunings.put(row);
}

export async function updateTuning(id: string, patch: Partial<Tuning>): Promise<void> {
  await db.tunings.update(id, { ...patch, updatedAt: Date.now() } as never);
}

export async function removeTuning(id: string): Promise<void> {
  await db.tunings.delete(id);
}

/* --------------------------- 整音与维修 --------------------------- */

export async function listVoicings(): Promise<VoicingRow[]> {
  const rows = await db.voicings.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function putVoicing(row: VoicingRow): Promise<void> {
  await db.voicings.put(row);
}

export async function updateVoicing(id: string, patch: Partial<Voicing>): Promise<void> {
  await db.voicings.update(id, { ...patch, updatedAt: Date.now() } as never);
}

/** 完成维修：回写钢琴状态（全部完成则置为正常，否则置为待修） */
export async function completeVoicing(id: string): Promise<void> {
  await db.transaction('rw', [db.voicings, db.pianos], async () => {
    const voicing = await db.voicings.get(id);
    if (!voicing) throw new Error('维修记录不存在');
    await db.voicings.update(id, { state: '已完成', updatedAt: Date.now() } as never);
    const pending = await db.voicings
      .where('pianoId')
      .equals(voicing.pianoId)
      .filter((item) => item.state !== '已完成' && item.id !== id)
      .count();
    await db.pianos.update(voicing.pianoId, {
      state: pending === 0 ? '正常' : '待修',
      updatedAt: Date.now()
    } as never);
  });
}

/** 新建维修计划时把钢琴置为待修 */
export async function markPianoPending(pianoId: string): Promise<void> {
  await db.pianos.update(pianoId, { state: '待修', updatedAt: Date.now() } as never);
}

export async function removeVoicing(id: string): Promise<void> {
  await db.voicings.delete(id);
}

/* ---------------------------- 琴房环境 ---------------------------- */

export async function listEnvironments(): Promise<EnvironmentRow[]> {
  const rows = await db.environments.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function putEnvironment(row: EnvironmentRow): Promise<void> {
  await db.environments.put(row);
}

export async function updateEnvironment(id: string, patch: Partial<Environment>): Promise<void> {
  await db.environments.update(id, { ...patch, updatedAt: Date.now() } as never);
}

export async function removeEnvironment(id: string): Promise<void> {
  await db.environments.delete(id);
}

/* ---------------------------- 周期提醒 ---------------------------- */

export async function listReminders(): Promise<ReminderRow[]> {
  const rows = await db.reminders.toArray();
  return rows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

export async function putReminder(row: ReminderRow): Promise<void> {
  await db.reminders.put(row);
}

export async function updateReminder(id: string, patch: Partial<Reminder>): Promise<void> {
  await db.reminders.update(id, { ...patch, updatedAt: Date.now() } as never);
}

export async function removeReminder(id: string): Promise<void> {
  await db.reminders.delete(id);
}

/* --------------------------- 整库导入导出 --------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  pianos: Piano[];
  tunings: Tuning[];
  voicings: Voicing[];
  environments: Environment[];
  reminders: Reminder[];
}

function stripRow<T extends Revisioned>(row: T): Omit<T, keyof Revisioned> {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, keyof Revisioned>;
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [pianos, tunings, voicings, environments, reminders] = await Promise.all([
    db.pianos.toArray(),
    db.tunings.toArray(),
    db.voicings.toArray(),
    db.environments.toArray(),
    db.reminders.toArray()
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    pianos: pianos.map(stripRow),
    tunings: tunings.map(stripRow),
    voicings: voicings.map(stripRow),
    environments: environments.map(stripRow),
    reminders: reminders.map(stripRow)
  };
}

function stamp<T>(row: T): T & Revisioned {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction('rw', [db.pianos, db.tunings, db.voicings, db.environments, db.reminders], async () => {
    await Promise.all([
      db.pianos.clear(),
      db.tunings.clear(),
      db.voicings.clear(),
      db.environments.clear(),
      db.reminders.clear()
    ]);
    await db.pianos.bulkPut(snapshot.pianos.map(stamp));
    await db.tunings.bulkPut(snapshot.tunings.map(stamp));
    await db.voicings.bulkPut(snapshot.voicings.map(stamp));
    await db.environments.bulkPut(snapshot.environments.map(stamp));
    await db.reminders.bulkPut(snapshot.reminders.map(stamp));
  });
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', [db.pianos, db.tunings, db.voicings, db.environments, db.reminders], async () => {
    await Promise.all([
      db.pianos.clear(),
      db.tunings.clear(),
      db.voicings.clear(),
      db.environments.clear(),
      db.reminders.clear()
    ]);
  });
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [pianos, tunings, voicings, environments, reminders] = await Promise.all([
    db.pianos.count(),
    db.tunings.count(),
    db.voicings.count(),
    db.environments.count(),
    db.reminders.count()
  ]);
  return { pianos, tunings, voicings, environments, reminders };
}
