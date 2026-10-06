/**
 * 并发保存引擎：乐观修订号 + 字段级三方合并 + 待确认操作 + 派生态重算
 *
 * 一条提交（可含多条记录的改动）在单个 IndexedDB 事务内执行：
 * - 记录不存在 → 新建；
 * - baseRevision 与当前行一致（或未提供）→ 直接覆盖，修订号 +1；
 * - baseRevision 落后于当前行（另一标签页已保存）→ 逐字段三方合并：
 *   · 不同字段直接合并；
 *   · 同一字段双方改成不同值 → 已生效内容不动，后保存一方的值登记为待确认操作，
 *     保留双方值与操作人；
 * - 事务内任何一步抛错，整批回滚（Dexie transaction 语义）。
 *
 * 待确认操作确认 / 放弃后，钢琴档案、最近调律音分、复调标记与提醒立即重算。
 */
import { db, stampNew, tableOf, type PendingOperationRow, type Revisioned } from './db';
import { mergeFields } from './merge';
import { recomputeReminder, reminderChanged, tuningNeedsRepitch } from './derive';
import type { SaveActor } from './client';
import type { ConflictTable, PendingOperation } from '$lib/types/conflict';
import { createId } from './uuid';

/** 五张业务表（含 pending 表），事务用 */
const ALL_TABLES = [db.pianos, db.tunings, db.voicings, db.environments, db.reminders, db.pendingOperations];

/** 提交里的单条记录改动 */
export interface SaveItem<T extends object> {
  table: ConflictTable;
  /** 新建时为空；更新时为目标行 id */
  id?: string;
  /** 编辑开始时读到的行（三方合并的 base；新建可省） */
  base?: T & Partial<Revisioned>;
  /** 打开编辑时该行的修订号（乐观锁基准；新建可省） */
  baseRevision?: number;
  /** 本次表单整行数据（新建不含 id） */
  payload: T;
  /** 新建行 id 前缀（pn/tn/vo/en/rm） */
  idPrefix: string;
}

/** 单条提交的落库结果 */
export interface SaveOutcome {
  table: ConflictTable;
  id: string;
  created: boolean;
  /** 实际写入的字段数（直接合并） */
  mergedFields: number;
  /** 登记的待确认字段冲突数 */
  conflicts: number;
}

/** 合并得到的同字段冲突 */
interface FieldConflict {
  field: string;
  effectiveValue: unknown;
  incomingValue: unknown;
}

function idPrefixOf(table: ConflictTable): string {
  switch (table) {
    case 'pianos':
      return 'pn';
    case 'tunings':
      return 'tn';
    case 'voicings':
      return 'vo';
    case 'environments':
      return 'en';
    case 'reminders':
      return 'rm';
  }
}

