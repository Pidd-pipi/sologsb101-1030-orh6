/**
 * 三方字段合并（纯函数，可单测）
 *
 * 场景：标签页 A、B 都从修订号 rev 的同一行打开编辑：
 * - A 先保存 → 字段直接生效，行修订号 +1；
 * - B 后保存 → 逐字段与「已生效行」比较：
 *   · B 没改过的字段（next === base）→ 保留已生效值；
 *   · B 改了、且与已生效值相同 → 不冲突；
 *   · B 改了、已生效方也改了且两边新值不同 → 同字段冲突，双方值都保留。
 */
import type { FieldChange } from '$lib/types/conflict';

/** 结构性深比较（覆盖 zones 这类嵌套对象；undefined 与缺省等价） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

/** 字段合并结果 */
export interface FieldMergeResult {
  /** 可直接写入已生效行的字段（不同字段的改动 / 两边一致的改动） */
  clean: Record<string, unknown>;
  /** 同字段双方改成不同值，需登记待确认操作 */
  conflicts: Array<{ field: string; effectiveValue: unknown; incomingValue: unknown }>;
  /** 本次提交实际改动了多少个字段 */
  changedFields: number;
}

/**
 * 三方合并。
 * @param baseRow  编辑开始时读到的整行（修订号 rev）
 * @param nextRow  本次提交的整行（页面表单，未改字段保持原值）
 * @param effectiveRow 已生效的最新行（修订号可能 > rev）
 * @param concurrent 已生效行是否在本页打开后被其他标签页改过（rev 前进）
 *
 * 关键语义：页面始终提交整行。并发时，本页「没动过」的字段
 *（next 与 base 相同）必须保留已生效值，不能回退对方的改动，也不算冲突；
 * 只有本页改了、对方也改了且两边新值不同，才算同字段冲突。
 */
export function mergeFields(
  baseRow: Record<string, unknown>,
  nextRow: Record<string, unknown>,
  effectiveRow: Record<string, unknown>,
  concurrent = false
): FieldMergeResult {
  const clean: Record<string, unknown> = {};
  const conflicts: FieldMergeResult['conflicts'] = [];
  let changedFields = 0;

  // 以「本次表单出现的业务字段」为准（id 与修订元信息不参与合并）
  const skip = new Set(['id', 'revision', 'createdAt', 'updatedAt', 'source', 'lastClientId']);
  const fields = new Set([...Object.keys(nextRow), ...Object.keys(effectiveRow)]);

  fields.forEach((field) => {
    if (skip.has(field)) return;
    const base = baseRow[field];
    const next = nextRow[field];
    const effective = effectiveRow[field];

    const incomingChanged = !deepEqual(next, base);

    // 并发场景：本页没动这个字段 → 一律保留已生效值（对方的改动不回退、不冲突）
    if (concurrent && !incomingChanged) return;

    if (!incomingChanged) return; // 非并发且没改
    changedFields += 1;

    if (deepEqual(next, effective)) return; // 两边改成了相同值，天然合并

    // 本页改了：对方是否也改了（相对 base）
    const effectiveChanged = !deepEqual(effective, base);
    if (concurrent && effectiveChanged) {
      // 同一字段双方都改且值不同 → 冲突：已生效内容不动，双方值都保留待确认
      conflicts.push({ field, effectiveValue: effective, incomingValue: next });
    } else {
      // 只有本页改了该字段 → 不同字段直接合并
      clean[field] = next;
    }
  });

  return { clean, conflicts, changedFields };
}

/** 把页面表单与打开时的整行对比，生成变更清单（供提交使用） */
export function diffRows(baseRow: Record<string, unknown>, nextRow: Record<string, unknown>): FieldChange[] {
  const changes: FieldChange[] = [];
  Object.keys(nextRow).forEach((field) => {
    if (field === 'id' || field === 'revision' || field === 'createdAt' || field === 'updatedAt') return;
    if (!deepEqual(baseRow[field], nextRow[field])) {
      changes.push({ field, base: baseRow[field], next: nextRow[field] });
    }
  });
  return changes;
}
