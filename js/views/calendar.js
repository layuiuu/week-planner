// 周历视图:手机上一列显示选中的那一天,宽屏上并排 7 列看整周。

import { el, toast, openSheet, checkButton } from '../ui.js';
import * as store from '../store.js';
import {
  WEEKDAYS,
  WEEKDAYS_SHORT,
  weekDatesOfKey,
  toISODate,
  formatMD,
  weekdayIndex,
  currentWeekKey,
  shiftWeekKey,
  weekLabel,
  todayISO,
} from '../dates.js';
import { effectiveBlocks, blockTimeLabel, categoryHue, cmpBlock } from '../blocks.js';
import { openTaskEditor, openWeekBlocksEditor } from './editors.js';

export function renderCalendar(root, ctx) {
  const state = store.getState();
  const weekKey = ctx.ui.week || currentWeekKey();
  const dates = weekDatesOfKey(weekKey);
  const today = todayISO();
  if (!dates.some((d) => toISODate(d) === ctx.ui.day)) ctx.ui.day = dates.find((d) => toISODate(d) === today) ? today : toISODate(dates[0]);

  const head = el(
    'header',
    { class: 'view-head' },
    el(
      'div',
      { class: 'week-nav' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '上一周', text: '‹', on: { click: () => goWeek(ctx, -1) } }),
      el('button', { class: 'week-label', type: 'button', title: '回到本周', on: { click: () => { ctx.ui.week = currentWeekKey(); ctx.ui.day = todayISO(); ctx.refresh(); } } },
        el('span', { text: weekLabel(weekKey) }),
      ),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '下一周', text: '›', on: { click: () => goWeek(ctx, 1) } }),
    ),
    el(
      'div',
      { class: 'head-actions' },
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '编辑本周板块', on: { click: () => openWeekBlocksEditor(weekKey, ctx) } }),
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: '＋ 任务', on: { click: () => openTaskEditor({ defaults: { date: ctx.ui.day }, ctx }) } }),
    ),
  );

  const isEmptyTemplate = !(state.blockTemplate || []).length && !(state.weekOverrides || {})[weekKey];

  // 手机顶部的日期条
  const strip = el(
    'div',
    { class: 'daystrip' },
    ...dates.map((date, i) => {
      const iso = toISODate(date);
      const tasks = store.tasksByDate(iso);
      const done = tasks.filter((t) => t.done).length;
      return el(
        'button',
        {
          type: 'button',
          class: `daychip${iso === ctx.ui.day ? ' is-active' : ''}${iso === today ? ' is-today' : ''}`,
          on: {
            click: () => {
              ctx.ui.day = iso;
              ctx.refresh();
            },
          },
        },
        el('span', { class: 'daychip-wd', text: WEEKDAYS_SHORT[i] }),
        el('span', { class: 'daychip-date', text: formatMD(date) }),
        tasks.length ? el('span', { class: `daychip-dot${done === tasks.length ? ' is-done' : ''}`, text: `${done}/${tasks.length}` }) : el('span', { class: 'daychip-dot is-empty', text: '·' }),
      );
    }),
  );

  const grid = el('div', { class: 'week-grid' });
  for (let i = 0; i < 7; i++) {
    const date = dates[i];
    const iso = toISODate(date);
    const col = buildDayColumn({ state, date, iso, ctx, active: iso === ctx.ui.day });
    if (iso === ctx.ui.day) col.classList.add('is-active');
    grid.append(col);
  }

  root.append(head, strip, grid);

  if (isEmptyTemplate && !store.getState().tasks.length) {
    root.append(
      el(
        'div',
        { class: 'onboarding' },
        el('h2', { text: '还没有每周框架' }),
        el('p', { text: '先到「设置」导入一张周表(Excel 或 CSV),系统会生成周一到周日的板块;再把任务清单导进来,任务就会挂到对应板块上。' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '去设置里导入', on: { click: () => ctx.go('settings') } }),
      ),
    );
  }
}

function goWeek(ctx, delta) {
  ctx.ui.week = shiftWeekKey(ctx.ui.week || currentWeekKey(), delta);
  ctx.refresh();
}

