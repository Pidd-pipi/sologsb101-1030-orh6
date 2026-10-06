/**
 * 路由模块统一出口
 *
 * - 导航/路径常量写在本文件，且不依赖任何页面组件，避免「出口 ← 页面 ← 出口」循环依赖；
 * - 运行时（真实路径 history 路由）来自 ./router.svelte；
 * - 路由表（路径 → 页面组件，会 import 所有页面）单独放在 ./routes。
 *
 * 页面统一 `import { push, router } from '$lib/router'`。
 */
export { installRouter, navigate, normalizePath, push, replace, resolveRoute, router } from './router.svelte';
export type { InstallOptions, RouteMap, RouterState } from './router.svelte';

/** 五个模块路径（与需求逐字一致） */
export const ROUTES = {
  pianos: '/pianos',
  tunings: '/tunings',
  voicings: '/voicings',
  environments: '/environments',
  reminders: '/reminders'
} as const;

/** 根路径规范化后的默认模块 */
export const DEFAULT_PATH: string = ROUTES.pianos;

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  hint: string;
}

/** 侧边导航配置（与路由一一对应） */
export const NAV_ITEMS: NavItem[] = [
  { path: ROUTES.pianos, label: '钢琴档案', icon: '🎹', hint: '品牌 / 场所 / 状态' },
  { path: ROUTES.tunings, label: '调律记录', icon: '🎼', hint: '基准音高与音分偏差' },
  { path: ROUTES.voicings, label: '整音与维修', icon: '🛠️', hint: '毡槌 / 击弦机 / 换弦' },
  { path: ROUTES.environments, label: '琴房环境', icon: '🌡️', hint: '温湿度与超标提示' },
  { path: ROUTES.reminders, label: '周期提醒', icon: '⏰', hint: '超期琴与档案导出' }
];

/** 已注册的路径（用于判断当前路径是否合法） */
export const KNOWN_PATHS: string[] = NAV_ITEMS.map((item) => item.path);

/** 路径 → 导航高亮项；未知路径不高亮 */
export function activeNav(path: string): string {
  return NAV_ITEMS.find((item) => path === item.path || path.startsWith(`${item.path}/`))?.path ?? '';
}
