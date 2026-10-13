// 入口:底部标签路由 + 数据变化后重绘。

import * as store from './store.js';
import { currentWeekKey, todayISO } from './dates.js';
import { clear, toast, el } from './ui.js';
import { renderCalendar } from './views/calendar.js';
import { renderBoard } from './views/board.js';
import { renderReview } from './views/review.js';
import { renderSettings } from './views/settings.js';
import { openTaskEditor, openWeekBlocksEditor } from './views/editors.js';

// 标签栏:图标用内联线性 SVG(24×24、currentColor,跟随选中色)
const ICONS = {
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3.5" y="5.5" width="17" height="15" rx="3.5"/><path d="M3.5 10.5h17M8.5 3.5v3.5M15.5 3.5v3.5"/></svg>',
  board:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="3.5" y="4.5" width="7.5" height="15" rx="2.5"/><rect x="13" y="4.5" width="7.5" height="9.5" rx="2.5"/></svg>',
  review:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 20v-8M12 20V5M18 20v-5.5"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8.5h9M17.5 8.5H20M4 15.5h2.5M11 15.5h9"/><circle cx="15.2" cy="8.5" r="2.2"/><circle cx="8.8" cy="15.5" r="2.2"/></svg>',
};

const TABS = [
  { id: 'calendar', label: '周历', icon: ICONS.calendar },
  { id: 'board', label: '看板', icon: ICONS.board },
  { id: 'review', label: '复盘', icon: ICONS.review },
  { id: 'settings', label: '设置', icon: ICONS.settings },
];

const ui = {
  tab: 'calendar',
  week: currentWeekKey(),
  day: todayISO(),
  boardScope: 'day',
  boardDay: todayISO(),
  reviewWeek: currentWeekKey(),
  boardExpanded: {},
  autoScrolledKey: null,
};

const ctx = {
  get state() {
    return store.getState();
  },
  ui,
  refresh: requestRender,
  go(tab) {
    ui.tab = tab;
    // 每次「进入周历页」都重新按当前时间定位一次
    if (tab === 'calendar') ui.autoScrolledKey = null;
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
  positionTabPill(tabChanged);
}

/** 让选中高亮块滑到当前标签下面 */
function positionTabPill(animate) {
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  const pill = bar.querySelector('.tab-pill');
  const active = bar.querySelector('.tab.is-active');
  if (!pill || !active) return;
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
  pill.style.height = `${active.offsetHeight}px`;
  // 首次定位完成后再打开过渡,避免入场时从左边滑过来
  if (animate || !pill.classList.contains('is-ready')) {
    setTimeout(() => pill.classList.add('is-ready'), 0);
  }
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  const pill = el('span', { class: 'tab-pill', 'aria-hidden': 'true' });
  const buttons = TABS.map((tab) => {
    const icon = el('span', { class: 'tab-icon', 'aria-hidden': 'true' });
    icon.innerHTML = tab.icon; // 静态图标字符串,不是用户输入
    return el(
      'button',
      {
        type: 'button',
        class: 'tab',
        role: 'tab',
        'aria-selected': 'false',
        dataset: { tab: tab.id },
        on: { click: () => ctx.go(tab.id) },
      },
      icon,
      el('span', { class: 'tab-label', text: tab.label }),
    );
  });
  bar.replaceChildren(pill, ...buttons);
  window.addEventListener('resize', () => positionTabPill(false));
  window.addEventListener('orientationchange', () => positionTabPill(false));
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

  // 跨天回到前台:自动跳到新的「今天」
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const today = todayISO();
    if (ui.day === today) return;
    ui.week = currentWeekKey();
    ui.day = today;
    ui.boardDay = today;
    ui.reviewWeek = currentWeekKey();
    ui.autoScrolledKey = null;
    requestRender();
  });

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
