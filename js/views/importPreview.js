// 导入确认页:选文件 → 解析 → 预览 + 校验 → 用户点确认才写入。

import { el, openSheet, toast, clear } from '../ui.js';
import * as store from '../store.js';
import { readTable, WEEK_HEADER_TEXT, TASK_HEADER_TEXT, WEEK_SPEC, TASK_SPEC } from '../parse.js';
import { weekdayLabel, toISODate } from '../dates.js';
import { analyzeWeek, analyzeTasks, applyWeekImport, applyTaskImport, rematchAllTasks } from '../importers.js';

export async function startImport({ kind, file, ctx }) {
  const isWeek = kind === 'week';
  const sheet = openSheet({
    title: isWeek ? '导入周表' : '导入任务清单',
    subtitle: file.name,
    body: el('p', { class: 'sheet-text muted', text: '正在读取文件…' }),
    actions: [{ label: '取消' }],
  });

  let analysis;
  try {
    const table = await readTable(file, isWeek ? WEEK_SPEC : TASK_SPEC);
    analysis = isWeek ? analyzeWeek(table) : analyzeTasks(table, store.getState());
    if (table.sheetName) {
      const others = (table.sheetNames || []).filter((n) => n !== table.sheetName);
      sheet.setSubtitle(
        others.length
          ? `${file.name} · 读的是工作表「${table.sheetName}」(这份文件还有:${others.join('、')})`
          : `${file.name} · 工作表「${table.sheetName}」`,
      );
    }
  } catch (err) {
    clear(sheet.body).append(
      el('div', { class: 'alert alert-error' }, el('strong', { text: '读不了这个文件' }), el('p', { text: err.message })),
      el('p', { class: 'sheet-text muted', text: `需要的表头是:${isWeek ? WEEK_HEADER_TEXT : TASK_HEADER_TEXT}` }),
    );
    sheet.setActions([{ label: '关闭' }]);
    return;
  }

  renderPreview(sheet, { kind, analysis, ctx });
}

function renderPreview(sheet, { kind, analysis, ctx }) {
  const isWeek = kind === 'week';
  const { stats, errors, warnings } = analysis;
  clear(sheet.body);

  const options = el('div', { class: 'import-options' });
  let mode = 'replace';
  let skipDuplicates = true;

  if (isWeek) {
    const makeRadio = (value, label, hint) => {
      const input = el('input', { type: 'radio', name: 'week-mode', value, checked: value === mode });
      input.addEventListener('change', () => {
        mode = value;
      });
      return el('label', { class: `radio ${value === mode ? 'is-checked' : ''}` }, input, el('span', { class: 'radio-body' }, el('strong', { text: label }), el('span', { class: 'radio-hint', text: hint })));
    };
    options.append(
      makeRadio('replace', '替换现有周表', '把现在的每周框架整个换成这张表'),
      makeRadio('merge', '合并到现有周表', '同一天的同一个板块名称会被更新,其余保留'),
    );
  } else {
    const input = el('input', { type: 'checkbox', checked: true });
    input.addEventListener('change', () => {
      skipDuplicates = input.checked;
    });
    options.append(
      el('label', { class: 'radio is-checked' }, input, el('span', { class: 'radio-body' }, el('strong', { text: '跳过重复任务' }), el('span', { class: 'radio-hint', text: '同一天、同一板块、同样内容的任务只保留一条' }))),
    );
  }

  const statLine = el('div', { class: 'import-stats' },
    stat('共读取', `${stats.total} 行`),
    stat('将写入', `${stats.ok} 条`, 'good'),
    stats.errors ? stat('错误', `${stats.errors} 行`, 'bad') : null,
    stats.warnings ? stat('提醒', `${stats.warnings} 条`, 'warn') : null,
    stats.duplicates ? stat('重复', `${stats.duplicates} 条`, 'warn') : null,
    stats.unmatched ? stat('未匹配板块', `${stats.unmatched} 条`, 'warn') : null,
  );

  const blocks = [];
  blocks.push(el('div', { class: 'import-summary' }, statLine, options));

  if (errors.length) {
    blocks.push(
      el(
        'section',
        { class: 'alert alert-error' },
        el('strong', { text: `有 ${errors.length} 行读不了,这些行不会被导入` }),
        el(
          'ul',
          { class: 'issue-list' },
          ...errors.slice(0, 20).map((e) =>
            el('li', {}, el('span', { class: 'issue-row', text: e.row ? `第 ${e.row} 行` : '' }), el('span', { text: e.messages.join(';') }), e.cells ? el('span', { class: 'issue-cells', text: e.cells.map(fmtCell).join(' | ') }) : null),
          ),
        ),
        errors.length > 20 ? el('p', { class: 'muted', text: `……还有 ${errors.length - 20} 行` }) : null,
      ),
    );
  }

  if (warnings.length) {
    blocks.push(
      el(
        'section',
        { class: 'alert alert-warn' },
        el('strong', { text: `有 ${warnings.length} 条提醒(不影响导入)` }),
        el(
          'ul',
          { class: 'issue-list' },
          ...warnings.slice(0, 12).map((w) => el('li', {}, w.row ? el('span', { class: 'issue-row', text: `第 ${w.row} 行` }) : null, el('span', { text: w.message }))),
        ),
        warnings.length > 12 ? el('p', { class: 'muted', text: `……还有 ${warnings.length - 12} 条` }) : null,
      ),
    );
  }

  if (analysis.items.length) {
    blocks.push(el('h3', { class: 'section-title', text: '将要写入的内容(前 50 条)' }));
    blocks.push(buildTable(kind, analysis.items.slice(0, 50)));
    if (analysis.items.length > 50) {
      blocks.push(el('p', { class: 'muted', text: `……还有 ${analysis.items.length - 50} 条` }));
    }
  } else {
    blocks.push(el('div', { class: 'alert alert-warn', text: '这张表里没有可导入的内容。请检查表头是否和模板一致。' }));
  }

  sheet.body.append(...blocks.filter(Boolean));

  const canApply = analysis.items.length > 0;
  sheet.setActions([
    { label: '取消' },
    {
      label: isWeek ? '确认导入周表' : '确认导入任务',
      kind: 'primary',
      disabled: !canApply,
      onClick: () => {
        applyImport({ kind, analysis, mode, skipDuplicates, ctx, sheet });
      },
    },
  ]);
}

