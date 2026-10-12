// 极小的 xlsx 读取器(零依赖)。
// xlsx 本质是一个 zip:自己解析 zip 目录,用浏览器内置 DecompressionStream('deflate-raw')
// 解压其中的 xml,再用 DOMParser 读出来。不需要任何第三方库,也不依赖 CDN。
//
// 支持:.xlsx / .xlsm(含日期格式识别、共享字符串、行内字符串)
// 不支持:旧版 .xls(BIFF)— 请另存为 .xlsx 或 CSV。

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

export function isXlsxSupported() {
  return typeof DecompressionStream !== 'undefined' && typeof DOMParser !== 'undefined';
}

async function inflateRaw(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error(`不支持的压缩方式(${method})`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 xlsx,请把文件另存为 CSV 后再导入');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZip(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  let eocd = -1;
  const floor = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === ZIP_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('这不是有效的 .xlsx 文件(找不到 zip 目录)');

  const count = dv.getUint16(eocd + 10, true);
  let offset = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(offset, true) !== ZIP_CENTRAL) break;
    const method = dv.getUint16(offset + 10, true);
    const compSize = dv.getUint32(offset + 20, true);
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);
    const localOffset = dv.getUint32(offset + 42, true);
    const name = decoder.decode(u8.subarray(offset + 46, offset + 46 + nameLen));

    if (!name.endsWith('/')) {
      // 注意:必须用「本地头」自己的名字/扩展长度,中央目录里的长度可能不同
      const localNameLen = dv.getUint16(localOffset + 26, true);
      const localExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      entries.set(name, { method, raw: u8.subarray(dataStart, dataStart + compSize) });
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }

  // 只解压 xml / rels,其它二进制条目保持原样(省时间)
  const files = new Map();
  for (const [name, entry] of entries) {
    if (/\.(xml|rels)$/i.test(name)) files.set(name, await inflateRaw(entry.raw, entry.method));
    else files.set(name, entry.raw);
  }
  return files;
}

function parseSharedStrings(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out = [];
  for (const si of doc.getElementsByTagName('si')) {
    let text = '';
    for (const child of si.children) {
      if (child.localName === 't') text += child.textContent;
      else if (child.localName === 'r') {
        const t = child.getElementsByTagName('t')[0];
        if (t) text += t.textContent;
      }
    }
    out.push(text);
  }
  return out;
}

const BUILTIN_DATE_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

function parseStyles(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const custom = new Map();
  for (const nf of doc.getElementsByTagName('numFmt')) {
    custom.set(Number(nf.getAttribute('numFmtId')), nf.getAttribute('formatCode') || '');
  }
  function isDateFormat(id) {
    if (BUILTIN_DATE_FMT_IDS.has(id)) return true;
    const code = custom.get(id);
    if (!code) return false;
    // 去掉中括号段([$-409])和引号里的字面量后,出现 y/d/h/s 就当日期/时间
    const stripped = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
    return /[ydhs]/i.test(stripped);
  }
  const xfs = [];
  const cellXfs = doc.getElementsByTagName('cellXfs')[0];
  if (cellXfs) {
    for (const xf of cellXfs.getElementsByTagName('xf')) {
      xfs.push({ isDate: isDateFormat(Number(xf.getAttribute('numFmtId') || 0)) });
    }
  }
  return xfs;
}

function parseWorkbook(xml, relsXml) {
  const rels = new Map();
  if (relsXml) {
    const rd = new DOMParser().parseFromString(relsXml, 'application/xml');
    for (const rel of rd.getElementsByTagName('Relationship')) {
      rels.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const sheets = [];
  for (const sheet of doc.getElementsByTagName('sheet')) {
    const name = sheet.getAttribute('name') || `Sheet${sheets.length + 1}`;
    const rid =
      sheet.getAttribute('r:id') ||
      sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = rid ? rels.get(rid) || null : null;
    if (path) {
      path = path.replace(/^\//, '').replace(/^xl\/\.\.\//, '');
      if (!path.startsWith('xl/')) path = `xl/${path}`;
    }
    sheets.push({ name, path });
  }
  return sheets;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of String(ref)) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) n = n * 26 + (code - 64);
    else if (code >= 97 && code <= 122) n = n * 26 + (code - 96);
    else break;
  }
  return n - 1;
}

/** Excel 序列号 → 日期(Date,本地中午)或时间字符串 'HH:MM' */
function serialToValue(serial) {
  if (serial > 0 && serial < 1) {
    const minutes = Math.round(serial * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const days = Math.floor(serial - 25569); // 25569 = 1899-12-30 到 1970-01-01 的天数
  const utc = new Date(days * 86400000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12, 0, 0);
}

function parseSheet(xml, shared, xfs) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = [];
  for (const rowEl of doc.getElementsByTagName('row')) {
    const cells = [];
    for (const c of rowEl.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const idx = ref ? colIndex(ref) : cells.length;
      const type = c.getAttribute('t');
      const styleIndex = Number(c.getAttribute('s') || 0);
      let value = '';

      if (type === 'inlineStr') {
        const is = c.getElementsByTagName('is')[0];
        value = is ? is.textContent : '';
      } else {
        const v = c.getElementsByTagName('v')[0];
        const raw = v ? v.textContent : '';
        if (type === 's') value = shared[Number(raw)] ?? '';
        else if (type === 'str') value = raw;
        else if (type === 'b') value = raw === '1';
        else if (type === 'e') value = '';
        else if (raw === '') value = '';
        else {
          const num = Number(raw);
          if (!Number.isFinite(num)) value = raw;
          else if (xfs[styleIndex] && xfs[styleIndex].isDate) value = serialToValue(num);
          else value = num;
        }
      }
      cells[idx] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

/** 读取 xlsx,返回 [{ name, rows:[[cell,...]] }] */
export async function readXlsxSheets(arrayBuffer) {
  if (!isXlsxSupported()) {
    throw new Error('当前浏览器不支持解析 xlsx,请把文件另存为 CSV 后再导入');
  }
  const files = await readZip(arrayBuffer);
  const get = (name) => (files.has(name) ? new TextDecoder('utf-8').decode(files.get(name)) : null);

  const sharedXml = get('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const stylesXml = get('xl/styles.xml');
  const xfs = stylesXml ? parseStyles(stylesXml) : [];

  const workbookXml = get('xl/workbook.xml');
  let sheetRefs = [];
  if (workbookXml) {
    sheetRefs = parseWorkbook(workbookXml, get('xl/_rels/workbook.xml.rels'));
  } else {
    for (const name of files.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        sheetRefs.push({ name, path: name });
      }
    }
    sheetRefs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  const sheets = [];
  for (let i = 0; i < sheetRefs.length; i++) {
    const path = sheetRefs[i].path || `xl/worksheets/sheet${i + 1}.xml`;
    const xml = get(path);
    if (!xml) continue;
    sheets.push({ name: sheetRefs[i].name, rows: parseSheet(xml, shared, xfs) });
  }
  if (!sheets.length) throw new Error('这个 xlsx 里没有可读取的工作表');
  return sheets;
}
