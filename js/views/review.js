// 复盘视图:回看任意一周 —— 整体完成率、按类别、按板块、按天,以及未完成清单和复盘备注。

import { el, openSheet, toast } from '../ui.js';
import * as store from '../store.js';
import {
  WEEKDAYS,
  weekDatesOfKey,
  toISODate,
  formatMD,
  fromISODate,
  currentWeekKey,
  shiftWeekKey,
  weekLabel,
  todayISO,
} from '../dates.js';
import { categoryOfTask, blockOfTask } from '../blocks.js';
import { openTaskEditor } from './editors.js';

export function renderReview(root, ctx) {
  const state = store.getState();
  const weekKey = ctx.ui.reviewWeek || ctx.ui.week || currentWeekKey();
  const dates = weekDatesOfKey(weekKey);
  const today = todayISO();
  const tasks = store.tasksOfWeek(weekKey);
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0;

  root.append(
    el(
      'header',
      { class: 'view-head' },
      el(
        'div',
        { class: 'week-nav' },
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '上一周', text: '‹', on: { click: () => { ctx.ui.reviewWeek = shiftWeekKey(weekKey, -1); ctx.refresh(); } } }),
        el('button', { class: 'week-label', type: 'button', title: '回到本周', on: { click: () => { ctx.ui.reviewWeek = currentWeekKey(); ctx.refresh(); } } }, el('span', { text: weekLabel(weekKey) })),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': '下一周', text: '›', on: { click: () => { ctx.ui.reviewWeek = shiftWeekKey(weekKey, 1); ctx.refresh(); } } }),
      ),
    ),
  );

  if (!tasks.length) {
    root.append(
      el('div', { class: 'onboarding' },
        el('h2', { text: '这一周还没有记录' }),
        el('p', { text: '导入任务清单,或者直接添加任务,之后就能在这里回看完成情况。' }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '＋ 添加任务', on: { click: () => openTaskEditor({ defaults: { date: dates.find((d) => toISODate(d) === today) ? today : toISODate(dates[0]) }, ctx }) } }),
      ),
    );
    return;
  }

  // 总览
  root.append(
    el(
      'section',
      { class: 'panel' },
      el('div', { class: 'overview' },
        el('div', { class: 'overview-num' },
          el('strong', { text: String(pct) }),
          el('span', { text: '%' }),
        ),
        el('div', { class: 'overview-body' },
          el('p', { class: 'overview-line', text: `完成 ${doneCount} 项,未完成 ${tasks.length - doneCount} 项,共 ${tasks.length} 项` }),
          el('div', { class: 'bar bar-lg' }, el('div', { class: `bar-fill${pct === 100 ? ' is-done' : ''}`, style: { width: `${pct}%` } })),
          el('p', { class: 'muted', text: `未完成 ${tasks.length - doneCount} 项` }),
        ),
      ),
    ),
  );

  // 按类别
  const byCategory = new Map();
  for (const task of tasks) {
    const category = categoryOfTask(state, task);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(task);
  }
  root.append(
    buildSection('按类别完成情况', [...byCategory.entries()].map(([category, list]) => {
      const done = list.filter((t) => t.done).length;
      return progressRow(category, done, list.length);
    })),
  );

  // 按板块
  const byBlock = new Map();
  for (const task of tasks) {
    const block = blockOfTask(state, task);
    const key = block ? block.name : `未匹配板块:${task.blockName || '(空)'}`;
    if (!byBlock.has(key)) byBlock.set(key, []);
    byBlock.get(key).push(task);
  }
  root.append(
    buildSection('按板块完成情况', [...byBlock.entries()].map(([name, list]) => {
      const done = list.filter((t) => t.done).length;
      return progressRow(name, done, list.length);
    })),
  );

  // 按天
  const dayRows = dates.map((date, i) => {
    const iso = toISODate(date);
    const dayTasks = store.tasksByDate(iso);
    const done = dayTasks.filter((t) => t.done).length;
    const unfinished = dayTasks.filter((t) => !t.done);
    const note = store.getDayNote(iso);
    return el(
      'div',
      { class: `review-day${iso === today ? ' is-today' : ''}` },
      el(
        'div',
        { class: 'review-day-head' },
        el('span', { class: 'review-day-name', text: WEEKDAYS[i] }),
        el('span', { class: 'review-day-date', text: formatMD(date) }),
        el('span', { class: `review-day-count${dayTasks.length && done === dayTasks.length ? ' is-done' : ''}`, text: dayTasks.length ? `${done}/${dayTasks.length}` : '—' }),
      ),
      dayTasks.length
        ? el('div', { class: 'review-day-body' },
            unfinished.length
              ? el('ul', { class: 'review-unfinished' }, ...unfinished.map((t) => el('li', {}, el('span', { class: 'dot-unfinished' }), `${t.title}${t.blockName ? ` · ${t.blockName}` : ''}`)))
              : el('p', { class: 'review-all-done', text: '全部完成 ✓' }),
          )
        : el('p', { class: 'muted', text: '没有任务' }),
      note ? el('p', { class: 'review-note', text: `备注:${note}` }) : null,
      el('button', {
        class: 'linklike',
        type: 'button',
        text: note ? '改当天备注' : '写当天备注',
        on: {
          click: () => {
            const input = el('textarea', { class: 'input', rows: 3, value: note, placeholder: '这一天的复盘…' });
            const sheet = openSheet({
              title: `${WEEKDAYS[i]} ${formatMD(date)} · 当天备注`,
              body: el('div', { class: 'form' }, input),
              actions: [
                { label: '取消' },
                { label: '保存', kind: 'primary', onClick: () => { store.setDayNote(iso, input.value); sheet.close(); ctx.refresh(); } },
              ],
            });
            setTimeout(() => input.focus({ preventScroll: true }), 60);
          },
        },
      }),
    );
  });
  root.append(buildSection('每天的情况', dayRows));

  // 未匹配任务
  const unmatched = tasks.filter((t) => !t.blockId);
  if (unmatched.length) {
    root.append(
      el('section', { class: 'panel' },
        el('h3', { class: 'section-title', text: `未匹配板块的任务(${unmatched.length})` }),
        el('p', { class: 'muted', text: '这些任务在周表里找不到同名板块,所以没有被放进任何板块。点一下就能重新指定。' }),
        el('ul', { class: 'task-list' },
          ...unmatched.map((t) => el('li', { class: 'task' },
            el('button', { class: 'task-main', type: 'button', on: { click: () => openTaskEditor({ task: t, ctx }) } },
              el('span', { class: 'task-title', text: t.title }),
              el('span', { class: 'task-note', text: `${formatMD(fromISODate(t.date) || new Date())} · 板块「${t.blockName || '(空)'}」` }),
            ),
          )),
        ),
      ),
    );
  }

  // 本周复盘备注
  const weekNoteInput = el('textarea', { class: 'input', rows: 4, placeholder: '这一周整体做得怎么样?有什么要调整的?', value: store.getWeekNote(weekKey) });
  root.append(
    el('section', { class: 'panel' },
      el('h3', { class: 'section-title', text: '本周复盘备注' }),
      weekNoteInput,
      el('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        text: '保存备注',
        on: {
          click: () => {
            store.setWeekNote(weekKey, weekNoteInput.value);
            toast('已保存本周备注', 'success');
            ctx.refresh();
          },
        },
      }),
    ),
  );
}

function buildSection(title, rows) {
  return el('section', { class: 'panel' }, el('h3', { class: 'section-title', text: title }), ...(rows.length ? rows : [el('p', { class: 'muted', text: '暂无数据' })]));
}

function progressRow(name, done, total, sub) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const remaining = total - done;
  const subText = sub || (total === 0 ? '' : remaining === 0 ? '全部完成' : `还有 ${remaining} 项未完成`);
  return el(
    'div',
    { class: 'progress-row' },
    el('div', { class: 'progress-row-head' },
      el('span', { class: 'progress-name', text: name }),
      el('span', { class: `progress-count${total && done === total ? ' is-done' : ''}`, text: `${done}/${total}` }),
    ),
    el('div', { class: 'bar' }, el('div', { class: `bar-fill${total && done === total ? ' is-done' : ''}`, style: { width: `${pct}%` } })),
    subText ? el('span', { class: 'progress-sub', text: subText }) : null,
  );
}
