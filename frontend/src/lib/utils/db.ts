/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbpianotune-db，结构版本 v2：
 *   v1：五张实体表，upgrade 为历史行补齐行修订号与时间戳；
 *   v2：新增 pendingChanges 待确认表；历史行自动补版本，缺来源的调律 / 维修先标待确认。
 * - 所有写操作走 commitChanges()：同一批写入一个事务，任何失败整批回滚；
 * - 并发保存按字段三方合并，同字段冲突保留双方值与操作人进入待确认，确认前不覆盖已生效内容；
 * - 确认 / 放弃后在同一事务内立即重算钢琴档案、最近调律音分、复调标记与提醒。
 */
import Dexie, { type Table } from 'dexie';
import type { Piano } from '$lib/types/piano';
import type { Tuning } from '$lib/types/tuning';
import type { Voicing } from '$lib/types/voicing';
import type { Environment } from '$lib/types/environment';
import type { Reminder } from '$lib/types/reminder';
import type { PendingChange, PendingChangeRow } from '$lib/types/pending';
import { nowIso, createId } from './uuid';
import { seedDatabase } from './seed';
import {
  ENTITY_TABLES,
  ROW_REVISION,
  migrationStamp,
  stamp,
  type EntityTable,
  type Revisioned
} from './syncBus';
import { ENTITY_FIELDS, pianoIdOf } from './entityFields';
import { threeWayMerge, toIncomingPayload } from './merge';
import { recomputePiano, recomputeEnvironmentRow, recomputeTuningRow } from './recompute';

/** 数据库名 */
export const DB_NAME = 'gbpianotune-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

export { ROW_REVISION } from './syncBus';
export type { Revisioned } from './syncBus';

/** 带时间戳 / 修订号 / 最后操作人的持久化实体 */
export type PianoRow = Piano & Revisioned & { updatedBy?: string };
export type TuningRow = Tuning & Revisioned & { updatedBy?: string };
export type VoicingRow = Voicing & Revisioned & { updatedBy?: string };
export type EnvironmentRow = Environment & Revisioned & { updatedBy?: string };
export type ReminderRow = Reminder & Revisioned & { updatedBy?: string };

class GbPianoTuneDatabase extends Dexie {
  pianos!: Table<PianoRow, string>;
  tunings!: Table<TuningRow, string>;
  voicings!: Table<VoicingRow, string>;
  environments!: Table<EnvironmentRow, string>;
  reminders!: Table<ReminderRow, string>;
  pendingChanges!: Table<PendingChangeRow, string>;

  constructor() {
    super(DB_NAME);

    // v1：五张实体表（保留旧版本声明以便老库逐级 upgrade）
    this.version(1).stores({
      pianos: 'id, brand, model, serialNo, type, venue, state, updatedAt',
      tunings: 'id, pianoId, date, technician, pitchRaised, updatedAt',
      voicings: 'id, pianoId, type, parts, state, date, updatedAt',
      environments: 'id, pianoId, date, device, abnormal, updatedAt',
      reminders: 'id, pianoId, state, nextDueDate, updatedAt'
    });

    // v2：新增待确认表；实体表索引不变
    this.version(2).stores({
      pianos: 'id, brand, model, serialNo, type, venue, state, updatedAt',
      tunings: 'id, pianoId, date, technician, pitchRaised, updatedAt',
      voicings: 'id, pianoId, type, parts, state, date, updatedAt',
      environments: 'id, pianoId, date, device, abnormal, updatedAt',
      reminders: 'id, pianoId, state, nextDueDate, updatedAt',
      pendingChanges: 'id, table, recordId, pianoId, status, kind, createdAt'
    });
  }
}

export const db = new GbPianoTuneDatabase();

/** 所有事务用到的表（实体表 + 待确认表） */
const ALL_TABLES = [
  db.pianos,
  db.tunings,
  db.voicings,
  db.environments,
  db.reminders,
  db.pendingChanges
] as const;