function stat(label, value, kind = '') {
  return el('div', { class: `stat ${kind ? `stat-${kind}` : ''}` },
    el('span', { class: 'stat-value', text: value }),
    el('span', { class: 'stat-label', text: label }),
  );
}

/** 出错行里回显原始单元格(Excel 日期可能解析成 Date 对象) */
function fmtCell(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return toISODate(value);
  return String(value);
}

function buildTable(kind, items) {
  const isWeek = kind === 'week';
  const head = isWeek
    ? ['星期', '板块名称', '类别', '时间']
    : ['日期', '板块名称', '任务', '备注', '状态'];

  const rows = items.map((item) => {
    if (isWeek) {
      return [weekdayLabel(item.weekday), item.name, item.category, item.start + (item.end ? `–${item.end}` : '')];
    }
    const status = item.duplicate
      ? item.duplicateSource === 'existing'
        ? '重复(已有)'
        : '重复(本表)'
      : item.unmatched
        ? '未匹配'
        : '新增';
    return [item.date, item.blockName, item.title, item.note || '', status];
  });

  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data-table' },
      el('thead', {}, el('tr', {}, ...head.map((h) => el('th', { text: h })))),
      el(
        'tbody',
        {},
        ...rows.map((cells, i) =>
          el(
            'tr',
            { class: isWeek ? '' : items[i].duplicate ? 'row-dup' : items[i].unmatched ? 'row-unmatched' : '' },
            ...cells.map((c, ci) =>
              el('td', {
                text: c === '' ? '—' : String(c),
                class: !isWeek && ci === 4 ? `cell-status status-${items[i].duplicate ? 'dup' : items[i].unmatched ? 'unmatched' : 'new'}` : '',
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

function applyImport({ kind, analysis, mode, skipDuplicates, ctx, sheet }) {
  try {
    if (kind === 'week') {
      const { blocks, added, replaced } = applyWeekImport(analysis.items, mode, store.getState());
      store.setBlockTemplate(blocks);
      store.applyTaskPatches(rematchAllTasks(store.getState()));
      toast(replaced ? `周表已导入:${added} 个板块` : `已合并:新增 ${added} 个板块`, 'success');
    } else {
      const { tasks, skipped } = applyTaskImport(analysis.items, { skipDuplicates });
      store.addTasks(tasks);
      store.applyTaskPatches(rematchAllTasks(store.getState()));
      toast(`已导入 ${tasks.length} 条任务${skipped ? `,跳过重复 ${skipped} 条` : ''}`, 'success');
    }
    sheet.close();
    ctx.refresh();
  } catch (err) {
    console.error(err);
    toast(`导入失败:${err.message}`, 'error');
  }
}
