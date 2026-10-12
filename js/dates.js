// 日期 / 周次工具:全部以「周一为一周第一天」,周次用 ISO 周编号。
// 所有日期在内部都用「当天中午 12:00」的本地时间构造,避免时区把日期挪到前一天。

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function fromISODate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
}

export function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

/** 1 = 周一 … 7 = 周日 */
export function weekdayIndex(d) {
  return ((d.getDay() + 6) % 7) + 1;
}

export function weekdayLabel(i) {
  return WEEKDAYS[i - 1] || '';
}

/** 该日期所在周的周一 */
export function mondayOf(d) {
  return addDays(d, -(weekdayIndex(d) - 1));
}

/** ISO 周编号,如 2026-W42 */
export function weekKeyOf(d) {
  const thursday = addDays(d, 4 - weekdayIndex(d));
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1, 12, 0, 0);
  const week = Math.floor((thursday - jan1) / 86400000 / 7) + 1;
  return `${year}-W${pad2(week)}`;
}

export function parseWeekKey(key) {
  const m = String(key || '').match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  return { year: Number(m[1]), week: Number(m[2]) };
}

export function mondayOfWeekKey(key) {
  const parsed = parseWeekKey(key);
  if (!parsed) return mondayOf(new Date());
  const jan4 = new Date(parsed.year, 0, 4, 12, 0, 0);
  const firstMonday = addDays(jan4, -(weekdayIndex(jan4) - 1));
  return addDays(firstMonday, (parsed.week - 1) * 7);
}

export function weekDatesOfKey(key) {
  const monday = mondayOfWeekKey(key);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function currentWeekKey() {
  return weekKeyOf(new Date());
}

export function shiftWeekKey(key, deltaWeeks) {
  return weekKeyOf(addDays(mondayOfWeekKey(key), deltaWeeks * 7));
}

export function weekKeyOfDate(iso) {
  const d = fromISODate(iso);
  return d ? weekKeyOf(d) : null;
}

export function weekLabel(key) {
  const p = parseWeekKey(key);
  if (!p) return key || '';
  const dates = weekDatesOfKey(key);
  return `${p.year} 年第 ${p.week} 周 · ${formatMD(dates[0])}–${formatMD(dates[6])}`;
}

export function weekLabelShort(key) {
  const p = parseWeekKey(key);
  return p ? `${p.year} 年第 ${p.week} 周` : key || '';
}

export function formatMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatISOToMD(iso) {
  const d = fromISODate(iso);
  return d ? formatMD(d) : '';
}

/** 把「周一 / 星期一 / 礼拜一 / 一 / Mon / 1」等写法转成 1..7,识别不了返回 null */
export function parseWeekday(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = Math.trunc(v);
    return n >= 1 && n <= 7 ? n : null;
  }
  if (v instanceof Date) return weekdayIndex(v);
  const raw = String(v).trim();
  if (!raw) return null;
  const s = raw.replace(/\s+/g, '').replace(/星期|礼拜|周/g, '').replace(/day/gi, '');
  const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 };
  if (map[s]) return map[s];
  const en = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
  if (en[s.toLowerCase()]) return en[s.toLowerCase()];
  if (/^[1-7]$/.test(s)) return Number(s);
  return null;
}