/** 打开数据库后执行的历史数据迁移：补版本、缺来源标待确认（upgrade 与每次启动双保险，幂等） */
async function migrateLegacyRows(): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', ALL_TABLES, async () => {
    for (const name of ENTITY_TABLES) {
      const table = db[name] as unknown as Table<Record<string, unknown>, string>;
      await table.toCollection().modify((row) => {
        const stamped = migrationStamp(row as Record<string, unknown>, now);
        Object.keys(stamped).forEach((key) => {
          (row as Record<string, unknown>)[key] = stamped[key];
        });
        // 调律 / 维修缺来源：先补为空串并生成待确认（确定性 id，重试不重复）
        if ((name === 'tunings' || name === 'voicings') && typeof row.source !== 'string') {
          row.source = '';
        }
      });
    }
    for (const name of ['tunings', 'voicings'] as const) {
      const missingRows: Array<{ id: string; pianoId: string; revision: number }> =
        name === 'tunings'
          ? await db.tunings
              .toCollection()
              .filter((row) => row.source === '')
              .toArray()
              .then((rows) => rows.map((row) => ({ id: row.id, pianoId: row.pianoId, revision: row.revision })))
          : await db.voicings
              .toCollection()
              .filter((row) => row.source === '')
              .toArray()
              .then((rows) => rows.map((row) => ({ id: row.id, pianoId: row.pianoId, revision: row.revision })));
      for (const row of missingRows) {
        const pid = `pd-${name}-${row.id}`;
        const existing = await db.pendingChanges.get(pid);
        if (existing) continue;
        const full =
          name === 'tunings'
            ? ((await db.tunings.get(row.id)) as unknown as Record<string, unknown>)
            : ((await db.voicings.get(row.id)) as unknown as Record<string, unknown>);
        await db.pendingChanges.put({
          id: pid,
          table: name,
          recordId: row.id,
          pianoId: row.pianoId,
          kind: 'source',
          op: 'update',
          reason: 'missing-source',
          conflicts: [],
          incoming: toIncomingPayload(full, ENTITY_FIELDS[name]),
          baseRevision: row.revision,
          status: 'pending',
          actorId: 'legacy-migration',
          actorName: '旧数据迁移',
          sourceMissing: true,
          source: '',
          createdAt: now
        } satisfies PendingChange);
      }
    }
  });
}

/** 打开数据库：迁移历史数据；首次使用时灌入演示数据（幂等：表非空不播） */
export async function initDatabase(): Promise<void> {
  await db.open();
  await migrateLegacyRows();
  if ((await db.pianos.count()) === 0) {
    await seedDatabase();
  }
}

/* ------------------------- 批量提交（合并 / 冲突） ------------------------- */

export interface CommitItem {
  table: EntityTable;
  op: 'create' | 'update' | 'delete';
  /** create / update 的完整行 */
  payload?: Record<string, unknown>;
  /** update / delete 的记录 id */
  id?: string;
  /** 编辑开始时读取到的原始行（含修订号），用于三方合并与并发检测 */
  base?: Record<string, unknown> | null;
}

export interface CommitBatch {
  actorId: string;
  actorName: string;
  items: CommitItem[];
}

export interface CommitResult {
  /** 受影响、需要重算 / 广播的钢琴 id */
  pianoIds: string[];
  /** 本次提交产生或更新的待确认 id（同记录冲突复用同一 id，重试不重复） */
  pendingIds: string[];
}

const ID_PREFIX: Record<EntityTable, string> = {
  pianos: 'piano',
  tunings: 'tuning',
  voicings: 'voicing',
  environments: 'environment',
  reminders: 'reminder'
};

function asRecord(row: unknown): Record<string, unknown> {
  return (row ?? {}) as Record<string, unknown>;
}

