/**
 * IndexedDB 持久化层（Dexie 封装）
 *
 * - 数据库名 gbpianotune-db，结构版本 v2（v1→v2 带 upgrade() 迁移）；
 * - 钢琴 / 调律 / 整音维修 / 琴房环境 / 周期提醒 五张业务表 + pendingOperations 待确认操作表；
 * - 每行带 revision 行修订号、createdAt / updatedAt、source 来源操作人；
 * - v1 历史行迁移时自动补修订号与时间戳；缺来源的行自动登记「待确认来源」，
 *   登记带确定性 intentId，迁移重试 / 重复执行不会产生重复待确认操作；
 * - 首次打开自动播种演示数据（幂等：表非空不播）。
 */
import Dexie, { type Table } from 'dexie';
import type { Piano } from '$lib/types/piano';
import type { Tuning } from '$lib/types/tuning';
import type { Voicing } from '$lib/types/voicing';
import type { Environment } from '$lib/types/environment';
import type { Reminder } from '$lib/types/reminder';
import {
  CONFLICT_TABLES,
  SOURCE_FIELD,
  type ConflictTable,
  type PendingOperation
} from '$lib/types/conflict';
import { createId, nowIso } from './uuid';
import { currentActorName } from './client';
import { seedDatabase } from './seed';

/** 数据库名 */
export const DB_NAME = 'gbpianotune-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

/** 行结构修订号初始值 */
export const ROW_REVISION = 1;

/** 迁移行缺来源时的兜底来源名 */
export const UNKNOWN_SOURCE = '来源待确认';

/** 播种演示数据的来源标注 */
export const SEED_SOURCE = '演示数据';

/** 带修订号、时间戳与来源操作人的持久化实体 */
export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** 最近一次改动的操作人（调律师 / 操作人 / 当前编辑人） */
  source: string;
  /** 最近一次改动所在标签页 id（冲突台账里区分双方） */
  lastClientId: string;
}

export type PianoRow = Piano & Revisioned;
export type TuningRow = Tuning & Revisioned;
export type VoicingRow = Voicing & Revisioned;
export type EnvironmentRow = Environment & Revisioned;
export type ReminderRow = Reminder & Revisioned;

/** 待确认操作持久化行（自身的修订元信息直接复用 createdAt / updatedAt） */
export type PendingOperationRow = PendingOperation;

/** 任一业务行 */
export type AnyBusinessRow = PianoRow | TuningRow | VoicingRow | EnvironmentRow | ReminderRow;

class GbPianoTuneDatabase extends Dexie {
  pianos!: Table<PianoRow, string>;
  tunings!: Table<TuningRow, string>;
  voicings!: Table<VoicingRow, string>;
  environments!: Table<EnvironmentRow, string>;
  reminders!: Table<ReminderRow, string>;
  pendingOperations!: Table<PendingOperationRow, string>;

  constructor() {
    super(DB_NAME);

    // v1（历史结构）：保留声明以便老库平滑升级
    this.version(1).stores({
      pianos: 'id, brand, model, serialNo, type, venue, state, updatedAt',
      tunings: 'id, pianoId, date, technician, pitchRaised, updatedAt',
      voicings: 'id, pianoId, type, parts, state, date, updatedAt',
      environments: 'id, pianoId, date, device, abnormal, updatedAt',
      reminders: 'id, pianoId, state, nextDueDate, updatedAt'
    });

    // v2：业务表结构不变（source 非索引字段），新增 pendingOperations 待确认操作表
    this.version(2)
      .stores({
        pianos: 'id, brand, model, serialNo, type, venue, state, updatedAt',
        tunings: 'id, pianoId, date, technician, pitchRaised, updatedAt',
        voicings: 'id, pianoId, type, parts, state, date, updatedAt',
        environments: 'id, pianoId, date, device, abnormal, updatedAt',
        reminders: 'id, pianoId, state, nextDueDate, updatedAt',
        pendingOperations: 'id, table, recordId, state, kind, intentId, updatedAt'
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        const actorName = currentActorName();
        const missingSource: Array<{ table: ConflictTable; recordId: string; at: number }> = [];

        for (const name of CONFLICT_TABLES) {
          const table = tx.table(name);
          await table.toCollection().modify((row: Record<string, unknown>) => {
            let touchedAt = now;
            if (typeof row.revision !== 'number' || row.revision < 1) row.revision = ROW_REVISION;
            if (typeof row.createdAt !== 'number') {
              row.createdAt = typeof row.updatedAt === 'number' ? row.updatedAt : now;
            }
            if (typeof row.updatedAt !== 'number') {
              row.updatedAt = row.createdAt as number;
            }
            touchedAt = row.updatedAt as number;
            if (typeof row.source !== 'string' || row.source.length === 0) {
              row.source = UNKNOWN_SOURCE;
              if (typeof row.id === 'string') {
                missingSource.push({ table: name, recordId: row.id, at: touchedAt });
              }
            }
            if (typeof row.lastClientId !== 'string' || row.lastClientId.length === 0) {
              row.lastClientId = 'migration';
            }
          });
        }

        // 缺来源 → 登记待确认操作；确定性 intentId 保证重复迁移不产生重复登记
        if (missingSource.length > 0) {
          const pendingTable = tx.table('pendingOperations');
          const existing = new Set(
            (await pendingTable.toArray()).map((item: Record<string, unknown>) => String(item.intentId))
          );
          const toAdd: PendingOperationRow[] = [];
          missingSource.forEach(({ table, recordId, at }) => {
            const intentId = `src-${table}-${recordId}`;
            if (existing.has(intentId)) return;
            existing.add(intentId);
            toAdd.push({
              id: createId('cf'),
              kind: 'source',
              state: 'pending',
              table,
              recordId,
              field: SOURCE_FIELD,
              effective: { value: UNKNOWN_SOURCE, atRevision: ROW_REVISION, actor: UNKNOWN_SOURCE, clientId: 'migration', at },
              incoming: { value: '', atRevision: ROW_REVISION, actor: actorName, clientId: 'migration', at },
              intentId,
              createdAt: now,
              updatedAt: now
            });
          });
          if (toAdd.length > 0) await pendingTable.bulkAdd(toAdd);
        }
      });
  }
}

