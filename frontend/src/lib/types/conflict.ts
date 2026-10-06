/**
 * 待确认操作（并发冲突台账）
 *
 * 两个标签页同时编辑同一台钢琴档案时：
 * - 不同字段：直接合并，不产生冲突；
 * - 同一字段：先到一方的值即时生效，后到一方的值登记为待确认操作，
 *   保留双方值与操作人，在确认 / 放弃前不覆盖已生效内容。
 *
 * 旧数据迁移时缺来源（没有操作人 / 修订号无法判断出处）的行，
 * 同样登记一条 kind='source' 的待确认操作，补齐来源后解除。
 */
import type { Piano } from './piano';
import type { Tuning } from './tuning';
import type { Voicing } from './voicing';
import type { Environment } from './environment';
import type { Reminder } from './reminder';

/** 五张业务表（待确认操作表自身不参与） */
export type ConflictTable = 'pianos' | 'tunings' | 'voicings' | 'environments' | 'reminders';

export const CONFLICT_TABLES: ConflictTable[] = ['pianos', 'tunings', 'voicings', 'environments', 'reminders'];

/** 待确认操作种类：field=同字段双值冲突；source=旧数据缺来源 */
export type PendingKind = 'field' | 'source';

/** 处理状态 */
export type PendingState = 'pending' | 'confirmed' | 'discarded';

export const PENDING_STATES: PendingState[] = ['pending', 'confirmed', 'discarded'];

/** 任意一行业务数据（不含修订元信息） */
export type AnyEntity = Piano | Tuning | Voicing | Environment | Reminder;

/** 某一方提交的字段值 */
export interface ConflictValue {
  /** 值（原始类型：string / number / boolean / 对象） */
  value: unknown;
  /** 提交时该行的修订号（用于三方判断） */
  atRevision: number;
  /** 操作人（调律师 / 操作人 / 当前编辑人） */
  actor: string;
  /** 提交所在标签页 id */
  clientId: string;
  /** 提交时间戳 */
  at: number;
}

/** 待确认操作行（持久化在 pendingOperations 表） */
export interface PendingOperation {
  id: string;
  kind: PendingKind;
  state: PendingState;
  /** 业务表名 */
  table: ConflictTable;
  /** 业务行 id */
  recordId: string;
  /** 冲突字段名（source 类为缺来源标记字段 '__source__'） */
  field: string;
  /** 已生效一方的值 */
  effective: ConflictValue;
  /** 后保存 / 待确认一方的值（source 类存待补的操作人占位） */
  incoming: ConflictValue;
  /** 幂等键：同一次提交重试不重复登记 */
  intentId: string;
  createdAt: number;
  updatedAt: number;
  /** 确认 / 放弃时间 */
  resolvedAt?: number;
  /** 确认后选择的值（'effective' | 'incoming'）；source 类固定为 incoming */
  resolution?: 'effective' | 'incoming';
}

/** 缺来源占位字段名 */
export const SOURCE_FIELD = '__source__';

/** 迁移补登记时的来源说明 */
export const LEGACY_SOURCE_NOTE = '旧数据迁移：缺操作人，待确认来源';

/** 一条变更：某个字段从期望值改为新值（期望值用于并发检测） */
export interface FieldChange {
  field: string;
  /** 编辑开始时读到的原值（三方合并的基准） */
  base: unknown;
  /** 本次要写入的新值 */
  next: unknown;
}