/** 一次提交一个事务，任何条目失败整批回滚 */
export async function commitChanges(batch: CommitBatch): Promise<CommitResult> {
  const pianoIds = new Set<string>();
  const pendingIds: string[] = [];

  await db.transaction('rw', ALL_TABLES, async () => {
    const now = Date.now();

    for (const item of batch.items) {
      const table = db[item.table] as unknown as Table<Record<string, unknown>, string>;

      if (item.op === 'delete') {
        if (!item.id) throw new Error('删除操作缺少记录 id');
        const existing = await table.get(item.id);
        if (!existing) throw new Error('要删除的记录已不存在（可能已被其他标签页删除）');
        pianoIds.add(pianoIdOf(item.table, existing as unknown as Record<string, unknown>));
        if (item.table === 'pianos') {
          // 删除钢琴级联删除其全部下属记录与待确认
          await db.tunings.where('pianoId').equals(item.id).delete();
          await db.voicings.where('pianoId').equals(item.id).delete();
          await db.environments.where('pianoId').equals(item.id).delete();
          await db.reminders.where('pianoId').equals(item.id).delete();
          await db.pendingChanges.where('pianoId').equals(item.id).delete();
        } else {
          await db.pendingChanges.where('recordId').equals(item.id).delete();
        }
        await table.delete(item.id);
        continue;
      }

      if (!item.payload) throw new Error(`${item.op === 'create' ? '新建' : '更新'}操作缺少提交内容`);
      const payload = { ...item.payload };

      if (item.op === 'create') {
        const id = String(payload.id || createId(ID_PREFIX[item.table]));
        payload.id = id;

        // 调律 / 维修缺来源（含空白）：行照常保存（来源先置空），同时标待确认（确认前不影响已保存内容）
        const sourceMissing =
          (item.table === 'tunings' || item.table === 'voicings') &&
          String(payload.source ?? '').trim() === '';
        if (sourceMissing) payload.source = '';

        const row = stamp(payload, now);
        row.updatedBy = batch.actorName;
        await table.put(row);
        pianoIds.add(pianoIdOf(item.table, payload));

        if (sourceMissing) {
          const pendingId = `pd-${item.table}-${id}`;
          await db.pendingChanges.put({
            id: pendingId,
            table: item.table,
            recordId: id,
            pianoId: pianoIdOf(item.table, payload),
            kind: 'source',
            op: 'create',
            reason: 'missing-source',
            conflicts: [],
            incoming: toIncomingPayload(payload, ENTITY_FIELDS[item.table]),
            baseRevision: ROW_REVISION,
            status: 'pending',
            actorId: batch.actorId,
            actorName: batch.actorName,
            sourceMissing: true,
            source: '',
            createdAt: now
          } satisfies PendingChange);
          pendingIds.push(pendingId);
        }
        continue;
      }

      // update
      const id = item.id ?? String(payload.id ?? '');
      if (!id) throw new Error('更新操作缺少记录 id');
      const current = await table.get(id);
      if (!current) {
        // 并发期间记录已被对方删除：本批失败，整批回滚
        throw new Error('记录已被其他标签页删除，本次保存无法合并');
      }
      const currentRecord = asRecord(current);
      const baseRecord = item.base ? asRecord(item.base) : currentRecord;
      pianoIds.add(pianoIdOf(item.table, currentRecord));

      const sourceMissing =
        (item.table === 'tunings' || item.table === 'voicings') &&
        String(payload.source ?? '').trim() === '';
      if (sourceMissing) payload.source = '';

      const concurrent =
        typeof baseRecord.revision === 'number' && currentRecord.revision !== baseRecord.revision;

      if (!concurrent) {
        // 无并发编辑：后保存直接生效（修订号 +1）
        const next = {
          ...currentRecord,
          ...payload,
          id,
          revision: (typeof currentRecord.revision === 'number' ? currentRecord.revision : ROW_REVISION) + 1,
          createdAt: currentRecord.createdAt ?? now,
          updatedAt: now,
          updatedBy: batch.actorName
        };
        await table.put(next);
        if (sourceMissing) await upsertSourcePending(item.table, id, payload, currentRecord, batch, now, pendingIds);
      } else {
        // 并发保存：按字段三方合并
        const { patch, conflicts } = threeWayMerge(baseRecord, currentRecord, payload, ENTITY_FIELDS[item.table]);
        const pendingId = `pd-${item.table}-${id}`;

        if (conflicts.length > 0) {
          // 同字段冲突：先合并非冲突字段，冲突字段保留已生效值与双方提交值，进入待确认
          const merged = {
            ...currentRecord,
            ...patch,
            revision: (currentRecord.revision as number) + 1,
            updatedAt: now,
            updatedBy: batch.actorName
          };
          await table.put(merged);
          await db.pendingChanges.put({
            id: pendingId,
            table: item.table,
            recordId: id,
            pianoId: pianoIdOf(item.table, currentRecord),
            kind: 'field',
            op: 'update',
            reason: 'conflict',
            conflicts,
            incoming: toIncomingPayload(payload, ENTITY_FIELDS[item.table]),
            baseRevision: baseRecord.revision as number,
            status: 'pending',
            actorId: batch.actorId,
            actorName: batch.actorName,
            currentActorName: typeof currentRecord.updatedBy === 'string' ? currentRecord.updatedBy : '另一标签页',
            sourceMissing,
            source: typeof payload.source === 'string' ? payload.source : '',
            createdAt: now
          } satisfies PendingChange);
          pendingIds.push(pendingId);
        } else {
          // 不同字段：整行合并后直接生效，修订号 +1
          const merged = {
            ...currentRecord,
            ...patch,
            revision: (currentRecord.revision as number) + 1,
            createdAt: currentRecord.createdAt ?? now,
            updatedAt: now,
            updatedBy: batch.actorName
          };
          await table.put(merged);
          if (sourceMissing) await upsertSourcePending(item.table, id, payload, currentRecord, batch, now, pendingIds);
        }
      }
    }

    // 提交后立即重算（与写入同一事务，同成败）
    for (const pianoId of pianoIds) {
      if (!pianoId) continue;
      await recomputePiano(
        {
          pianos: db.pianos,
          tunings: db.tunings,
          voicings: db.voicings,
          environments: db.environments,
          reminders: db.reminders
        },
        pianoId,
        now
      );
    }
  });

  return { pianoIds: Array.from(pianoIds).filter(Boolean), pendingIds };
}

