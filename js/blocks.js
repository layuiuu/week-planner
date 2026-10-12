// 周框架:把「一份模板 + 某一周的临时改动」合并成那一周实际生效的板块列表。

import { fromISODate, weekKeyOf, weekdayIndex } from './dates.js';
import { uid } from './store.js';

export function cmpBlock(a, b) {
  if (a.weekday !== b.weekday) return a.weekday - b.weekday;
  const sa = a.start || '99:99';
  const sb = b.start || '99:99';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
}

/** 某一周实际生效的板块(模板去掉被删的、套上被改的,再补上本周新增的) */
export function effectiveBlocks(state, weekKey) {
  const template = Array.isArray(state.blockTemplate) ? state.blockTemplate : [];
  const override = (state.weekOverrides || {})[weekKey] || null;
  let list = template.map((b) => ({ ...b }));
  if (override) {
    const removed = new Set(override.removedIds || []);
    const modified = override.modified || {};
    list = list
      .filter((b) => !removed.has(b.id))
      .map((b) => (modified[b.id] ? { ...b, ...modified[b.id] } : b));
    for (const b of override.added || []) list.push({ ...b, weekOnly: true });
  }
  return list.sort(cmpBlock);
}

export function blocksForDate(state, dateISO) {
  const d = fromISODate(dateISO);
  if (!d) return [];
  const list = effectiveBlocks(state, weekKeyOf(d));
  const wd = weekdayIndex(d);
  return list.filter((b) => b.weekday === wd);
}

export function findBlockByName(blocks, name) {
  const target = String(name || '').trim();
  if (!target) return null;
  return blocks.find((b) => b.name === target) || null;
}

/** 任务该挂到哪个板块:按「同一星期的板块名称」精确匹配 */
export function resolveBlockId(state, task) {
  const d = fromISODate(task.date);
  if (!d) return null;
  const blocks = effectiveBlocks(state, weekKeyOf(d)).filter((b) => b.weekday === weekdayIndex(d));
  const block = findBlockByName(blocks, task.blockName);
  return block ? block.id : null;
}

export function rebuildResolvedBlockIds(state) {
  return state.tasks.map((t) => ({ id: t.id, blockId: resolveBlockId(state, t) }));
}

export function categoriesOf(blocks) {
  const seen = [];
  for (const b of blocks) {
    if (!seen.includes(b.category)) seen.push(b.category);
  }
  return seen;
}

/** 任务实际落在哪个板块对象上(先按 id,再按名称兜底) */
export function blockOfTask(state, task) {
  const d = fromISODate(task.date);
  if (!d) return null;
  const blocks = effectiveBlocks(state, weekKeyOf(d)).filter((b) => b.weekday === weekdayIndex(d));
  return blocks.find((b) => b.id === task.blockId) || blocks.find((b) => b.name === task.blockName) || null;
}

export function categoryOfTask(state, task) {
  const block = blockOfTask(state, task);
  return block ? block.category : '未匹配';
}

export function blockTimeLabel(block) {
  if (!block) return '';
  if (block.start && block.end) return `${block.start}–${block.end}`;
  return block.start || block.end || '';
}

/** 由类别名算一个稳定的色相,让同类板块颜色一致、不同类有区分 */
export function categoryHue(name) {
  let hash = 0;
  for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  return (hash % 360 + 360) % 360;
}

/**
 * 由「本周的草稿板块列表」反推出相对模板的差异,生成 weekOverride。
 * 与模板完全一致的改动不会写进 override,保持数据干净。
 */
export function buildOverrideFromDraft(template, draftBlocks) {
  const templateById = new Map(template.map((b) => [b.id, b]));
  const draftIds = new Set(draftBlocks.map((b) => b.id));
  const added = [];
  const modified = {};

  for (const block of draftBlocks) {
    const original = templateById.get(block.id);
    if (!original) {
      added.push({ ...block, id: block.id || uid('b') });
      continue;
    }
    const patch = {};
    for (const field of ['weekday', 'name', 'category', 'start', 'end']) {
      // 星期是数字,其余是字符串,分开比,免得 '1' 和 1 被当成不同
      const next = field === 'weekday' ? Number(block.weekday) : String(block[field] || '');
      const prev = field === 'weekday' ? Number(original.weekday) : String(original[field] || '');
      if (next !== prev) patch[field] = next;
    }
    if (Object.keys(patch).length) modified[block.id] = patch;
  }

  const removedIds = template.filter((b) => !draftIds.has(b.id)).map((b) => b.id);
  if (!added.length && !removedIds.length && !Object.keys(modified).length) return null;
  return { added, removedIds, modified };
}
