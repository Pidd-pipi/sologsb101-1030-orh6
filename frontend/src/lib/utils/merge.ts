/**
 * 字段级三方合并引擎
 *
 * base 为两个标签页编辑开始时的共同版本，current 为先保存并已生效的一方，
 * incoming 为后保存的一方：
 * - 只有一方改动的字段：直接合并；
 * - 双方改动且值相同：直接生效；
 * - 双方改动且值不同：字段进入冲突，已生效内容保留、双方的值都保留待确认。
 *
 * 纯函数、不触碰 IndexedDB，便于单测与被各 store 复用。
 */
import type { FieldConflict } from '$lib/types/pending';

export interface MergeResult {
  /** 可直接生效的合并字段（不含冲突字段） */
  patch: Record<string, unknown>;
  /** 同一字段双方都改且值不同的冲突明细 */
  conflicts: FieldConflict[];
}

function equalValue(a: unknown, b: unknown): boolean {
  // zones 等嵌套对象按结构比较；原始值按 Object.is
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * 三方合并（按字段）。
 * @param base 编辑开始时的行
 * @param current 当前已生效行
 * @param incoming 后保存一方提交的完整行
 * @param trackedFields 参与合并 / 冲突判定的业务字段
 */
export function threeWayMerge(
  base: Record<string, unknown>,
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  trackedFields: string[]
): MergeResult {
  const patch: Record<string, unknown> = {};
  const conflicts: FieldConflict[] = [];

  for (const field of trackedFields) {
    const baseValue = base[field];
    const currentValue = current[field];
    const incomingValue = incoming[field];

    const currentChanged = !equalValue(baseValue, currentValue);
    const incomingChanged = !equalValue(baseValue, incomingValue);

    if (!incomingChanged) {
      // 后到一方未改该字段：保留已生效值，不回退对方修改
      continue;
    }
    if (!currentChanged) {
      // 仅后到一方改动：直接合并
      patch[field] = incomingValue;
    } else if (equalValue(currentValue, incomingValue)) {
      // 双方改成同一个值：天然一致
      patch[field] = incomingValue;
    } else {
      // 双方都改且值不同：保留双方值，进入待确认，已生效内容不被覆盖
      conflicts.push({ field, baseValue, currentValue, incomingValue });
    }
  }

  return { patch, conflicts };
}

/** 待确认记录里保留的后到提交行 */
export function toIncomingPayload(incoming: Record<string, unknown>, trackedFields: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  trackedFields.forEach((field) => {
    picked[field] = incoming[field];
  });
  return picked;
}
