// 设置页:导入、模板下载、示例数据、备份、单周板块微调、清空。

import { el, toast, confirmDialog, downloadText, toCSV, formatDateTime, openSheet } from '../ui.js';
import * as store from '../store.js';
import { makeSampleState } from '../sample.js';
import { startImport } from './importPreview.js';
import { openWeekBlocksEditor } from './editors.js';
import { weekKeyOfDate, weekLabelShort, toISODate, todayISO } from '../dates.js';
import { WEEK_HEADER_TEXT, TASK_HEADER_TEXT } from '../parse.js';

export function renderSettings(root, ctx) {
  const state = store.getState();
  const stats = store.stats();

  root.append(el('header', { class: 'view-head' }, el('h1', { class: 'view-title', text: '设置' })));

  /* 数据概况 */
  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '数据概况' }),
      el(
        'div',
        { class: 'kv-grid' },
        kv('板块', `${stats.blocks} 个`),
        kv('任务', `${stats.tasks} 条`),
        kv('已完成', `${stats.done} 条`),
        kv('有记录的周', `${stats.weeks} 周`),
      ),
      el('p', { class: 'muted', text: stats.updatedAt ? `最后修改:${formatDateTime(stats.updatedAt)}` : '还没有修改过' }),
      el('p', { class: 'muted', text: '所有数据只保存在这台设备的浏览器里,不会上传到任何服务器。' }),
      store.getStorageError()
        ? el('div', { class: 'alert alert-error', text: '浏览器拒绝写入本地存储(可能是无痕模式或空间已满)。请先导出备份,并尽快处理。' })
        : null,
    ),
  );

  /* 导入 */
  const weekInput = el('input', { type: 'file', accept: '.csv,.xlsx,.xlsm,text/csv', class: 'hidden-file' });
  const taskInput = el('input', { type: 'file', accept: '.csv,.xlsx,.xlsm,text/csv', class: 'hidden-file' });
  weekInput.addEventListener('change', () => {
    const file = weekInput.files?.[0];
    weekInput.value = '';
    if (file) startImport({ kind: 'week', file, ctx });
  });
  taskInput.addEventListener('change', () => {
    const file = taskInput.files?.[0];
    taskInput.value = '';
    if (file) startImport({ kind: 'tasks', file, ctx });
  });

  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '导入表格' }),
      el('p', { class: 'muted', text: '只支持 Excel(.xlsx)和 CSV。表头要固定,系统照着读,不会猜。导入前会先给你看确认页。' }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-primary', type: 'button', text: '导入周表', on: { click: () => weekInput.click() } }),
        el('button', { class: 'btn btn-primary', type: 'button', text: '导入任务清单', on: { click: () => taskInput.click() } }),
      ),
      el('p', { class: 'muted mono', text: `周表表头:${WEEK_HEADER_TEXT}` }),
      el('p', { class: 'muted mono', text: `任务表表头:${TASK_HEADER_TEXT}` }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', type: 'button', text: '下载周表模板', on: { click: downloadWeekTemplate } }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: '下载任务表模板', on: { click: downloadTaskTemplate } }),
      ),
      weekInput,
      taskInput,
    ),
  );

  /* 示例数据 */
  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '示例数据' }),
      el('p', { class: 'muted', text: '载入一份示例周表 + 任务,先看看整体长什么样。注意:会覆盖当前数据。' }),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: '载入示例数据',
          on: {
            click: async () => {
              const hasData = store.getState().tasks.length || store.getState().blockTemplate.length;
              if (hasData) {
                const ok = await confirmDialog('载入示例数据会覆盖现在的全部内容(建议先导出备份)。继续吗?', { okLabel: '覆盖并载入', danger: true });
                if (!ok) return;
              }
              store.replaceState(makeSampleState(state.settings.appName));
              toast('已载入示例数据', 'success');
              ctx.refresh();
            },
          },
        }),
      ),
    ),
  );

  /* 单周微调 */
  const weekPicker = el('input', { class: 'input input-sm', type: 'date', value: todayISO() });
  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '单周板块微调' }),
      el('p', { class: 'muted', text: '每周默认套用同一份模板。如果某一周的板块要临时改(加一个、删一个、换个时间),选一天后编辑,只影响那一周。' }),
      el('div', { class: 'field-row' },
        weekPicker,
        el('button', {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          text: '编辑那一周',
          on: { click: () => openWeekBlocksEditor(weekKeyOfDate(weekPicker.value || todayISO()), ctx) },
        }),
      ),
      el('div', { class: 'chip-row' },
        ...store.knownWeekKeys().slice(-6).reverse().map((key) =>
          el('button', { class: 'chip', type: 'button', text: weekLabelShort(key), on: { click: () => openWeekBlocksEditor(key, ctx) } }),
        ),
      ),
    ),
  );

  /* 备份 */
  const backupInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden-file' });
  backupInput.addEventListener('change', async () => {
    const file = backupInput.files?.[0];
    backupInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const ok = await confirmDialog('导入备份会覆盖当前全部数据。继续吗?', { okLabel: '覆盖导入', danger: true });
      if (!ok) return;
      store.importBackup(text);
      toast('备份已恢复', 'success');
      ctx.refresh();
    } catch (err) {
      toast(`恢复失败:${err.message}`, 'error');
    }
  });

  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '备份' }),
      el('p', { class: 'muted', text: '数据只在这台设备上。换手机、清浏览器数据前,记得导出一份备份文件。' }),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn btn-ghost', type: 'button', text: '导出备份(JSON)', on: { click: exportBackupFile } }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: '导入备份', on: { click: () => backupInput.click() } }),
      ),
      backupInput,
    ),
  );

  /* 危险 */
  root.append(
    el(
      'section',
      { class: 'panel panel-danger' },
      el('h3', { class: 'section-title', text: '清空数据' }),
      el('p', { class: 'muted', text: '删掉这台设备上的全部周表、任务和备注。删了就找不回来了。' }),
      el('div', { class: 'btn-row' },
        el('button', {
          class: 'btn btn-danger',
          type: 'button',
          text: '清空全部数据',
          on: {
            click: async () => {
              const ok = await confirmDialog('确定清空全部数据吗?建议先导出备份。', { okLabel: '清空', danger: true });
              if (!ok) return;
              store.clearAll();
              toast('已清空', 'success');
              ctx.refresh();
            },
          },
        }),
      ),
    ),
  );

  /* 关于 */
  root.append(
    el(
      'section',
      { class: 'panel' },
      el('h3', { class: 'section-title', text: '关于' }),
      el('p', { class: 'muted', text: '一个纯静态的周计划工具:导入周表生成每周框架,导入任务清单挂到板块上,勾选完成、按周复盘。数据只存在本机浏览器。' }),
      el('p', { class: 'muted', text: '在手机浏览器里点「添加到主屏幕」,就能像 App 一样用,断网也能打开。' }),
      el('button', {
        class: 'linklike',
        type: 'button',
        text: '查看部署 / 使用说明',
        on: { click: showHelp },
      }),
    ),
  );
}

