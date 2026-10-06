/**
 * 标签页身份与操作人
 *
 * - clientId：每个标签页一个会话级随机 id（sessionStorage），用于在待确认操作里
 *   区分「哪一个标签页提交的值」；
 * - actorName：当前操作人姓名（localStorage，跨标签页共享），默认「本机调律师」，
 *   可在页面上修改；冲突记录里用它标识双方操作人。
 *
 * 纯前端无后端，不做账号体系，只做来源标注。
 */
import { createId } from './uuid';

const CLIENT_KEY = 'gbpianotune.clientId';
const ACTOR_KEY = 'gbpianotune.actorName';

/** 默认操作人（旧数据迁移缺来源时也用它兜底标注） */
export const DEFAULT_ACTOR = '本机调律师';

function sessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function localStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 当前标签页 id（每个标签页不同，刷新后保持） */
export function currentClientId(): string {
  const store = sessionStorage();
  if (!store) return createId('tab');
  let id = store.getItem(CLIENT_KEY);
  if (!id) {
    id = createId('tab');
    store.setItem(CLIENT_KEY, id);
  }
  return id;
}

/** 当前操作人姓名 */
export function currentActorName(): string {
  return localStorage()?.getItem(ACTOR_KEY)?.trim() || DEFAULT_ACTOR;
}

/** 修改当前操作人姓名（跨标签页同步） */
export function setActorName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) localStorage()?.setItem(ACTOR_KEY, trimmed);
}

export interface SaveActor {
  name: string;
  clientId: string;
}

/** 当前提交身份 */
export function currentActor(): SaveActor {
  return { name: currentActorName(), clientId: currentClientId() };
}
