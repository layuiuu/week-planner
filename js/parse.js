// 表格解析与字段规范化:CSV / Excel → 统一的「表头 + 行对象」结构。
// 只按固定表头读取,不做任何猜测;识别不了的值一律报错给用户看。

import { pad2, toISODate, parseWeekday } from './dates.js';
import { readXlsxSheets } from './xlsx-lite.js';

/* ---------------- 表头定义 ---------------- */

export const WEEK_SPEC = [
  { key: 'weekday', label: '星期', required: true, aliases: ['星期', '周', '周几', '星期几', '天', 'day', 'weekday'] },
  { key: 'name', label: '板块名称', required: true, aliases: ['板块名称', '板块名', '板块', '名称', 'blockname', 'block', 'name'] },
  { key: 'category', label: '类别', required: true, aliases: ['类别', '分类', '类型', '标签', '科目', 'category', 'tag'] },
  { key: 'start', label: '开始', required: true, aliases: ['开始', '开始时间', '起始', '起', 'start', 'from', 'starttime'] },
  { key: 'end', label: '结束', required: false, aliases: ['结束', '结束时间', '止', 'end', 'to', 'endtime'] },
];

export const TASK_SPEC = [
  { key: 'date', label: '日期', required: true, aliases: ['日期', '哪天', 'date', 'day'] },
  { key: 'blockName', label: '板块名称', required: true, aliases: ['板块名称', '板块名', '板块', '名称', 'blockname', 'block', 'name'] },
  { key: 'title', label: '任务', required: true, aliases: ['任务', '任务内容', '内容', '事项', 'title', 'task', 'todo'] },
  { key: 'note', label: '备注', required: false, aliases: ['备注', '说明', 'note', 'remark', 'memo'] },
];

export const WEEK_HEADER_TEXT = '星期 | 板块名称 | 类别 | 开始 | 结束';
export const TASK_HEADER_TEXT = '日期 | 板块名称 | 任务 | 备注';

/* ---------------- 文本解码 ---------------- */

export function decodeText(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(u8.subarray(3));
  }
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(u8.subarray(2));
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(u8.subarray(2));
  }
  try {
    // 中文 Windows 上 Excel 存的 CSV 常常是 GBK:先严格按 UTF-8 试,失败再退回 GBK
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    for (const enc of ['gbk', 'gb18030', 'big5']) {
      try {
        return new TextDecoder(enc).decode(u8);
      } catch {
        /* 换下一种 */
      }
    }
    return new TextDecoder('utf-8').decode(u8);
  }
}

function detectDelimiter(text) {
  const firstLine = String(text).split('\n')[0] || '';
  let best = ',';
  let bestCount = 0;
  for (const cand of [',', '\t', ';', '|']) {
    const n = firstLine.split(cand).length - 1;
    if (n > bestCount) {
      bestCount = n;
      best = cand;
    }
  }
  return best;
}

export function parseCSV(text) {
  const src = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delim = detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/* ---------------- 读文件 ---------------- */

export async function readTable(file, spec) {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    throw new Error('不支持旧版 .xls 格式,请在 Excel 里「另存为」.xlsx 或 CSV 后重试');
  }
  const buffer = await file.arrayBuffer();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const sheets = await readXlsxSheets(buffer);
    // 一个工作簿里可能有好几张表,挑表头最像目标格式的那张
    let best = sheets[0];
    let bestScore = -1;
    for (const sheet of sheets) {
      const score = bestHeaderScore(sheet.rows, spec);
      if (score > bestScore) {
        bestScore = score;
        best = sheet;
      }
    }
    return {
      matrix: best.rows,
      sheetName: best.name,
      sheetCount: sheets.length,
      sheetNames: sheets.map((s) => s.name),
      source: 'xlsx',
    };
  }
  return { matrix: parseCSV(decodeText(buffer)), sheetName: null, sheetCount: 1, source: 'csv' };
}