function kv(label, value) {
  return el('div', { class: 'kv' }, el('span', { class: 'kv-value', text: value }), el('span', { class: 'kv-label', text: label }));
}

function exportBackupFile() {
  downloadText(`周计划备份-${todayISO()}.json`, store.exportBackup(), { mime: 'application/json' });
  toast('已导出备份文件', 'success');
}

function downloadWeekTemplate() {
  const rows = [
    ['星期', '板块名称', '类别', '开始', '结束'],
    ['周一', '上午学习', '学习', '09:00', '12:00'],
    ['周一', '下午工作', '工作', '14:00', '16:00'],
    ['周二', '上午学习', '学习', '09:00', '12:00'],
    ['周三', '夜跑', '健身', '19:00', '20:30'],
  ];
  downloadText('周表模板.csv', toCSV(rows), { mime: 'text/csv;charset=utf-8', bom: true });
  toast('已下载周表模板', 'success');
}

function downloadTaskTemplate() {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const monday = toISODate(d);
  const rows = [
    ['日期', '板块名称', '任务', '备注'],
    [monday, '上午学习', '复习第三章', ''],
    [monday, '下午工作', '写周报', '周五交'],
  ];
  downloadText('任务表模板.csv', toCSV(rows), { mime: 'text/csv;charset=utf-8', bom: true });
  toast('已下载任务表模板', 'success');
}

function showHelp() {
  openSheet({
    title: '使用说明',
    body: el(
      'div',
      { class: 'help' },
      el('h4', { text: '三步走' }),
      el('ol', {},
        el('li', { text: '设置 → 导入周表:星期 / 板块名称 / 类别 / 开始 / 结束。生成周一到周日的板块。' }),
        el('li', { text: '设置 → 导入任务清单:日期 / 板块名称 / 任务 / 备注。任务的「板块名称」要和周表里写的一模一样。' }),
        el('li', { text: '在「周历」勾选完成、写备注;在「看板」看推进;在「复盘」回看任意一周。' }),
      ),
      el('h4', { text: '放在 GitHub Pages 上' }),
      el('ol', {},
        el('li', { text: '把这整个文件夹推到 GitHub 仓库。' }),
        el('li', { text: '仓库 Settings → Pages → Source 选「Deploy from a branch」,分支选 main、目录选 /(root)。' }),
        el('li', { text: '等一分钟,得到 https://<用户名>.github.io/<仓库名>/ 。' }),
        el('li', { text: '手机浏览器打开这个网址 → 分享/菜单 → 添加到主屏幕。' }),
      ),
      el('h4', { text: '注意' }),
      el('ul', {},
        el('li', { text: '数据只在这台设备的浏览器里。换设备或清理浏览器数据前,先在设置里导出备份。' }),
        el('li', { text: '不支持旧版 .xls,请在 Excel 里另存为 .xlsx 或 CSV。' }),
        el('li', { text: '直接双击 index.html(file://)打不开,需要用网址打开(本地可以用 python -m http.server)。' }),
      ),
    ),
    actions: [{ label: '知道了', kind: 'primary' }],
  });
}
