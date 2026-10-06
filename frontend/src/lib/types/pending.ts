/**
 * 待确认操作（并发冲突 / 来源缺失）
 *
 * 两个标签页同时编辑同一条记录时：
 * - 不同字段：提交时直接三方合并生效；
 * - 同一字段且两边都改：已生效内容保持不动，双方的值与操作人保留在待确认记录里，
 *   由用户在「待确认中心」逐字段确认或整体放弃，确认前任何一方都不能覆盖对方。
 */
import type { EntityTable } from '$lib/utils/syncBus';

/** 待确认类型：字段冲突 / 缺来源 */
export type PendingKind = 'field' | 'source';
/** 待确认状态：待处理 / 已确认（保留审计） / 已放弃 */
export type PendingStatus = 'pending' | 'confirmed' | 'discarded';
/** 触发待确认的原始写操作（缺来源多发生在新建或旧数据迁移） */
export type PendingOp = 'create' | 'update';
/** 待确认产生原因 */
export type PendingReason = 'conflict' | 'missing-source';

/** 单个冲突字段：保留基线、已生效值、后到提交值三方数据 */
export interface FieldConflict {
  /** 字段名 */
  field: string;
  /** 编辑开始时的值（共同祖先） */
  baseValue: unknown;
  /** 已生效值（先保存一方） */
  currentValue: unknown;
  /** 后保存一方提交的值（确认前不会覆盖） */
  incomingValue: unknown;
}

/** 待确认记录（持久化在 pendingChanges 表） */
export interface PendingChange {
  id: string;
  /** 冲突所在实体表 */
  table: EntityTable;
  /** 冲突记录 id */
  recordId: string;
  /** 所属钢琴 id（pianos 表为自身 id），用于确认后重算 */
  pianoId: string;
  kind: PendingKind;
  op: PendingOp;
  reason: PendingReason;
  /** kind = field 时的逐字段冲突明细 */
  conflicts: FieldConflict[];
  /** 后到一方提交的完整行（确认时按字段取值用） */
  incoming: Record<string, unknown>;
  /** 后到一方编辑时基于的修订号 */
  baseRevision: number;
  status: PendingStatus;
  /** 后到一方的操作人标识 */
  actorId: string;
  /** 后到一方的操作人姓名 */
  actorName: string;
  /** 后到一方填写的来源（调律师 / 操作人） */
  source: string;
  /** 缺来源待确认（kind = source 或字段冲突同时缺来源） */
  sourceMissing?: boolean;
  /** 已生效一方的操作人姓名（冲突中心展示双方操作人） */
  currentActorName?: string;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  /** 确认时逐字段采用了哪一方 */
  resolution?: Record<string, 'current' | 'incoming'>;
}

/** 待确认记录的持久化行（id 为主键，与实体表结构一致） */
export type PendingChangeRow = PendingChange;

/** 冲突字段的逐字段选择（值为采用已生效值还是后到值） */
export type FieldChoices = Record<string, 'current' | 'incoming'>;
