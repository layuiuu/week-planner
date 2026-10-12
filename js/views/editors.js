// 两个编辑弹层:单条任务的添加/编辑,以及「某一周的板块微调」。

import { el, openSheet, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { WEEKDAYS, weekdayLabel, toISODate, fromISODate, weekLabelShort, weekKeyOfDate } from '../dates.js';
import { blocksForDate, effectiveBlocks, buildOverrideFromDraft, resolveBlockId, cmpBlock } from '../blocks.js';
import { rematchAllTasks } from '../importers.js';

/* ---------------- 任务编辑 ---------------- */

export function openTaskEditor({ task = null, defaults = {}, ctx }) {
  const isNew = !task;
  const draft = {
    title: task ? task.title : '',
    date: task ? task.date : defaults.date || toISODate(new Date()),
    blockName: task ? task.blockName : defaults.blockName || '',
    note: task ? task.note : '',
    done: task ? task.done : false,
  };

  const titleInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: '要做什么?',
    value: draft.title,
    autocomplete: 'off',
  });

  const dateInput = el('input', { class: 'input', type: 'date', value: draft.date });
  const blockSelect = el('select', { class: 'input' });
  const blockHint = el('p', { class: 'field-hint' });
  const doneToggle = el('button', {
    type: 'button',
    class: 'switch',
    role: 'switch',
    'aria-checked': draft.done ? 'true' : 'false',
    on: {
      click: () => {
        draft.done = !draft.done;
        doneToggle.setAttribute('aria-checked', draft.done ? 'true' : 'false');
        doneToggle.classList.toggle('is-on', draft.done);
        doneToggle.querySelector('.switch-text').textContent = draft.done ? '已完成' : '未完成';
      },
    },
  });
  doneToggle.classList.toggle('is-on', draft.done);
  doneToggle.append(
    el('span', { class: 'switch-dot' }),
    el('span', { class: 'switch-text', text: draft.done ? '已完成' : '未完成' }),
  );

  function refreshBlocks() {
    const state = store.getState();
    const blocks = blocksForDate(state, dateInput.value).sort(cmpBlock);
    const previous = blockSelect.value || draft.blockName;
    blockSelect.replaceChildren();
    if (!blocks.length) {
      blockSelect.append(el('option', { value: '', text: '那天还没有板块' }));
      blockHint.textContent = '这一天的框架里还没有板块。可以先用「编辑本周板块」加一个,或先导入周表。';
      blockHint.hidden = false;
      return;
    }
    let matched = false;
    for (const block of blocks) {
      const label = block.start ? `${block.start} ${block.name}` : block.name;
      blockSelect.append(el('option', { value: block.name, text: label }));
      if (block.name === previous) matched = true;
    }
    if (previous && !matched) {
      blockSelect.append(el('option', { value: previous, text: `${previous}(周表里已没有这个板块)` }));
    }
    blockSelect.append(el('option', { value: '', text: '(不指定板块)' }));
    blockSelect.value = matched || previous ? previous : blocks[0].name;
    blockHint.hidden = true;
  }
  refreshBlocks();
  dateInput.addEventListener('change', refreshBlocks);

  const noteInput = el('textarea', {
    class: 'input',
    rows: 3,
    placeholder: '备注(可选)',
    value: draft.note,
  });

  const body = el(
    'div',
    { class: 'form' },
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: '任务内容' }), titleInput),
    el('div', { class: 'field-row' },
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: '日期' }), dateInput),
      el('label', { class: 'field' }, el('span', { class: 'field-label', text: '状态' }), doneToggle),
    ),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: '板块' }), blockSelect, blockHint),
    el('label', { class: 'field' }, el('span', { class: 'field-label', text: '备注' }), noteInput),
  );

  const actions = [{ label: '取消' }];
  if (!isNew) {
    actions.push({
      label: '删除',
      kind: 'danger-ghost',
      onClick: async () => {
        const ok = await confirmDialog('确定删除这条任务吗?', { okLabel: '删除', danger: true });
        if (!ok) return;
        store.removeTask(task.id);
        sheet.close();
        toast('已删除');
        ctx.refresh();
      },
    });
  }
  actions.push({
    label: '保存',
    kind: 'primary',
    onClick: () => {
      const title = titleInput.value.trim();
      if (!title) {
        toast('任务内容不能为空', 'error');
        titleInput.focus();
        return;
      }
      const date = dateInput.value || toISODate(new Date());
      const blockName = blockSelect.value || '';
      const state = store.getState();
      const blockId = resolveBlockId(state, { date, blockName });
      if (isNew) {
        store.addTask({ date, blockName, blockId, title, note: noteInput.value, done: draft.done });
        toast('已添加任务', 'success');
      } else {
        store.updateTask(task.id, {
          date,
          blockName,
          blockId,
          title,
          note: noteInput.value,
          done: draft.done,
        });
        toast('已保存', 'success');
      }
      sheet.close();
      ctx.refresh();
    },
  });

  const sheet = openSheet({
    title: isNew ? '添加任务' : '编辑任务',
    subtitle: draft.date ? `${weekdayLabel(((fromISODate(draft.date) || new Date()).getDay() + 6) % 7 + 1)} · ${draft.date}` : '',
    body,
    actions,
  });
  setTimeout(() => titleInput.focus({ preventScroll: true }), 60);
  return sheet;
}

