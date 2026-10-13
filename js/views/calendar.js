// 周历视图:手机上一列显示选中的那一天,宽屏上并排 7 列看整周。
// 顶部导航吸顶;进入页面时把「当前时段」的板块自动对齐到显示区顶部。

import { el, toast, openSheet, checkButton, openPopover, closePopover, isPopoverOpenFor, ICON } from '../ui.js';
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
import { effectiveBlocks, blockTimeLabel, categoryStyle, cmpBlock } from '../blocks.js';
import { openTaskEditor, openWeekBlocksEditor } from './editors.js';

export function renderCalendar(root, ctx) {
  const state = store.getState();
  const weekKey = ctx.ui.week || currentWeekKey();
  const dates = weekDatesOfKey(weekKey);
  const today = todayISO();
  if (!dates.some((d) => toISODate(d) === ctx.ui.day)) {
    ctx.ui.day = dates.some((d) => toISODate(d) === today) ? today : toISODate(dates[0]);
  }

  root.append(buildStickyNav({ weekKey, dates, today, ctx }));

  const grid = el('div', { class: 'week-grid' });
  for (let i = 0; i < 7; i++) {
    const date = dates[i];
    const iso = toISODate(date);
    const col = buildDayColumn({ state, date, iso, ctx });
    if (iso === ctx.ui.day) col.classList.add('is-active');
    grid.append(col);
  }
  root.append(grid);

  if (!(state.blockTemplate || []).length && !state.tasks.length) {
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

  scheduleAutoScroll(ctx);
}

/* ---------------- 顶部吸顶区 ---------------- */

function buildStickyNav({ weekKey, dates, today, ctx }) {
  const moreBtn = el('button', {
    type: 'button',
    class: 'icon-btn more-btn',
    'aria-label': '更多操作',
    'aria-haspopup': 'menu',
    html: ICON.more,
    on: {
      click: (event) => {
        event.stopPropagation();
        const anchor = event.currentTarget;
        if (isPopoverOpenFor(anchor)) {
          closePopover();
          return;
        }
        openPopover({
          anchor,
          items: [
            { label: '添加任务', icon: ICON.plus, onClick: () => openTaskEditor({ defaults: { date: ctx.ui.day }, ctx }) },
            { label: '编辑本周板块', icon: ICON.sliders, onClick: () => openWeekBlocksEditor(weekKey, ctx) },
            {
              label: '回到本周',
              icon: ICON.calendar,
              onClick: () => {
                ctx.ui.week = currentWeekKey();
                ctx.ui.day = todayISO();
                ctx.refresh();
              },
            },
          ],
        });
      },
    },
  });

  return el(
    'div',
    { class: 'cal-sticky' },
    el(
      'div',
      { class: 'week-nav' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '上一周', text: '‹', on: { click: () => goWeek(ctx, -1) } }),
      el(
        'button',
        { class: 'week-label', type: 'button', title: '回到本周', on: { click: () => { ctx.ui.week = currentWeekKey(); ctx.ui.day = todayISO(); ctx.refresh(); } } },
        el('span', { text: weekLabel(weekKey) }),
      ),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': '下一周', text: '›', on: { click: () => goWeek(ctx, 1) } }),
      moreBtn,
    ),
    el(
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
          tasks.length
            ? el('span', { class: `daychip-dot${done === tasks.length ? ' is-done' : ''}`, text: `${done}/${tasks.length}` })
            : el('span', { class: 'daychip-dot is-empty', text: '·' }),
        );
      }),
    ),
  );
}

function goWeek(ctx, delta) {
  ctx.ui.week = shiftWeekKey(ctx.ui.week || currentWeekKey(), delta);
  ctx.refresh();
}

/* ---------------- 时间轴自动定位 ---------------- */