/** 登记 / 合并一条待确认操作（同 record+field 已有待确认项时复用，不重复堆叠） */
async function registerPending(input: Omit<PendingOperation, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> {
  const now = Date.now();
  const existing = await db.pendingOperations
    .where('recordId')
    .equals(input.recordId)
    .filter((item) => item.state === 'pending' && item.field === input.field && item.table === input.table)
    .first();
  if (existing) {
    // 同一字段的后续重试：刷新待确认方的值与幂等键，但绝不覆盖已生效方
    await db.pendingOperations.put({
      ...existing,
      incoming: input.incoming,
      intentId: input.intentId,
      kind: input.kind,
      updatedAt: now
    });
    return;
  }
  // intentId 幂等：同一次提交（重试）不重复登记
  const sameIntent = await db.pendingOperations.where('intentId').equals(input.intentId).first();
  if (sameIntent) return;
  await db.pendingOperations.add({
    ...input,
    id: createId('cf'),
    createdAt: now,
    updatedAt: now
  } as PendingOperationRow);
}

interface ResolvedRefs {
  /** 落库成功的业务行（供跨记录重算用） */
  touchedPianoIds: Set<string>;
}

function pianoIdOfRow(table: ConflictTable, row: Record<string, unknown>): string | null {
  if (table === 'pianos') return typeof row.id === 'string' ? row.id : null;
  return typeof row.pianoId === 'string' ? (row.pianoId as string) : null;
}

/** 事务内重算某台琴的派生态：复调标记 + 周期提醒 */
async function recalcPiano(pianoId: string, touchReminders: boolean): Promise<void> {
  const tunings = await db.tunings.where('pianoId').equals(pianoId).toArray();
  for (const tuning of tunings) {
    const repitch = tuningNeedsRepitch(tuning);
    if (tuning.pitchRaised !== repitch) {
      await db.tunings.put({ ...tuning, pitchRaised: repitch, updatedAt: Date.now() });
    }
  }
  if (touchReminders) {
    const reminder = await db.reminders.where('pianoId').equals(pianoId).first();
    if (reminder) {
      const next = recomputeReminder(pianoId, reminder.cycleMonths, tunings, reminder.lastTuningDate);
      if (next && reminderChanged(reminder, next)) {
        await db.reminders.put({
          ...reminder,
          ...next,
          revision: reminder.revision + 1,
          source: '系统重算',
          updatedAt: Date.now()
        });
      }
    }
  }
}

/** 事务内按维修记录回写钢琴状态：有「计划」→待修，否则正常；「停用」不自动改 */
async function recalcPianoState(pianoId: string): Promise<void> {
  const piano = await db.pianos.get(pianoId);
  if (!piano || piano.state === '停用') return;
  const pendingCount = await db.voicings.where('pianoId').equals(pianoId).filter((v) => v.state === '计划').count();
  const expected = pendingCount > 0 ? '待修' : '正常';
  if (piano.state !== expected) {
    await db.pianos.put({ ...piano, state: expected, source: '系统重算', revision: piano.revision + 1, updatedAt: Date.now() });
  }
}

/**
 * 批量提交：整批一个事务，任何失败全部回滚。
 * @param actor 操作人（姓名 + 标签页 id）
 * @param items 多条记录改动
 * @param intentId 本次提交的幂等键（同一标签页保存按钮重试可传入相同值）
 */
export async function saveBatch<T extends object>(actor: SaveActor, items: Array<SaveItem<T>>, intentId?: string): Promise<SaveOutcome[]> {
  const outcomes: SaveOutcome[] = [];
  const refs: ResolvedRefs = { touchedPianoIds: new Set() };
  const submitId = intentId ?? createId('submit');

  await db.transaction('rw', ALL_TABLES, async () => {
    for (const item of items) {
      const outcome = await applyItem(item, actor, submitId, refs);
      outcomes.push(outcome);
    }
    // 提交成功后立即重算受影响钢琴的派生态
    // - 调律保存 → 重算复调标记与提醒（reminders 自身除外，避免覆盖手填周期）
    // - 维修保存 → 回写钢琴状态（有计划→待修，否则正常）
    // - 钢琴档案自身的 state 是用户显式编辑，不能被自动重算覆盖
    const touchReminders = !items.some((item) => item.table === 'reminders');
    const recalcStateFor = new Set<string>();
    items.forEach((item) => {
      if (item.table === 'voicings' && typeof item.payload === 'object' && item.payload !== null) {
        const pianoId = (item.payload as { pianoId?: unknown }).pianoId;
        if (typeof pianoId === 'string') recalcStateFor.add(pianoId);
      }
    });
    for (const pianoId of refs.touchedPianoIds) {
      await recalcPiano(pianoId, touchReminders);
      if (recalcStateFor.has(pianoId)) await recalcPianoState(pianoId);
    }
  });

  return outcomes;
}

async function applyItem<T extends object>(
  item: SaveItem<T>,
  actor: SaveActor,
  submitId: string,
  refs: ResolvedRefs
): Promise<SaveOutcome> {
  const table = tableOf(item.table);
  const now = Date.now();

  // ---------- 新建 ----------
  if (!item.id) {
    const row = stampNew(item.payload, item.idPrefix || idPrefixOf(item.table), actor.name, actor.clientId);
    await (table as { add: (row: unknown) => Promise<unknown> }).add(row);
    const pianoId = pianoIdOfRow(item.table, row as unknown as Record<string, unknown>);
    if (pianoId) refs.touchedPianoIds.add(pianoId);
    return { table: item.table, id: row.id, created: true, mergedFields: Object.keys(item.payload as object).length, conflicts: 0 };
  }

  // ---------- 更新 ----------
  const current = await table.get(item.id);
  if (!current) throw new Error(`记录不存在或已被删除（${item.table}/${item.id}）`);

  const pianoId = pianoIdOfRow(item.table, current as unknown as Record<string, unknown>);
  const base = (item.base as Record<string, unknown> | undefined) ?? { ...(current as object) };
  const next = { ...(item.payload as object), id: item.id } as Record<string, unknown>;
  const effective = { ...(current as object) } as Record<string, unknown>;

  // 无修订号信息（旧入口）或修订号一致 → 非并发；
  // baseRevision 落后于当前行（另一标签页已保存）→ 并发：不同字段合并、同字段冲突保留双方值。
  const concurrent = item.baseRevision !== undefined && current.revision > item.baseRevision;
  const result = mergeFields(base, next, effective, concurrent);
  const cleanPatch: Record<string, unknown> = { ...result.clean };
  const conflicts: FieldConflict[] = [...result.conflicts];

  // 非并发：整行表单保存。mergeFields 已收集相对 base 的改动；
  // 极端情况下（clean 为空但确有改动，如旧入口未带 base）退化为整行 patch。
  if (!concurrent && result.changedFields > 0 && Object.keys(cleanPatch).length === 0 && conflicts.length === 0) {
    Object.keys(next).forEach((field) => {
      if (field !== 'id' && field !== 'revision' && field !== 'createdAt' && field !== 'updatedAt') {
        cleanPatch[field] = next[field];
      }
    });
  }

  if (Object.keys(cleanPatch).length > 0) {
    await table.put({
      ...current,
      ...cleanPatch,
      id: item.id,
      revision: current.revision + 1,
      source: actor.name,
      lastClientId: actor.clientId,
      updatedAt: now
    } as never);
  }
  // 全部改动字段都冲突时，已生效行原封不动（不加修订号、不改 updatedAt），
  // 仅把后保存一方的值登记为待确认操作，确认前不覆盖已生效内容。

  for (const conflict of conflicts) {
    const baseValue = base[conflict.field];
    await registerPending({
      kind: 'field',
      state: 'pending',
      table: item.table,
      recordId: item.id,
      field: conflict.field,
      effective: {
        value: conflict.effectiveValue,
        atRevision: current.revision,
        actor: typeof current.source === 'string' ? current.source : '另一方',
        clientId: current.lastClientId || 'other-tab',
        at: current.updatedAt
      },
      incoming: {
        value: conflict.incomingValue,
        atRevision: item.baseRevision ?? current.revision,
        actor: actor.name,
        clientId: actor.clientId,
        at: now
      },
      intentId: `${submitId}:${item.table}:${item.id}:${conflict.field}:${JSON.stringify(baseValue)}`
    });
  }

  if (pianoId) refs.touchedPianoIds.add(pianoId);
  return {
    table: item.table,
    id: item.id,
    created: false,
    mergedFields: Object.keys(cleanPatch).length,
    conflicts: conflicts.length
  };
}

/** 删除钢琴：级联删除其调律 / 维修 / 环境 / 提醒与全部待确认操作（单事务） */
export async function deletePianoCascade(pianoId: string): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    await db.pendingOperations.where('table').equals('pianos').filter((p) => p.recordId === pianoId).delete();
    for (const name of ['tunings', 'voicings', 'environments', 'reminders'] as const) {
      const childTable = tableOf(name);
      const children = await childTable.where('pianoId').equals(pianoId).toArray();
      const ids = children.map((row) => row.id);
      if (ids.length > 0) {
        await db.pendingOperations.where('recordId').anyOf(ids).delete();
      }
      await childTable.where('pianoId').equals(pianoId).delete();
    }
    await db.pianos.delete(pianoId);
  });
}