/** 缺来源待确认（确定性 id，重复提交只更新不新增） */
async function upsertSourcePending(
  table: EntityTable,
  id: string,
  payload: Record<string, unknown>,
  currentRecord: Record<string, unknown>,
  batch: CommitBatch,
  now: number,
  pendingIds: string[]
): Promise<void> {
  const pendingId = `pd-${table}-${id}`;
  await db.pendingChanges.put({
    id: pendingId,
    table,
    recordId: id,
    pianoId: pianoIdOf(table, currentRecord),
    kind: 'source',
    op: 'update',
    reason: 'missing-source',
    conflicts: [],
    incoming: toIncomingPayload(payload, ENTITY_FIELDS[table]),
    baseRevision: typeof currentRecord.revision === 'number' ? currentRecord.revision : ROW_REVISION,
    status: 'pending',
    actorId: batch.actorId,
    actorName: batch.actorName,
    sourceMissing: true,
    source: '',
    createdAt: now
  } satisfies PendingChange);
  if (!pendingIds.includes(pendingId)) pendingIds.push(pendingId);
}

/* ------------------------------ 待确认 ------------------------------ */

export async function listPending(): Promise<PendingChangeRow[]> {
  const rows = await db.pendingChanges.toArray();
  return rows.sort((a, b) => {
    const weight = { pending: 0, confirmed: 1, discarded: 2 } as const;
    return weight[a.status] - weight[b.status] || b.createdAt - a.createdAt;
  });
}

export async function pendingCount(): Promise<number> {
  return db.pendingChanges.where('status').equals('pending').count();
}

export interface PendingResolution {
  /** 逐字段选择：current 保留已生效值 / incoming 采用后到一方的值 */
  choices?: Record<string, 'current' | 'incoming'>;
  /** 补填的来源（缺来源确认时必填） */
  source?: string;
  /** 执行确认的操作人姓名 */
  resolvedBy: string;
}

/** 确认一条待确认：按选择写回字段 / 来源，标记已确认，立即重算 */
export async function resolvePending(pendingId: string, resolution: PendingResolution): Promise<string | null> {
  return resolvePendingBatch([{ pendingId, ...resolution }], resolution.resolvedBy);
}

/** 放弃一条待确认：后到值不生效，标记已放弃，档案立即重算 */
export async function discardPending(pendingId: string, resolvedBy: string): Promise<string | null> {
  return discardPendingBatch([pendingId], resolvedBy);
}

export interface BatchResolution extends PendingResolution {
  pendingId: string;
}