function scheduleAutoScroll(ctx) {
  // 每次重绘都重新标记「当前时段」的板块(否则勾选任务、改数据后提示会消失);
  // 但只在第一次进入这个「周 + 日」时滚动,避免交互时被反复拉走。
  const key = `${ctx.ui.week}|${ctx.ui.day}`;
  const shouldScroll = ctx.ui.autoScrolledKey !== key;

  setTimeout(() => {
    const col = document.querySelector('.day-col.is-active') || document.querySelector('.day-col');
    if (!col) return;
    const cards = [...col.querySelectorAll('.block-card:not(.is-orphan)')];
    if (!cards.length) return;

    // 现在几点:取「开始时间 ≤ 现在」的最后一个板块;今天还没开始就取第一个
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (text) => {
      const m = String(text || '').match(/^(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    let target = null;
    for (const card of cards) {
      const start = toMinutes(card.dataset.start);
      if (start != null && start <= nowMinutes) target = card;
    }
    if (!target) target = cards[0];
    target.classList.add('is-now');

    if (!shouldScroll) return;
    ctx.ui.autoScrolledKey = key;
    const sticky = document.querySelector('.cal-sticky');
    const offset = (sticky ? sticky.getBoundingClientRect().height : 0) + 8;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }, 0);
}

/* ---------------- 某一天 ---------------- */

function buildDayColumn({ state, date, iso, ctx }) {
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

  const orphan = tasks.filter((t) => !t.blockId);
  if (orphan.length) body.append(buildOrphanCard(orphan, ctx));

  for (const block of [...blocks].sort(cmpBlock)) {
    const blockTasks = tasks.filter((t) => t.blockId === block.id);
    body.append(buildBlockCard({ block, tasks: blockTasks, weekKey: ctx.ui.week, ctx }));
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

  const noteInput = el('textarea', {
    class: 'day-note',
    rows: 2,
    placeholder: '当天备注…',
    value: store.getDayNote(iso),
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

/* ---------------- 板块卡片 ---------------- */

function buildBlockCard({ block, tasks, weekKey, ctx }) {
  const done = tasks.filter((t) => t.done).length;
  const note = store.getBlockNote(weekKey, block.id);
  const card = el('article', {
    class: 'block-card',
    dataset: { category: block.category, start: block.start || '' },
    style: categoryStyle(block.category),
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
      el('button', {
        type: 'button',
        class: 'icon-btn plus-btn',
        'aria-label': `${block.name} 的操作`,
        'aria-haspopup': 'menu',
        html: ICON.plus,
        on: {
          click: (event) => {
            event.stopPropagation();
            const anchor = event.currentTarget;
            if (isPopoverOpenFor(anchor)) {
              closePopover();
              return;
            }
            openPopover({
              anchor,
              items: [
                { label: '加任务', icon: ICON.plus, onClick: () => openTaskEditor({ defaults: { date: ctx.ui.day, blockName: block.name }, ctx }) },
                { label: note ? '改板块备注' : '板块备注', icon: ICON.note, onClick: () => openBlockNoteEditor({ block, weekKey, note, ctx }) },
              ],
            });
          },
        },
      }),
      el(
        'div',
        { class: 'block-meta' },
        el('span', { class: 'block-time', text: blockTimeLabel(block) }),
        tasks.length ? el('span', { class: `block-count${done === tasks.length ? ' is-done' : ''}`, text: `${done}/${tasks.length}` }) : null,
      ),
    ),
  );

  // 没有任务就留白,不显示「还没有任务」
  if (tasks.length) {
    const list = el('ul', { class: 'task-list' });
    for (const task of tasks) list.append(buildTaskRow(task, ctx));
    card.append(list);
  }

  if (note) card.append(el('p', { class: 'block-note', text: note }));
  return card;
}

function openBlockNoteEditor({ block, weekKey, note, ctx }) {
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
}

function buildOrphanCard(tasks, ctx) {
  const card = el('article', { class: 'block-card is-orphan' });
  card.append(
    el(
      'header',
      { class: 'block-head is-plain' },
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