export const db = new GbPianoTuneDatabase();

/** 按表名取业务表（冲突引擎统一入口） */
export function tableOf(name: ConflictTable): Table<AnyBusinessRow, string> {
  switch (name) {
    case 'pianos':
      return db.pianos as Table<AnyBusinessRow, string>;
    case 'tunings':
      return db.tunings as Table<AnyBusinessRow, string>;
    case 'voicings':
      return db.voicings as Table<AnyBusinessRow, string>;
    case 'environments':
      return db.environments as Table<AnyBusinessRow, string>;
    case 'reminders':
      return db.reminders as Table<AnyBusinessRow, string>;
  }
}

/** 新建一行：补 id / 修订号 / 时间戳 / 来源 */
export function stampNew<T extends object>(payload: T, prefix: string, source: string, clientId = 'local'): T & Revisioned & { id: string } {
  const now = Date.now();
  return {
    ...payload,
    id: createId(prefix),
    revision: ROW_REVISION,
    createdAt: now,
    updatedAt: now,
    source,
    lastClientId: clientId
  } as T & Revisioned & { id: string };
}

/** 打开数据库：首次使用时灌入演示数据（幂等：表非空不播） */
export async function initDatabase(): Promise<void> {
  await db.open();
  if ((await db.pianos.count()) === 0) {
    await seedDatabase();
  }
}

/* ------------------------------ 只读列表 ------------------------------ */

export async function listPianos(): Promise<PianoRow[]> {
  const rows = await db.pianos.toArray();
  return rows.sort((a, b) => a.brand.localeCompare(b.brand, 'zh-Hans-CN') || a.model.localeCompare(b.model, 'zh-Hans-CN'));
}