function bestHeaderScore(matrix, spec) {
  if (!spec) return 0;
  let best = 0;
  const limit = Math.min(matrix.length, 10);
  for (let i = 0; i < limit; i++) {
    best = Math.max(best, Object.keys(matchHeader(matrix[i] || [], spec).index).length);
  }
  return best;
}

/* ---------------- 表头匹配 ---------------- */

export function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[:：_\-・.]/g, '')
    .toLowerCase();
}

function matchHeader(row, spec) {
  const index = {};
  const used = new Set();
  for (const field of spec) {
    for (let col = 0; col < row.length; col++) {
      if (used.has(col)) continue;
      const header = normalizeHeader(row[col]);
      if (!header) continue;
      if (field.aliases.some((a) => normalizeHeader(a) === header)) {
        index[field.key] = col;
        used.add(col);
        break;
      }
    }
  }
  const missing = spec.filter((f) => f.required && index[f.key] === undefined).map((f) => f.key);
  const extra = [];
  for (let col = 0; col < row.length; col++) {
    if (used.has(col)) continue;
    const header = String(row[col] == null ? '' : row[col]).trim();
    if (header) extra.push({ col, header });
  }
  return { index, missing, extra };
}

export function labelOf(spec, key) {
  const f = spec.find((x) => x.key === key);
  return f ? f.label : key;
}

/**
 * 找出表头行并把数据行转成对象。
 * 返回 { headerRowIndex, index, missing, extra, rows:[{__row, __cells, ...字段}] }
 */
export function toObjects(matrix, spec) {
  const safeMatrix = Array.isArray(matrix) ? matrix : [];
  let headerRowIndex = 0;
  let best = -1;
  let bestMatch = null;
  const limit = Math.min(safeMatrix.length, 10);
  for (let i = 0; i < limit; i++) {
    const m = matchHeader(safeMatrix[i] || [], spec);
    const score = Object.keys(m.index).length;
    if (score > best) {
      best = score;
      bestMatch = m;
      headerRowIndex = i;
    }
  }
  const match = bestMatch || matchHeader([], spec);
  const rows = [];
  for (let i = headerRowIndex + 1; i < safeMatrix.length; i++) {
    const cells = safeMatrix[i] || [];
    const isEmpty = cells.every((v) => String(v == null ? '' : v).trim() === '');
    if (isEmpty) continue;
    const obj = { __row: i + 1, __cells: cells };
    for (const [key, col] of Object.entries(match.index)) obj[key] = cells[col];
    rows.push(obj);
  }
  return { headerRowIndex, index: match.index, missing: match.missing, extra: match.extra, rows };
}

/* ---------------- 值规范化 ---------------- */

export function normalizeDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return toISODate(value);
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 20000 && value <= 80000) {
      const utc = new Date(Math.floor(value - 25569) * 86400000);
      return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`;
    }
    return null;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${m[1]}-${pad2(month)}-${pad2(day)}`;
  }
  m = s.match(/^(\d{1,2})[-/月.](\d{1,2})日?$/);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${new Date().getFullYear()}-${pad2(month)}-${pad2(day)}`;
  }
  return null;
}

/** 返回 'HH:MM';识别不了返回 null;空值返回 '' */
export function normalizeTime(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) {
      const minutes = Math.round(value * 24 * 60);
      return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
    }
    if (Number.isInteger(value) && value >= 0 && value <= 23) return `${pad2(value)}:00`;
    return null;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})\s*[:：时点]\s*(\d{1,2})/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h <= 23 && min <= 59) return `${pad2(h)}:${pad2(min)}`;
    return null;
  }
  m = s.match(/^(\d{3,4})$/);
  if (m) {
    const t = m[1].padStart(4, '0');
    return `${t.slice(0, 2)}:${t.slice(2)}`;
  }
  m = s.match(/^(\d{1,2})$/);
  if (m && Number(m[1]) <= 23) return `${pad2(Number(m[1]))}:00`;
  m = s.match(/(\d{1,2})[:：](\d{2})/);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  return null;
}

export function toText(value) {
  if (value == null) return '';
  if (value instanceof Date) return toISODate(value);
  return String(value).trim();
}

export { parseWeekday };
