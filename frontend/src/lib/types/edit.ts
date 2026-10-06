/**
 * 编辑上下文：页面打开编辑弹窗时记录「打开时读到的整行 + 行修订号」。
 * 保存时原样带回保存引擎，作为三方合并与乐观修订号检测的基准。
 *
 * 泛型 T 为页面表单的整行结构（通常是包含 id 与业务字段、含修订元信息的 Row）。
 */
import type { Revisioned } from '$lib/utils/db';

/** 打开编辑弹窗时捕获的行（至少带修订号） */
export type EditContext<T = unknown> = {
  base: (T & Revisioned) | (Revisioned & Record<string, unknown>);
};

/** 保存参数：编辑时带上下文；新建时不带 */
export interface SaveParams<T extends object> {
  payload: T;
  id?: string;
  context?: EditContext;
  /** 幂等键：同一次提交（如重试）传入相同值，冲突登记不重复 */
  intentId?: string;
}
