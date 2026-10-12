// 数据仓库:一个带版本号的 JSON 文档存在 localStorage 里。
// 所有写操作都走 commit(),写完立刻持久化并通知订阅者重绘。

import { weekKeyOfDate, weekDatesOfKey, toISODate } from './dates.js';

const STORAGE_KEY = 'weekplanner.v1';
export const SCHEMA_VERSION = 1;

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    settings: { appName: '周计划', weekStart: 1 },
    blockTemplate: [],
    weekOverrides: {},
    tasks: [],
    dayNotes: {},
    blockNotes: {},
    weekNotes: {},
    meta: { updatedAt: null },
  };
}

function normalize(input) {
  const base = emptyState();
  if (!input || typeof input !== 'object') return base;
  const s = { ...base, ...input };
  s.settings = { ...base.settings, ...(input.settings || {}) };
  s.meta = { ...base.meta, ...(input.meta || {}) };
  s.version = SCHEMA_VERSION;
  s.blockTemplate = Array.isArray(input.blockTemplate) ? input.blockTemplate.map(normBlock).filter(Boolean) : [];
  s.weekOverrides = input.weekOverrides && typeof input.weekOverrides === 'object' ? input.weekOverrides : {};
  s.tasks = Array.isArray(input.tasks) ? input.tasks.map(normTask).filter(Boolean) : [];
  s.dayNotes = input.dayNotes && typeof input.dayNotes === 'object' ? { ...input.dayNotes } : {};
  s.blockNotes = input.blockNotes && typeof input.blockNotes === 'object' ? { ...input.blockNotes } : {};
  s.weekNotes = input.weekNotes && typeof input.weekNotes === 'object' ? { ...input.weekNotes } : {};
  return s;
}

function normBlock(b) {
  if (!b || typeof b !== 'object') return null;
  const weekday = Number(b.weekday);
  if (!(weekday >= 1 && weekday <= 7)) return null;
  return {
    id: b.id || uid('b'),
    weekday,
    name: String(b.name || '').trim() || '未命名板块',
    category: String(b.category || '').trim() || '未分类',
    start: String(b.start || ''),
    end: String(b.end || ''),
  };
}

function normTask(t) {
  if (!t || typeof t !== 'object') return null;
  const date = String(t.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    id: t.id || uid('t'),
    date,
    blockName: String(t.blockName || '').trim(),
    blockId: t.blockId || null,
    title: String(t.title || '').trim(),
    done: !!t.done,
    note: String(t.note || ''),
  };
}

let state = loadState();
let storageError = null;
const listeners = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalize(JSON.parse(raw));
  } catch (err) {
    console.error('读取本地数据失败,已从空白开始', err);
    storageError = err;
    return emptyState();
  }
}

export function getState() {
  return state;
}

export function getStorageError() {
  return storageError;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error(err);
    }
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageError = null;
  } catch (err) {
    storageError = err;
    console.error('保存失败(localStorage 可能已满或被禁用)', err);
  }
}

export function commit() {
  state.meta.updatedAt = new Date().toISOString();
  persist();
  emit();
}

/* ---------------- 周表模板 ---------------- */

export function setBlockTemplate(blocks) {
  state.blockTemplate = blocks.map(normBlock).filter(Boolean);
  commit();
  return state.blockTemplate;
}

export function getWeekOverride(weekKey) {
  return state.weekOverrides[weekKey] || null;
}

export function setWeekOverride(weekKey, override) {
  if (override) state.weekOverrides[weekKey] = override;
  else delete state.weekOverrides[weekKey];
  commit();
}

export function renumberBlockIds(blocks) {
  return blocks.map((b) => ({ ...b, id: uid('b') }));
}

/* ---------------- 任务 ---------------- */

export function addTask(task) {
  const t = normTask({ ...task, id: task.id || uid('t') });
  if (!t) throw new Error('任务数据不完整');
  state.tasks.push(t);
  commit();
  return t;
}