/** 批量确认：一个事务，任何一条失败整批回滚 */
export async function resolvePendingBatch(items: BatchResolution[], resolvedBy: string): Promise<string | null> {
  let pianoId: string | null = null;
  const now = Date.now();
  await db.transaction('rw', ALL_TABLES, async () => {
    for (const item of items) {
      const pending = await db.pendingChanges.get(item.pendingId);
      if (!pending) throw new Error('待确认记录不存在或已被处理');
      if (pending.status !== 'pending') throw new Error('该冲突已被其他标签页处理');
      const table = db[pending.table] as unknown as Table<Record<string, unknown>, string>;
      const row = await table.get(pending.recordId);
      if (row) {
        const record = asRecord(row);
        const patch: Record<string, unknown> = {};
        for (const conflict of pending.conflicts) {
          const choice = item.choices?.[conflict.field] ?? 'current';
          if (choice === 'incoming') patch[conflict.field] = pending.incoming[conflict.field];
        }
        if (pending.sourceMissing) {
          const source = (item.source ?? '').trim();
          if (!source) throw new Error('请先补填数据来源再确认');
          patch.source = source;
        }
        if (Object.keys(patch).length > 0) {
          await table.put({
            ...record,
            ...patch,
            revision: (typeof record.revision === 'number' ? record.revision : ROW_REVISION) + 1,
            updatedAt: now,
            updatedBy: resolvedBy
          });
        }
        if (pending.table === 'tunings') await recomputeTuningRow(db.tunings, pending.recordId, now);
        if (pending.table === 'environments') await recomputeEnvironmentRow(db.environments, pending.recordId, now);
      }
      await db.pendingChanges.update(pending.id, {
        status: 'confirmed',
        resolvedAt: now,
        resolvedBy,
        resolution: item.choices ?? {}
      } satisfies Partial<PendingChange> as never);
      pianoId = pending.pianoId;
    }
    if (pianoId) {
      await recomputePiano(
        { pianos: db.pianos, tunings: db.tunings, voicings: db.voicings, environments: db.environments, reminders: db.reminders },
        pianoId,
        now
      );
    }
  });
  return pianoId;
}

/** 批量放弃 */
export async function discardPendingBatch(pendingIds: string[], resolvedBy: string): Promise<string | null> {
  let pianoId: string | null = null;
  const now = Date.now();
  await db.transaction('rw', ALL_TABLES, async () => {
    for (const id of pendingIds) {
      const pending = await db.pendingChanges.get(id);
      if (!pending) throw new Error('待确认记录不存在');
      if (pending.status !== 'pending') throw new Error('该冲突已被其他标签页处理');
      await db.pendingChanges.update(id, { status: 'discarded', resolvedAt: now, resolvedBy } satisfies Partial<PendingChange> as never);
      pianoId = pending.pianoId;
    }
    if (pianoId) {
      await recomputePiano(
        { pianos: db.pianos, tunings: db.tunings, voicings: db.voicings, environments: db.environments, reminders: db.reminders },
        pianoId,
        now
      );
    }
  });
  return pianoId;
}

/* ------------------------------ 列表读取 ------------------------------ */

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

/** 单条维修完成：回写钢琴状态并立即重算（内部事务，含全部重算会触达的表） */
export async function completeVoicing(id: string, actorName = '当前标签页'): Promise<string> {
  const now = Date.now();
  await db.transaction('rw', ALL_TABLES, async () => {
    const voicing = await db.voicings.get(id);
    if (!voicing) throw new Error('维修记录不存在');
    await db.voicings.put({
      ...voicing,
      state: '已完成',
      revision: voicing.revision + 1,
      updatedAt: now,
      updatedBy: actorName
    });
    await recomputePiano(
      { pianos: db.pianos, tunings: db.tunings, voicings: db.voicings, environments: db.environments, reminders: db.reminders },
      voicing.pianoId,
      now
    );
  });
  const voicing = await db.voicings.get(id);
  return voicing?.pianoId ?? '';
}

export async function removeTuning(id: string): Promise<void> {
  await commitChanges({ actorId: 'local', actorName: '当前标签页', items: [{ table: 'tunings', op: 'delete', id }] });
}

export async function removeVoicing(id: string): Promise<void> {
  await commitChanges({ actorId: 'local', actorName: '当前标签页', items: [{ table: 'voicings', op: 'delete', id }] });
}