export async function listTunings(): Promise<TuningRow[]> {
  const rows = await db.tunings.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function listVoicings(): Promise<VoicingRow[]> {
  const rows = await db.voicings.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function listEnvironments(): Promise<EnvironmentRow[]> {
  const rows = await db.environments.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function listReminders(): Promise<ReminderRow[]> {
  const rows = await db.reminders.toArray();
  return rows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
}

/* --------------------------- 整库导入导出 --------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  pianos: PianoRow[];
  tunings: TuningRow[];
  voicings: VoicingRow[];
  environments: EnvironmentRow[];
  reminders: ReminderRow[];
  /** 待确认操作随备份一起迁移，确认进度不丢失 */
  pendingOperations: PendingOperationRow[];
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [pianos, tunings, voicings, environments, reminders, pendingOperations] = await Promise.all([
    db.pianos.toArray(),
    db.tunings.toArray(),
    db.voicings.toArray(),
    db.environments.toArray(),
    db.reminders.toArray(),
    db.pendingOperations.toArray()
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    pianos,
    tunings,
    voicings,
    environments,
    reminders,
    pendingOperations
  };
}

/** 导入行补齐修订元信息；返回 { row, missingSource } */
function normalizeImportedRow<T>(raw: T, fallbackIdPrefix: string, now: number): { row: T & Revisioned & { id: string }; missingSource: boolean } {
  const candidate = raw as Partial<Revisioned> & { id?: string };
  const id = typeof candidate.id === 'string' && candidate.id ? candidate.id : createId(fallbackIdPrefix);
  const revision = typeof candidate.revision === 'number' && candidate.revision > 0 ? candidate.revision : ROW_REVISION;
  const createdAt = typeof candidate.createdAt === 'number' ? candidate.createdAt : now;
  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : createdAt;
  const hasSource = typeof candidate.source === 'string' && candidate.source.length > 0;
  const row = {
    ...(raw as object),
    id,
    revision,
    createdAt,
    updatedAt,
    source: hasSource ? (candidate.source as string) : UNKNOWN_SOURCE,
    lastClientId: typeof candidate.lastClientId === 'string' && candidate.lastClientId ? candidate.lastClientId : 'import'
  } as T & Revisioned & { id: string };
  return { row, missingSource: !hasSource };
}

function normalizePending(raw: PendingOperationRow, now: number): PendingOperationRow | null {
  if (!raw || typeof raw.recordId !== 'string' || typeof raw.table !== 'string') return null;
  if (!CONFLICT_TABLES.includes(raw.table as ConflictTable)) return null;
  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId('cf'),
    state: raw.state === 'confirmed' || raw.state === 'discarded' ? raw.state : 'pending',
    kind: raw.kind === 'source' ? 'source' : 'field',
    field: typeof raw.field === 'string' ? raw.field : '',
    intentId: typeof raw.intentId === 'string' && raw.intentId ? raw.intentId : createId('intent'),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now
  };
}

/**
 * 整库导入：清空 → 规范化写入 → 为缺来源行补登待确认操作。
 * 全程单事务：任何一行失败整批回滚，库恢复到导入前状态。
 */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  const now = Date.now();
  await db.transaction(
    'rw',
    [db.pianos, db.tunings, db.voicings, db.environments, db.reminders, db.pendingOperations],
    async () => {
      await Promise.all([
        db.pianos.clear(),
        db.tunings.clear(),
        db.voicings.clear(),
        db.environments.clear(),
        db.reminders.clear(),
        db.pendingOperations.clear()
      ]);

      const sourcePendings: PendingOperationRow[] = [];
      const seenIntent = new Set<string>();

      const load = async <R>(
        table: Table<R & Revisioned & { id: string }, string>,
        raws: unknown,
        prefix: string,
        tableName: ConflictTable
      ): Promise<void> => {
        if (!Array.isArray(raws)) throw new Error(`备份中 ${tableName} 必须是数组`);
        const rows: Array<R & Revisioned & { id: string }> = [];
        raws.forEach((raw) => {
          const { row, missingSource } = normalizeImportedRow<R>(raw as R, prefix, now);
          rows.push(row);
          if (missingSource) {
            const intentId = `src-${tableName}-${row.id}`;
            if (!seenIntent.has(intentId)) {
              seenIntent.add(intentId);
              sourcePendings.push({
                id: createId('cf'),
                kind: 'source',
                state: 'pending',
                table: tableName,
                recordId: row.id,
                field: SOURCE_FIELD,
                effective: { value: UNKNOWN_SOURCE, atRevision: row.revision, actor: UNKNOWN_SOURCE, clientId: 'import', at: now },
                incoming: { value: '', atRevision: row.revision, actor: currentActorName(), clientId: 'import', at: now },
                intentId,
                createdAt: now,
                updatedAt: now
              });
            }
          }
        });
        await table.bulkPut(rows);
      };

      await load<Piano>(db.pianos as Table<Piano & Revisioned & { id: string }, string>, snapshot.pianos, 'pn', 'pianos');
      await load<Tuning>(db.tunings as Table<Tuning & Revisioned & { id: string }, string>, snapshot.tunings, 'tn', 'tunings');
      await load<Voicing>(db.voicings as Table<Voicing & Revisioned & { id: string }, string>, snapshot.voicings, 'vo', 'voicings');
      await load<Environment>(db.environments as Table<Environment & Revisioned & { id: string }, string>, snapshot.environments, 'en', 'environments');
      await load<Reminder>(db.reminders as Table<Reminder & Revisioned & { id: string }, string>, snapshot.reminders, 'rm', 'reminders');

      const pendings = Array.isArray(snapshot.pendingOperations)
        ? snapshot.pendingOperations
            .map((item) => normalizePending(item, now))
            .filter((item): item is PendingOperationRow => item !== null)
        : [];
      pendings.forEach((item) => {
        if (!seenIntent.has(item.intentId)) {
          seenIntent.add(item.intentId);
          sourcePendings.push(item);
        }
      });
      await db.pendingOperations.bulkPut(sourcePendings);
    }
  );
}

/** 清空全部数据并重新灌入演示数据（同样在单事务内，失败不留半成品） */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.pianos, db.tunings, db.voicings, db.environments, db.reminders, db.pendingOperations],
    async () => {
      await Promise.all([
        db.pianos.clear(),
        db.tunings.clear(),
        db.voicings.clear(),
        db.environments.clear(),
        db.reminders.clear(),
        db.pendingOperations.clear()
      ]);
    }
  );
  await seedDatabase();
}

/** 各表行数统计（pending 为待确认操作条数） */
export async function countAll(): Promise<Record<string, number>> {
  const [pianos, tunings, voicings, environments, reminders, pending] = await Promise.all([
    db.pianos.count(),
    db.tunings.count(),
    db.voicings.count(),
    db.environments.count(),
    db.reminders.count(),
    db.pendingOperations.where('state').equals('pending').count()
  ]);
  return { pianos, tunings, voicings, environments, reminders, pending };
}