export function addTasks(tasks) {
  const added = [];
  for (const task of tasks) {
    const t = normTask({ ...task, id: task.id || uid('t') });
    if (t) {
      state.tasks.push(t);
      added.push(t);
    }
  }
  commit();
  return added;
}

export function getTask(id) {
  return state.tasks.find((t) => t.id === id) || null;
}

export function updateTask(id, patch) {
  const t = getTask(id);
  if (!t) return null;
  Object.assign(t, patch);
  if (patch.date) t.date = String(patch.date).slice(0, 10);
  commit();
  return t;
}

export function removeTask(id) {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.tasks.length !== before) commit();
}

/** 批量打补丁(用于周表改动后重新对齐任务的板块),只触发一次重绘 */
export function applyTaskPatches(patches) {
  if (!patches || !patches.length) return 0;
  let n = 0;
  for (const patch of patches) {
    const t = getTask(patch.id);
    if (!t) continue;
    Object.assign(t, patch);
    n++;
  }
  if (n) commit();
  return n;
}

export function toggleTask(id) {
  const t = getTask(id);
  if (!t) return null;
  t.done = !t.done;
  commit();
  return t;
}

export function taskKey(t) {
  return `${t.date}|${t.blockName}|${t.title}`;
}

/* ---------------- 备注 ---------------- */

function setNote(map, key, text) {
  const value = String(text || '');
  if (value.trim()) map[key] = value;
  else delete map[key];
  commit();
}

export function setDayNote(date, text) {
  setNote(state.dayNotes, date, text);
}

export function getDayNote(date) {
  return state.dayNotes[date] || '';
}

export function setBlockNote(weekKey, blockId, text) {
  setNote(state.blockNotes, `${weekKey}|${blockId}`, text);
}

export function getBlockNote(weekKey, blockId) {
  return state.blockNotes[`${weekKey}|${blockId}`] || '';
}

export function setWeekNote(weekKey, text) {
  setNote(state.weekNotes, weekKey, text);
}

export function getWeekNote(weekKey) {
  return state.weekNotes[weekKey] || '';
}

/* ---------------- 查询 ---------------- */

export function tasksByDate(date) {
  return state.tasks.filter((t) => t.date === date);
}

export function tasksOfWeek(weekKey) {
  const dates = new Set(weekDatesOfKey(weekKey).map(toISODate));
  return state.tasks.filter((t) => dates.has(t.date));
}

/** 真正有数据的周(任务 / 复盘备注 / 单周改动) */
export function dataWeekKeys() {
  const set = new Set();
  for (const t of state.tasks) {
    const k = weekKeyOfDate(t.date);
    if (k) set.add(k);
  }
  for (const k of Object.keys(state.weekNotes)) set.add(k);
  for (const k of Object.keys(state.weekOverrides)) set.add(k);
  return [...set].sort();
}

/** 上面这些 + 当前这一周(设置页的快捷入口用) */
export function knownWeekKeys() {
  const set = new Set(dataWeekKeys());
  set.add(weekKeyOfDate(toISODate(new Date())));
  return [...set].sort();
}

/* ---------------- 备份 / 清空 ---------------- */

export function exportBackup() {
  return JSON.stringify(state, null, 2);
}

export function importBackup(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
    throw new Error('这不是本应用的备份文件(缺少 tasks 字段)');
  }
  state = normalize(parsed);
  commit();
  return state;
}

export function clearAll() {
  const appName = state.settings.appName;
  state = emptyState();
  state.settings.appName = appName;
  commit();
}

export function replaceState(next) {
  state = normalize(next);
  commit();
}

export function stats() {
  return {
    blocks: state.blockTemplate.length,
    tasks: state.tasks.length,
    done: state.tasks.filter((t) => t.done).length,
    weeks: dataWeekKeys().length,
    updatedAt: state.meta.updatedAt,
  };
}