export async function removeEnvironment(id: string): Promise<void> {
  await commitChanges({ actorId: 'local', actorName: '当前标签页', items: [{ table: 'environments', op: 'delete', id }] });
}

export async function removeReminder(id: string): Promise<void> {
  await commitChanges({ actorId: 'local', actorName: '当前标签页', items: [{ table: 'reminders', op: 'delete', id }] });
}

/** 删除钢琴：级联删除其调律 / 维修 / 环境 / 提醒与待确认 */
export async function removePiano(id: string): Promise<void> {
  await commitChanges({ actorId: 'local', actorName: '当前标签页', items: [{ table: 'pianos', op: 'delete', id }] });
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

function stripRow<T>(row: T): T {
  const copy = { ...(row as object) } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  delete copy.updatedBy;
  return copy as T;
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

/**
 * 导入整库备份：旧数据自动补版本；调律 / 维修缺来源先标待确认；
 * 一个事务完成清空、写入与待确认生成，任何失败整批回滚。
 */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  const now = Date.now();
  await db.transaction(
    'rw',
    [db.pianos, db.tunings, db.voicings, db.environments, db.reminders, db.pendingChanges],
    async () => {
      await Promise.all([
        db.pianos.clear(),
        db.tunings.clear(),
        db.voicings.clear(),
        db.environments.clear(),
        db.reminders.clear(),
        db.pendingChanges.clear()
      ]);

      const stampRows = <T extends object>(rows: T[]): Array<T & Revisioned> =>
        rows.map((row) => migrationStamp(row as Record<string, unknown>, now) as T & Revisioned);

      /** 旧备份里的调律 / 维修缺来源：落库前先补空串，保证缺来源筛选与重试导入幂等 */
      const withSource = <T extends object>(rows: T[]): T[] =>
        rows.map((row) => {
          const record = row as Record<string, unknown>;
          if (String(record.source ?? '').trim() === '') return { ...record, source: '' } as T;
          return row;
        });

      await db.pianos.bulkPut(stampRows(snapshot.pianos ?? []) as PianoRow[]);
      await db.tunings.bulkPut(stampRows(withSource(snapshot.tunings ?? [])) as TuningRow[]);
      await db.voicings.bulkPut(stampRows(withSource(snapshot.voicings ?? [])) as VoicingRow[]);
      await db.environments.bulkPut(stampRows(snapshot.environments ?? []) as EnvironmentRow[]);
      await db.reminders.bulkPut(stampRows(snapshot.reminders ?? []) as ReminderRow[]);

      // 缺来源的调律 / 维修：确定性 id 标待确认，重试导入先 clear 再生成，天然不重复
      const missingTunings = await db.tunings.filter((row) => row.source === '').toArray();
      const missingVoicings = await db.voicings.filter((row) => row.source === '').toArray();
      for (const row of [...missingTunings, ...missingVoicings]) {
        const tableName: EntityTable = 'technician' in row ? 'tunings' : 'voicings';
        await db.pendingChanges.put({
          id: `pd-${tableName}-${row.id}`,
          table: tableName,
          recordId: row.id,
          pianoId: row.pianoId,
          kind: 'source',
          op: 'update',
          reason: 'missing-source',
          conflicts: [],
          incoming: toIncomingPayload(row as unknown as Record<string, unknown>, ENTITY_FIELDS[tableName]),
          baseRevision: row.revision,
          status: 'pending',
          actorId: 'legacy-import',
          actorName: '备份导入',
          sourceMissing: true,
          source: '',
          createdAt: now
        } satisfies PendingChange);
      }
    }
  );
}

/** 清空全部数据（含待确认）并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.pianos, db.tunings, db.voicings, db.environments, db.reminders, db.pendingChanges],
    async () => {
      await Promise.all([
        db.pianos.clear(),
        db.tunings.clear(),
        db.voicings.clear(),
        db.environments.clear(),
        db.reminders.clear(),
        db.pendingChanges.clear()
      ]);
    }
  );
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [pianos, tunings, voicings, environments, reminders, pending] = await Promise.all([
    db.pianos.count(),
    db.tunings.count(),
    db.voicings.count(),
    db.environments.count(),
    db.reminders.count(),
    pendingCount()
  ]);
  return { pianos, tunings, voicings, environments, reminders, pending };
}