/** 删除单子表记录，并清理它的待确认操作（钢琴走级联删除） */
export async function deleteRecord(tableName: ConflictTable, id: string): Promise<void> {
  if (tableName === 'pianos') {
    await deletePianoCascade(id);
    return;
  }
  await db.transaction('rw', ALL_TABLES, async () => {
    await tableOf(tableName).delete(id);
    await db.pendingOperations.where('recordId').equals(id).delete();
  });
}

/* ------------------------- 待确认操作：确认 / 放弃 ------------------------- */

export interface ResolveOptions {
  /** 确认时采用一方的值；source 类固定为 incoming */
  choice?: 'effective' | 'incoming';
  /** source 类：补齐的来源操作人 */
  sourceName?: string;
  /** field 类确认 incoming 时允许覆盖字段值（默认即 incoming.value，这里可二次编辑） */
  valueOverride?: unknown;
}

/**
 * 处理一条待确认操作；处理后立即重算该记录所属钢琴的派生态。
 * - field / effective：保留已生效值（待确认值作废）；
 * - field / incoming：用待确认方的值覆盖已生效内容，修订号 +1；
 * - field / discard：放弃待确认值（等同 effective）；
 * - source / incoming：补齐来源操作人。
 */
export async function resolvePending(pendingId: string, options: ResolveOptions = {}): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    const pending = await db.pendingOperations.get(pendingId);
    if (!pending) throw new Error('待确认操作不存在');
    if (pending.state !== 'pending') return; // 已处理过，重试不重复生效

    const now = Date.now();
    const table = tableOf(pending.table);
    const row = pending.table === 'pianos' ? null : await table.get(pending.recordId);
    const pianoRow = pending.table === 'pianos' ? await db.pianos.get(pending.recordId) : null;
    const target = row ?? pianoRow;

    if (pending.kind === 'field') {
      if (!target) throw new Error('关联记录已删除，无法处理冲突');
      const choice = options.choice ?? 'effective';
      if (choice === 'incoming') {
        const value = options.valueOverride !== undefined ? options.valueOverride : pending.incoming.value;
        await table.put({
          ...target,
          [pending.field]: value,
          revision: target.revision + 1,
          source: pending.incoming.actor,
          updatedAt: now
        } as never);
      }
      await db.pendingOperations.put({
        ...pending,
        state: choice === 'incoming' ? 'confirmed' : 'discarded',
        resolution: choice,
        resolvedAt: now,
        updatedAt: now
      });
    } else {
      // source：补齐来源；记录仍在则写回 source 字段
      const sourceName = options.sourceName?.trim() || pending.incoming.actor || '已确认来源';
      if (target && (target.source === undefined || target.source === '来源待确认')) {
        await table.put({
          ...target,
          source: sourceName,
          revision: target.revision + 1,
          updatedAt: now
        } as never);
      }
      await db.pendingOperations.put({
        ...pending,
        state: 'confirmed',
        resolution: 'incoming',
        resolvedAt: now,
        updatedAt: now,
        incoming: { ...pending.incoming, value: sourceName }
      });
    }

    // 确认或放弃后立即重算：钢琴档案状态、最近调律音分、复调标记、提醒
    const refRow = (target ?? {}) as Record<string, unknown>;
    const pianoId =
      pending.table === 'pianos'
        ? pending.recordId
        : typeof refRow.pianoId === 'string'
          ? refRow.pianoId
          : null;
    if (pianoId) {
      const touchReminders = pending.table !== 'reminders';
      await recalcPiano(pianoId, touchReminders);
      if (pending.table === 'voicings') await recalcPianoState(pianoId);
    }
  });
}

/** 一次处理多条待确认操作（单事务；任何一条失败整批回滚，不产生半确认状态） */
export async function resolveMany(pendingIds: string[], options: ResolveOptions = {}): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    for (const id of pendingIds) {
      await resolvePending(id, options);
    }
  });
}

/**
 * 完成一条维修：回写「已完成」（修订号 +1），随后立即重算该琴状态与派生态。
 * 单事务，失败回滚。
 */
export async function completeVoicingRecord(id: string, actor: SaveActor): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    const voicing = await db.voicings.get(id);
    if (!voicing) throw new Error('维修记录不存在');
    await db.voicings.put({
      ...voicing,
      state: '已完成',
      revision: voicing.revision + 1,
      source: actor.name,
      updatedAt: Date.now()
    });
    await recalcPianoState(voicing.pianoId);
    await recalcPiano(voicing.pianoId, false);
  });
}
