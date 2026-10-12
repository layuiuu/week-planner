// 看板视图:按「类别」把任务分组,方便看推进。

import { el } from '../ui.js';
import * as store from '../store.js';
import {
  fromISODate,
  weekLabel,
  formatMD,
  currentWeekKey,
  todayISO,
  toISODate,
  weekDatesOfKey,
} from '../dates.js';
import { effectiveBlocks, categoriesOf, cmpBlock, categoryOfTask, categoryHue } from '../blocks.js';
import { openTaskEditor } from './editors.js';
import { buildTaskRow } from './calendar.js';

export function renderBoard(root, ctx) {
  const state = store.getState();
  const scope = ctx.ui.boardScope || 'week';
  const weekKey = ctx.ui.week || currentWeekKey();

  const head = el(
    'header',
    { class: 'view-head' },
    el('h1', { class: 'view-title', text: '看板' }),
    el(
      'div',
      { class: 'segmented' },
      segButton('本周', scope === 'week', () => {
        ctx.ui.boardScope = 'week';
        ctx.refresh();
      }),
      segButton('单日', scope === 'day', () => {
        ctx.ui.boardScope = 'day';
        ctx.refresh();
      }),
    ),
  );

  let tasks;
  let scopeLabel;
  if (scope === 'day') {
    const day = ctx.ui.boardDay || todayISO();
    tasks = store.tasksByDate(day);
    scopeLabel = `${formatMD(fromISODate(day) || new Date())} 这一天`;
    head.append(
      el('input', {
        class: 'input input-sm date-input',
        type: 'date',
        value: day,
        on: {
          change: (e) => {
            ctx.ui.boardDay = e.target.value || todayISO();
            ctx.refresh();
          },
        },
      }),
    );
  } else {
    tasks = store.tasksOfWeek(weekKey);
    scopeLabel = weekLabel(weekKey);
  }

  // 分组:按任务所属板块的「类别」;找不到板块的归到「未匹配」
  const groups = new Map();
  for (const task of tasks) {
    const category = categoryOfTask(state, task);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(task);
  }

  const blocks = effectiveBlocks(state, weekKey);
  const orderedCategories = [...categoriesOf(blocks), ...groups.keys()].filter((c, i, arr) => arr.indexOf(c) === i);

  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  root.append(
    head,
    el(
      'div',
      { class: 'board-scope' },
      el('span', { class: 'muted', text: scopeLabel }),
      el('span', { class: `board-total${total && done === total ? ' is-done' : ''}`, text: `完成 ${done}/${total}` }),
    ),
  );

  if (!total) {
    root.append(
      el('div', { class: 'onboarding' },
        el('h2', { text: '这个范围里还没有任务' }),
        el('p', { text: '可以直接加一条任务,或者到「设置」导入任务清单。' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '＋ 添加任务', on: { click: () => openTaskEditor({ defaults: { date: defaultDateFor(ctx) }, ctx }) } }),
      ),
    );
    return;
  }

  const board = el('div', { class: 'kanban' });
  for (const category of orderedCategories) {
    const groupTasks = groups.get(category) || [];
    if (!groupTasks.length) continue;
    const groupDone = groupTasks.filter((t) => t.done).length;
    const pct = Math.round((groupDone / groupTasks.length) * 100);
    board.append(
      el(
        'section',
        { class: `kanban-col${category === '未匹配' ? ' is-unmatched' : ''}`, style: { '--cat-hue': String(categoryHue(category)) } },
        el(
          'header',
          { class: 'kanban-head' },
          el('div', { class: 'kanban-title' },
            el('span', { class: 'kanban-name', text: category }),
            el('span', { class: 'kanban-count', text: `${groupDone}/${groupTasks.length}` }),
          ),
          el('div', { class: 'bar' }, el('div', { class: `bar-fill${groupDone === groupTasks.length ? ' is-done' : ''}`, style: { width: `${pct}%` } })),
          el('button', {
            class: 'linklike',
            type: 'button',
            text: '＋ 加任务',
            on: {
              click: () =>
                openTaskEditor({
                  defaults: { date: defaultDateFor(ctx), blockName: firstBlockNameOfCategory(state, weekKey, category) },
                  ctx,
                }),
            },
          }),
        ),
        el('ul', { class: 'kanban-list' }, ...groupTasks.map((task) => buildBoardCard(task, ctx))),
      ),
    );
  }
  root.append(board);
}

function segButton(label, active, onClick) {
  return el('button', { type: 'button', class: `seg${active ? ' is-active' : ''}`, text: label, on: { click: onClick } });
}

function defaultDateFor(ctx) {
  if ((ctx.ui.boardScope || 'week') === 'day') return ctx.ui.boardDay || todayISO();
  const dates = weekDatesOfKey(ctx.ui.week || currentWeekKey()).map(toISODate);
  const today = todayISO();
  return dates.includes(today) ? today : dates[0];
}

function firstBlockNameOfCategory(state, weekKey, category) {
  const blocks = effectiveBlocks(state, weekKey).sort(cmpBlock);
  const block = blocks.find((b) => b.category === category);
  return block ? block.name : '';
}

function buildBoardCard(task, ctx) {
  const row = buildTaskRow(task, ctx);
  row.classList.add('kanban-card');
  const main = row.querySelector('.task-main');
  if (main) {
    const meta = el('span', { class: 'card-meta' },
      el('span', { text: formatMD(fromISODate(task.date) || new Date()) }),
      task.blockName ? el('span', { class: 'card-block', text: task.blockName }) : null,
    );
    main.append(meta);
  }
  return row;
}
