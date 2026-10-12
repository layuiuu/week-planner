// 入口:底部标签路由 + 数据变化后重绘。

import * as store from './store.js';
import { currentWeekKey, todayISO } from './dates.js';
import { clear, toast, el } from './ui.js';
import { renderCalendar } from './views/calendar.js';
import { renderBoard } from './views/board.js';
import { renderReview } from './views/review.js';
import { renderSettings } from './views/settings.js';
import { openTaskEditor, openWeekBlocksEditor } from './views/editors.js';

const TABS = [
  { id: 'calendar', label: '周历', icon: '▦' },
  { id: 'board', label: '看板', icon: '▤' },
  { id: 'review', label: '复盘', icon: '◑' },
  { id: 'settings', label: '设置', icon: '⚙' },
];

const ui = {
  tab: 'calendar',
  week: currentWeekKey(),
  day: todayISO(),
  boardScope: 'week',
  boardDay: todayISO(),
  reviewWeek: currentWeekKey(),
};

const ctx = {
  get state() {
    return store.getState();
  },
  ui,
  refresh: requestRender,
  go(tab) {
    ui.tab = tab;
    lastTab = null;
    render();
  },
  openTaskEditor: (opts) => openTaskEditor({ ...opts, ctx }),
  openWeekBlocksEditor: (weekKey) => openWeekBlocksEditor(weekKey, ctx),
};

let renderQueued = false;
let lastTab = null;

const schedule = typeof queueMicrotask === 'function' ? queueMicrotask : (fn) => setTimeout(fn, 0);

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  // 同一轮里的多次改动合并成一次重绘。用微任务而不是 requestAnimationFrame:
  // 后台标签页会暂停 rAF,那样界面就不会更新了。
  schedule(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  const view = document.getElementById('view');
  clear(view);

  const tabChanged = lastTab !== ui.tab;
  lastTab = ui.tab;

  for (const btn of document.querySelectorAll('#tabbar .tab')) {
    btn.classList.toggle('is-active', btn.dataset.tab === ui.tab);
    btn.setAttribute('aria-selected', btn.dataset.tab === ui.tab ? 'true' : 'false');
  }

  const renderers = {
    calendar: renderCalendar,
    board: renderBoard,
    review: renderReview,
    settings: renderSettings,
  };
  (renderers[ui.tab] || renderCalendar)(view, ctx);

  if (tabChanged) window.scrollTo({ top: 0 });
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  bar.replaceChildren(
    ...TABS.map((tab) =>
      el(
        'button',
        {
          type: 'button',
          class: 'tab',
          role: 'tab',
          'aria-selected': 'false',
          dataset: { tab: tab.id },
          on: { click: () => ctx.go(tab.id) },
        },
        el('span', { class: 'tab-icon', 'aria-hidden': 'true', text: tab.icon }),
        el('span', { class: 'tab-label', text: tab.label }),
      ),
    ),
  );
}

function applyAppName() {
  const name = store.getState().settings.appName || '周计划';
  document.title = name;
}

function main() {
  buildTabbar();
  applyAppName();
  document.getElementById('app').classList.add('is-ready');
  render();

  store.subscribe(() => {
    applyAppName();
    requestRender();
  });

  if (store.getStorageError()) {
    toast('无法写入本地存储,数据不会被保存', 'error', 5000);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('Service Worker 注册失败(不影响使用)', err);
      });
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else main();
