/**
 * 轻量全局提示 store：保存成功 / 字段冲突待确认 / 提交失败回滚的即时反馈。
 * 保存动作返回后由页面推送，全局角标旁的提示条统一展示，数秒后自动消失。
 */
import { writable, type Writable } from 'svelte/store';

export type NoticeTone = 'success' | 'warn' | 'error';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
}

export const notices: Writable<Notice[]> = writable([]);

let seq = 0;

export function pushNotice(message: string, tone: NoticeTone = 'success', ttlMs = 4000): void {
  const id = ++seq;
  notices.update((list) => [...list, { id, tone, message }]);
  setTimeout(() => {
    notices.update((list) => list.filter((item) => item.id !== id));
  }, ttlMs);
}

export function dismissNotice(id: number): void {
  notices.update((list) => list.filter((item) => item.id !== id));
}
