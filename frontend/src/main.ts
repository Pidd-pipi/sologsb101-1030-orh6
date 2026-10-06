import { mount } from 'svelte';
import App from './App.svelte';
import { DEFAULT_PATH, installRouter } from '$lib/router';
import './app.css';

const target = document.getElementById('app');
if (!target) {
  throw new Error('缺少 #app 挂载点');
}

// 先安装真实路径（history）路由：首屏按 location.pathname 匹配模块，
// 根路径规范化为默认模块 /pianos，之后再挂载应用，避免首屏闪回默认页。
installRouter({ defaultPath: DEFAULT_PATH });

const app = mount(App, { target });

export default app;
