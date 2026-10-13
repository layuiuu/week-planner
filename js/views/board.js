// 看板视图:默认看「今天」,纵向排列,按板块折叠(默认收起,点标题展开)。

import { el, ICON } from '../ui.js';
import * as store from '../store.js';
import {
  fromISODate,
  weekLabel,
  formatMD,
  currentWeekKey,
  todayISO,
  toISODate,
  weekDatesOfKey,
  weekdayIndex,
} from '../dates.js';
import { effectiveBlocks, categoryStyle, blockTimeLabel, cmpBlock, blockOfTask } from '../blocks.js';
import { openTaskEditor } from './editors.js';
import { buildTaskRow } from './calendar.js';

const UNMATCHED = '未匹配板块';

export function renderBoard(root, ctx) {
  const state = store.getState();
  const scope = ctx.ui.boardScope === 'week' ? 'week' : 'day'; // 默认今日
  const weekKey = ctx.ui.week || currentWeekKey();
  const day = ctx.ui.boardDay || todayISO();

  root.append(
    el(
      'header',
      { class: 'view-head' },
      el('h1', { class: 'view-title', text: '看板' }),
      el(
        'div',
        { class: 'segmented' },
        segButton('今日', scope === 'day', () => {
          ctx.ui.boardScope = 'day';
          ctx.ui.boardDay = ctx.ui.boardDay || todayISO();
          ctx.refresh();
        }),
        segButton('本周', scope === 'week', () => {
          ctx.ui.boardScope = 'week';
          ctx.refresh();
        }),
      ),
      scope === 'day'
        ? el('input', {
            class: 'input input-sm date-input',
            type: 'date',
            value: day,
            on: {
              change: (e) => {
                ctx.ui.boardDay = e.target.value || todayISO();
                ctx.refresh();
              },
            },
          })
        : null,
    ),
  );

  const tasks = scope === 'day' ? store.tasksByDate(day) : store.tasksOfWeek(weekKey);
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const scopeLabel = scope === 'day' ? `${day === todayISO() ? '今天' : '这一天'} · ${formatMD(fromISODate(day) || new Date())}` : weekLabel(weekKey);

  root.append(
    el('div', { class: 'board-scope' },
      el('span', { class: 'muted', text: scopeLabel }),
      el('span', { class: `board-total${total && done === total ? ' is-done' : ''}`, text: `完成 ${done}/${total}` }),
    ),
  );

  if (!total) {
    root.append(
      el('div', { class: 'onboarding' },
        el('h2', { text: scope === 'day' ? '今天还没有任务' : '这一周还没有任务' }),
        el('p', { text: '可以直接加一条任务,或者到「设置」导入任务清单。' }),
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: '＋ 添加任务',
          on: { click: () => openTaskEditor({ defaults: { date: scope === 'day' ? day : defaultWeekDate(ctx) }, ctx }) },
        }),
      ),
    );
    return;
  }

  // 按板块名称分组(本周范围会把同名板块汇总到一起)
  const order = new Map();
  effectiveBlocks(state, weekKey).forEach((block, index) => {
    if (!order.has(block.name)) order.set(block.name, index);
  });

  const groups = new Map();
  for (const task of tasks) {
    const block = blockOfTask(state, task);
    const name = block ? block.name : UNMATCHED;
    if (!groups.has(name)) {
      groups.set(name, { name, category: block ? block.category : null, block, tasks: [] });
    }
    groups.get(name).tasks.push(task);
  }

  const sorted = [...groups.values()].sort((a, b) => {
    if (a.name === UNMATCHED) return 1;
    if (b.name === UNMATCHED) return -1;
    return (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999);
  });

  ctx.ui.boardExpanded = ctx.ui.boardExpanded || {};
  const listEl = el('div', { class: 'accordion' });
  for (const group of sorted) listEl.append(buildGroup({ group, scope, day, weekKey, ctx }));
  root.append(listEl);
}

function segButton(label, active, onClick) {
  return el('button', { type: 'button', class: `seg${active ? ' is-active' : ''}`, text: label, on: { click: onClick } });
}

function defaultWeekDate(ctx) {
  const dates = weekDatesOfKey(ctx.ui.week || currentWeekKey()).map(toISODate);
  const today = todayISO();
  return dates.includes(today) ? today : dates[0];
}

function buildGroup({ group, scope, day, weekKey, ctx }) {
  const key = `${scope}|${scope === 'day' ? day : weekKey}|${group.name}`;
  const expanded = !!ctx.ui.boardExpanded[key];
  const done = group.tasks.filter((t) => t.done).length;

  const head = el(
    'button',
    {
      type: 'button',
      class: `acc-head${expanded ? ' is-open' : ''}`,
      'aria-expanded': expanded ? 'true' : 'false',
      on: {
        click: () => {
          ctx.ui.boardExpanded[key] = !expanded;
          ctx.refresh();
        },
      },
    },
    el('span', { class: 'acc-chevron', 'aria-hidden': 'true', html: ICON.chevronDown }),
    el('span', { class: `cat-dot${group.category ? '' : ' is-plain'}`, style: group.category ? categoryStyle(group.category) : null }),
    el('span', { class: 'acc-name', text: group.name }),
    group.category ? el('span', { class: 'acc-cat', text: group.category }) : null,
    scope === 'day' && group.block ? el('span', { class: 'acc-time', text: blockTimeLabel(group.block) }) : null,
    el('span', { class: `acc-count${done === group.tasks.length ? ' is-done' : ''}`, text: `${done}/${group.tasks.length}` }),
  );

  const section = el('section', { class: `acc${expanded ? ' is-open' : ''}` }, head);
  if (expanded) {
    const body = el('div', { class: 'acc-body' });
    const list = el('ul', { class: 'task-list' });
    for (const task of group.tasks) list.append(buildTaskRow(task, ctx));
    body.append(list);
    body.append(
      el('div', { class: 'acc-foot' },
        el('button', {
          class: 'linklike',
          type: 'button',
          text: '＋ 加任务',
          on: {
            click: () =>
              openTaskEditor({
                defaults: { date: scope === 'day' ? day : defaultWeekDate(ctx), blockName: group.name === UNMATCHED ? '' : group.name },
                ctx,
              }),
          },
        }),
      ),
    );
    section.append(body);
  }
  return section;
}