function buildDayColumn({ state, date, iso, ctx, active }) {
  const blocks = effectiveBlocks(state, ctx.ui.week).filter((b) => b.weekday === weekdayIndex(date));
  const tasks = store.tasksByDate(iso);
  const done = tasks.filter((t) => t.done).length;
  const isToday = iso === todayISO();

  const col = el('section', { class: 'day-col', dataset: { iso } });
  col.append(
    el(
      'header',
      { class: `day-col-head${isToday ? ' is-today' : ''}` },
      el('span', { class: 'day-col-name', text: WEEKDAYS[weekdayIndex(date) - 1] }),
      el('span', { class: 'day-col-date', text: formatMD(date) }),
      tasks.length ? el('span', { class: 'day-col-progress', text: `${done}/${tasks.length}` }) : null,
    ),
  );

  const body = el('div', { class: 'day-col-body' });

  // 没匹配到板块的任务放在最前面,避免被藏起来
  const orphan = tasks.filter((t) => !t.blockId);
  if (orphan.length) {
    body.append(buildOrphanCard(orphan, ctx));
  }

  const placedIds = new Set();
  for (const block of blocks.sort(cmpBlock)) {
    const blockTasks = tasks.filter((t) => t.blockId === block.id);
    blockTasks.forEach((t) => placedIds.add(t.id));
    body.append(buildBlockCard({ state, block, tasks: blockTasks, weekKey: ctx.ui.week, ctx }));
  }

  if (!blocks.length && !orphan.length) {
    body.append(
      el('p', { class: 'empty-hint' },
        '这一天没有板块。',
        el('button', { class: 'linklike', type: 'button', text: '给本周加一个', on: { click: () => openWeekBlocksEditor(ctx.ui.week, ctx) } }),
      ),
    );
  }

  col.append(body);

  const note = store.getDayNote(iso);
  const noteInput = el('textarea', {
    class: 'day-note',
    rows: 2,
    placeholder: '当天备注…',
    value: note,
    on: {
      change: () => {
        store.setDayNote(iso, noteInput.value);
        toast('已保存当天备注', 'success');
        ctx.refresh();
      },
    },
  });
  col.append(el('div', { class: 'day-note-wrap' }, noteInput));
  return col;
}

function buildBlockCard({ block, tasks, weekKey, ctx }) {
  const done = tasks.filter((t) => t.done).length;
  const note = store.getBlockNote(weekKey, block.id);
  const card = el('article', {
    class: 'block-card',
    dataset: { category: block.category },
    style: { '--cat-hue': String(categoryHue(block.category)) },
  });

  card.append(
    el(
      'header',
      { class: 'block-head' },
      el(
        'div',
        { class: 'block-title' },
        el('span', { class: 'block-name', text: block.name }),
        el('span', { class: 'cat-tag', text: block.category }),
        block.weekOnly ? el('span', { class: 'cat-tag week-only', text: '仅本周' }) : null,
      ),
      el('span', { class: 'block-meta' },
        el('span', { class: 'block-time', text: blockTimeLabel(block) }),
        tasks.length ? el('span', { class: `block-count${done === tasks.length ? ' is-done' : ''}`, text: `${done}/${tasks.length}` }) : null,
      ),
    ),
  );

  const list = el('ul', { class: 'task-list' });
  if (!tasks.length) list.append(el('li', { class: 'task-empty', text: '还没有任务' }));
  for (const task of tasks) list.append(buildTaskRow(task, ctx));
  card.append(list);

  if (note) card.append(el('p', { class: 'block-note', text: note }));

  card.append(
    el(
      'div',
      { class: 'block-foot' },
      el('button', { class: 'linklike', type: 'button', text: '＋ 加任务', on: { click: () => openTaskEditor({ defaults: { date: ctx.ui.day, blockName: block.name }, ctx }) } }),
      el('button', {
        class: 'linklike',
        type: 'button',
        text: note ? '改板块备注' : '板块备注',
        on: {
          click: () => {
            const input = el('textarea', { class: 'input', rows: 4, placeholder: '这个板块本周的备注…', value: note });
            const sheet = openSheet({
              title: `${block.name} · 板块备注`,
              body: el('div', { class: 'form' }, input),
              actions: [
                { label: '取消' },
                {
                  label: '保存',
                  kind: 'primary',
                  onClick: () => {
                    store.setBlockNote(weekKey, block.id, input.value);
                    sheet.close();
                    ctx.refresh();
                  },
                },
              ],
            });
            setTimeout(() => input.focus({ preventScroll: true }), 60);
          },
        },
      }),
    ),
  );
  return card;
}

function buildOrphanCard(tasks, ctx) {
  const card = el('article', { class: 'block-card is-orphan' });
  card.append(
    el(
      'header',
      { class: 'block-head' },
      el('div', { class: 'block-title' },
        el('span', { class: 'block-name', text: '未匹配板块' }),
        el('span', { class: 'cat-tag cat-tag-warn', text: '需要处理' }),
      ),
      el('span', { class: 'block-meta' }, el('span', { class: 'block-count', text: `${tasks.length} 条` })),
    ),
    el('p', { class: 'block-hint', text: '这些任务在周表里找不到对应板块(可能是板块名改了,或还没导入周表)。点任务可以重新选板块。' }),
  );
  const list = el('ul', { class: 'task-list' });
  for (const task of tasks) list.append(buildTaskRow(task, ctx));
  card.append(list);
  return card;
}

export function buildTaskRow(task, ctx) {
  const row = el('li', { class: `task${task.done ? ' is-done' : ''}` });
  row.append(
    checkButton({
      checked: task.done,
      label: task.done ? '标记为未完成' : '标记为完成',
      onChange: () => {
        store.toggleTask(task.id);
        ctx.refresh();
      },
    }),
    el(
      'button',
      { class: 'task-main', type: 'button', on: { click: () => openTaskEditor({ task, ctx }) } },
      el('span', { class: 'task-title', text: task.title }),
      task.note ? el('span', { class: 'task-note', text: task.note }) : null,
    ),
  );
  return row;
}