/* ---------------- 某一周的板块微调 ---------------- */

export function openWeekBlocksEditor(weekKey, ctx) {
  if (!weekKey) weekKey = weekKeyOfDate(toISODate(new Date()));
  const state = store.getState();
  const template = state.blockTemplate || [];
  let draft = effectiveBlocks(state, weekKey).map((b) => ({ ...b }));
  const existingOverride = (state.weekOverrides || {})[weekKey] || null;

  const list = el('div', { class: 'block-editor-list' });

  function rowFor(block, index) {
    const weekdaySelect = el(
      'select',
      { class: 'input input-sm' },
      ...WEEKDAYS.map((label, i) =>
        el('option', { value: String(i + 1), text: label, selected: block.weekday === i + 1 }),
      ),
    );
    const nameInput = el('input', { class: 'input input-sm', type: 'text', value: block.name, placeholder: '板块名称' });
    const categoryInput = el('input', { class: 'input input-sm', type: 'text', value: block.category, placeholder: '类别' });
    const startInput = el('input', { class: 'input input-sm', type: 'time', value: block.start || '' });
    const endInput = el('input', { class: 'input input-sm', type: 'time', value: block.end || '' });

    const row = el(
      'div',
      { class: 'block-editor-row' },
      el('div', { class: 'be-line' }, weekdaySelect, nameInput),
      el('div', { class: 'be-line' },
        categoryInput,
        el('span', { class: 'be-times' }, startInput, el('span', { class: 'be-dash', text: '–' }), endInput),
        el('button', {
          type: 'button',
          class: 'icon-btn danger',
          'aria-label': '删除这个板块',
          text: '✕',
          on: {
            click: () => {
              draft.splice(index, 1);
              render();
            },
          },
        }),
      ),
    );

    const sync = () => {
      draft[index] = {
        ...draft[index],
        weekday: Number(weekdaySelect.value),
        name: nameInput.value.trim(),
        category: categoryInput.value.trim() || '未分类',
        start: startInput.value || '',
        end: endInput.value || '',
      };
    };
    for (const input of [weekdaySelect, nameInput, categoryInput, startInput, endInput]) {
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    }
    return row;
  }

  function render() {
    list.replaceChildren();
    if (!draft.length) {
      list.append(el('p', { class: 'empty-hint', text: '这一周还没有板块,点下面的「添加板块」新建一个。' }));
      return;
    }
    const sorted = [...draft].sort(cmpBlock);
    draft = sorted;
    sorted.forEach((block, i) => list.append(rowFor(block, i)));
  }
  render();

  const body = el(
    'div',
    { class: 'form' },
    el('p', { class: 'sheet-text muted' },
      '这里的改动只影响「' + weekLabelShort(weekKey) + '」这一周,不会动到每周套用的模板。'),
    list,
    el('button', {
      type: 'button',
      class: 'btn btn-ghost btn-block',
      text: '＋ 添加板块',
      on: {
        click: () => {
          draft.push({ id: store.uid('b'), weekday: 1, name: '', category: '', start: '', end: '' });
          render();
        },
      },
    }),
  );

  const actions = [{ label: '取消' }];
  if (existingOverride) {
    actions.push({
      label: '恢复为模板',
      kind: 'ghost',
      onClick: async () => {
        const ok = await confirmDialog('把这一周的板块恢复成模板的样子?本周的临时改动会被丢弃。');
        if (!ok) return;
        store.setWeekOverride(weekKey, null);
        store.applyTaskPatches(rematchAllTasks(store.getState()));
        sheet.close();
        toast('已恢复为模板', 'success');
        ctx.refresh();
      },
    });
  }
  actions.push({
    label: '保存',
    kind: 'primary',
    onClick: () => {
      const cleaned = draft
        .map((b) => ({ ...b, name: b.name.trim(), category: (b.category || '').trim() || '未分类' }))
        .filter((b) => b.name);
      if (cleaned.length !== draft.length) toast('有板块没写名称,已跳过', 'error');
      const override = buildOverrideFromDraft(template, cleaned);
      store.setWeekOverride(weekKey, override);
      store.applyTaskPatches(rematchAllTasks(store.getState()));
      sheet.close();
      toast(override ? '本周板块已更新' : '与模板一致,无需改动', 'success');
      ctx.refresh();
    },
  });

  const sheet = openSheet({
    title: '编辑本周板块',
    subtitle: weekLabelShort(weekKey),
    body,
    actions,
    size: 'sheet-tall',
  });
  return sheet;
}
