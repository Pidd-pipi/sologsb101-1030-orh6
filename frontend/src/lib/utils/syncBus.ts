/**
 * 多标签页协同总线
 *
 * - actor：当前标签页的操作人标识（sessionStorage，标签页隔离），用于在冲突里保留双方操作人；
 * - broadcast / onNotify：通过 localStorage storage 事件跨标签页广播「数据已变更」，
 *   收到通知立即重算钢琴档案、最近调律音分、复调标记与提醒；
 * - stamp / migrationStamp：修订号与时间戳的统一入口，旧数据迁移时自动补版本。
 */
export type EntityTable = 'pianos' | 'tunings' | 'voicings' | 'environments' | 'reminders';

/** 参与修订合并的五张实体表 */
export const ENTITY_TABLES: EntityTable[] = ['pianos', 'tunings', 'voicings', 'environments', 'reminders'];

export function isEntityTable(name: string): name is EntityTable {
  return (ENTITY_TABLES as string[]).includes(name);
}

/** 当前数据结构版本号（行级修订基线，每次结构调整 +1） */
export const ROW_REVISION = 1;

const ACTOR_ID_KEY = 'gbpianotune:actorId';
const ACTOR_NAME_KEY = 'gbpianotune:actorName';
const BUS_CHANNEL = 'gbpianotune:sync';

/** 行级修订与时间戳 */
export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

/** 跨标签页广播的数据变更事件 */
export interface SyncEvent {
  /** 单调递增序号，防止同标签页回环与乱序 */
  seq: number;
  /** 触发变更的标签页 actorId */
  actor: string;
  /** 变更涉及的表；'pending' 表示待确认项变化，'all' 表示整库导入 / 重置 */
  tables: Array<EntityTable | 'pending' | 'all'>;
  /** 受影响的钢琴 id（确认 / 放弃后触发重算） */
  pianoIds: string[];
  at: number;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 当前标签页的操作人 id（每个标签页唯一，sessionStorage 隔离） */
export function currentActorId(): string {
  let id = sessionStorage.getItem(ACTOR_ID_KEY);
  if (!id) {
    id = `tab-${Date.now().toString(36)}-${randomSuffix()}`;
    sessionStorage.setItem(ACTOR_ID_KEY, id);
  }
  return id;
}

/** 当前标签页设置的操作人姓名（默认「标签页 N」，用户可在待确认中心修改） */
export function currentActorName(): string {
  return sessionStorage.getItem(ACTOR_NAME_KEY) ?? `标签页 ${currentActorId().slice(-4)}`;
}

export function setActorName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) sessionStorage.setItem(ACTOR_NAME_KEY, trimmed);
}

let busSeq = 0;

/** 向其他标签页广播数据变更（storage 事件只在其他文档触发，天然不回环） */
export function broadcast(tables: SyncEvent['tables'], pianoIds: string[] = []): void {
  busSeq += 1;
  const event: SyncEvent = { seq: busSeq, actor: currentActorId(), tables, pianoIds, at: Date.now() };
  localStorage.setItem(BUS_CHANNEL, JSON.stringify(event));
}

/** 订阅其他标签页的数据变更通知 */
export function onNotify(handler: (event: SyncEvent) => void): () => void {
  const listener = (event: StorageEvent): void => {
    if (event.key !== BUS_CHANNEL || !event.newValue) return;
    try {
      handler(JSON.parse(event.newValue) as SyncEvent);
    } catch {
      // 忽略无法解析的噪声事件
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

/** 新建行的修订戳 */
export function stamp<T>(row: T, now: number = Date.now()): T & Revisioned {
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

/**
 * 迁移补版本戳：旧数据自动补 revision / 时间戳，不覆盖已存在的值。
 * 用于 IndexedDB upgrade 与旧备份导入，保证重试幂等（已补齐的行原样返回）。
 */
export function migrationStamp<T extends Record<string, unknown>>(row: T, now: number = Date.now()): T & Revisioned {
  const next: Record<string, unknown> = { ...row };
  if (typeof next.revision !== 'number' || next.revision < 1) next.revision = ROW_REVISION;
  if (typeof next.createdAt !== 'number') next.createdAt = now;
  if (typeof next.updatedAt !== 'number') next.updatedAt = next.createdAt as number;
  return next as T & Revisioned;
}
