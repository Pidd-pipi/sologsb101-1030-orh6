/**
 * 路由表（history 模式真实路径）：/pianos、/tunings、/voicings、/environments、/reminders
 * 路由路径与需求逐字一致；根路径与未匹配路径分别由 DEFAULT_PATH 与 '*' 兜底页处理。
 */
import type { Component } from 'svelte';
import { ROUTES } from '$lib/router';
import PianosPage from '../../routes/pianos/+page.svelte';
import TuningsPage from '../../routes/tunings/+page.svelte';
import VoicingsPage from '../../routes/voicings/+page.svelte';
import EnvironmentsPage from '../../routes/environments/+page.svelte';
import RemindersPage from '../../routes/reminders/+page.svelte';
import NotFound from '../../routes/NotFound.svelte';

export const routes: Record<string, Component> = {
  '/': PianosPage,
  [ROUTES.pianos]: PianosPage,
  [ROUTES.tunings]: TuningsPage,
  [ROUTES.voicings]: VoicingsPage,
  [ROUTES.environments]: EnvironmentsPage,
  [ROUTES.reminders]: RemindersPage,
  '*': NotFound
};

export default routes;
