// 导入:把解析后的表格变成「待写入的条目 + 错误 + 警告」,交给确认页面展示,
// 用户点确认后才真正写入。任何写操作都只在这里发生。

import {
  WEEK_SPEC,
  TASK_SPEC,
  toObjects,
  labelOf,
  normalizeDate,
  normalizeTime,
  toText,
  parseWeekday,
} from './parse.js';
import { weekdayLabel, weekKeyOfDate, weekdayIndex, fromISODate } from './dates.js';
import { effectiveBlocks, resolveBlockId } from './blocks.js';
import { uid, taskKey } from './store.js';

/* ---------------- 周表 ---------------- */

export function analyzeWeek(table) {
  const parsed = toObjects(table.matrix, WEEK_SPEC);
  const errors = [];
  const warnings = [];

  if (Object.keys(parsed.index).length === 0) {
    throw new Error('没找到表头。请确认表格第一行是:星期 | 板块名称 | 类别 | 开始 | 结束');
  }
  for (const key of parsed.missing) {
    errors.push({ row: parsed.headerRowIndex + 1, messages: [`缺少必需的列:${labelOf(WEEK_SPEC, key)}`] });
  }
  for (const e of parsed.extra) {
    warnings.push({ row: parsed.headerRowIndex + 1, message: `表头里的「${e.header}」不是需要的列,已忽略` });
  }

  const items = [];
  const seenKeys = new Map();
  for (const row of parsed.rows) {
    if (parsed.missing.length) break;
    const weekday = parseWeekday(row.weekday);
    const name = toText(row.name);
    const category = toText(row.category) || '未分类';
    const start = normalizeTime(row.start);
    const end = normalizeTime(row.end);
    const messages = [];
    if (!weekday) messages.push(`星期「${toText(row.weekday)}」无法识别(可写:周一 / 星期一 / 一 / 1)`);
    if (!name) messages.push('板块名称不能为空');
    if (start === null) messages.push(`开始时间「${toText(row.start)}」无法识别(建议写成 09:00)`);
    if (end === null) messages.push(`结束时间「${toText(row.end)}」无法识别(建议写成 12:00)`);
    if (messages.length) {
      errors.push({ row: row.__row, cells: row.__cells, messages });
      continue;
    }
    if (end && end <= start) {
      warnings.push({ row: row.__row, message: `${weekdayLabel(weekday)}「${name}」的结束时间早于开始时间(${start}–${end})` });
    }
    const dupKey = `${weekday}|${name}`;
    if (seenKeys.has(dupKey)) {
      warnings.push({ row: row.__row, message: `${weekdayLabel(weekday)}「${name}」重复出现,只会保留第一条` });
      continue;
    }
    seenKeys.set(dupKey, true);
    items.push({
      __row: row.__row,
      cells: row.__cells,
      weekday,
      name,
      category,
      start,
      end: end || '',
    });
  }

  return {
    kind: 'week',
    ...parsed,
    items,
    errors,
    warnings,
    stats: { total: parsed.rows.length, ok: items.length, errors: errors.length, warnings: warnings.length },
  };
}

/* ---------------- 任务表 ---------------- */

export function analyzeTasks(table, state) {
  const parsed = toObjects(table.matrix, TASK_SPEC);
  const errors = [];
  const warnings = [];

  if (Object.keys(parsed.index).length === 0) {
    throw new Error('没找到表头。请确认表格第一行是:日期 | 板块名称 | 任务 | 备注');
  }
  for (const key of parsed.missing) {
    errors.push({ row: parsed.headerRowIndex + 1, messages: [`缺少必需的列:${labelOf(TASK_SPEC, key)}`] });
  }
  for (const e of parsed.extra) {
    warnings.push({ row: parsed.headerRowIndex + 1, message: `表头里的「${e.header}」不是需要的列,已忽略` });
  }

  const hasTemplate = (state.blockTemplate || []).length > 0;
  if (!hasTemplate) {
    warnings.push({
      row: 0,
      message: '还没有导入周表,所有任务都会显示为「未匹配板块」。建议先导入周表再导入任务。',
    });
  }

  const items = [];
  const seenKeys = new Set();
  const existingKeys = new Set((state.tasks || []).map(taskKey));
  for (const row of parsed.rows) {
    if (parsed.missing.length) break;
    const date = normalizeDate(row.date);
    const blockName = toText(row.blockName);
    const title = toText(row.title);
    const note = toText(row.note);
    const messages = [];
    if (!date) messages.push(`日期「${toText(row.date)}」无法识别(建议写成 2026-10-13)`);
    if (!title) messages.push('任务内容不能为空');
    if (!blockName) messages.push('板块名称不能为空');
    if (messages.length) {
      errors.push({ row: row.__row, cells: row.__cells, messages });
      continue;
    }

    const key = `${date}|${blockName}|${title}`;
    // 两种重复:这批里重复,或者和已经存过的任务重复
    const duplicateSource = seenKeys.has(key) ? 'batch' : existingKeys.has(key) ? 'existing' : null;
    seenKeys.add(key);

    const item = {
      __row: row.__row,
      cells: row.__cells,
      date,
      blockName,
      title,
      note,
      duplicate: !!duplicateSource,
      duplicateSource,
      blockId: null,
    };

    // 解析它属于哪个板块(按「任务所在那一周的板块名称」精确匹配)
    item.blockId = resolveBlockId(state, { date, blockName });
    if (!item.blockId && hasTemplate) {
      const d = fromISODate(date);
      const wd = d ? weekdayIndex(d) : 1;
      const sameDayBlocks = effectiveBlocks(state, weekKeyOfDate(date)).filter((b) => b.weekday === wd);
      const hint = sameDayBlocks.length
        ? `那天可用的板块是:${sameDayBlocks.map((b) => b.name).join('、')}`
        : '那天还没有任何板块';
      warnings.push({
        row: row.__row,
        message: `${weekdayLabel(wd)}「${blockName}」在周表里找不到(${hint})`,
      });
      item.unmatched = true;
    }
    items.push(item);
  }

  const dupCount = items.filter((i) => i.duplicate).length;
  if (dupCount) {
    warnings.push({
      row: 0,
      message: `有 ${dupCount} 条和已有任务重复(同一天、同一板块、同样内容),默认会跳过;想强行导入请取消勾选「跳过重复任务」。`,
    });
  }
  return {
    kind: 'tasks',
    ...parsed,
    items,
    errors,
    warnings,
    stats: {
      total: parsed.rows.length,
      ok: items.length,
      errors: errors.length,
      warnings: warnings.length,
      duplicates: dupCount,
      unmatched: items.filter((i) => i.unmatched).length,
    },
  };
}

/* ---------------- 写入 ---------------- */

export function applyWeekImport(items, mode = 'replace', state) {
  const toBlock = (item) => ({
    id: uid('b'),
    weekday: item.weekday,
    name: item.name,
    category: item.category,
    start: item.start,
    end: item.end || '',
  });

  let blocks;
  if (mode === 'merge') {
    const existing = (state.blockTemplate || []).map((b) => ({ ...b }));
    const byKey = new Map(existing.map((b) => [`${b.weekday}|${b.name}`, b]));
    let added = 0;
    for (const item of items) {
      const key = `${item.weekday}|${item.name}`;
      if (byKey.has(key)) {
        Object.assign(byKey.get(key), { category: item.category, start: item.start, end: item.end || '' });
      } else {
        const block = toBlock(item);
        byKey.set(key, block);
        existing.push(block);
        added++;
      }
    }
    blocks = existing;
    return { blocks, added, replaced: false };
  }

  const existingByName = new Map((state.blockTemplate || []).map((b) => [`${b.weekday}|${b.name}`, b.id]));
  blocks = items.map((item) => {
    const reusedId = existingByName.get(`${item.weekday}|${item.name}`);
    return { ...toBlock(item), id: reusedId || uid('b') };
  });
  return { blocks, added: blocks.length, replaced: true };
}

export function applyTaskImport(items, options = {}) {
  const skipDuplicates = options.skipDuplicates !== false;
  const keep = items.filter((i) => !(skipDuplicates && i.duplicate));
  const tasks = keep.map((i) => ({
    id: uid('t'),
    date: i.date,
    blockName: i.blockName,
    blockId: i.blockId || null,
    title: i.title,
    note: i.note || '',
    done: false,
  }));
  return { tasks, skipped: items.length - keep.length };
}

/** 周表变了以后,重新把每个任务的 blockId 对上(按名称) */
export function rematchAllTasks(state) {
  const patches = [];
  for (const task of state.tasks) {
    const blockId = resolveBlockId(state, task);
    if (blockId !== task.blockId) patches.push({ id: task.id, blockId });
  }
  return patches;
}
