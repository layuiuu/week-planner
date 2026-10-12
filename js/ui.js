// 通用 UI 小工具:DOM 构造、底部弹层、确认框、toast、文件下载、CSV 生成。

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, val] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'on' && typeof value === 'object') {
      for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    } else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* ---------------- 弹层 ---------------- */

let openCount = 0;

export function openSheet({ title, subtitle, body, actions = [], size = '', onClose } = {}) {
  const root = document.getElementById('sheet-root');
  const sheetEl = el('div', { class: `sheet ${size}`.trim(), role: 'dialog', 'aria-modal': 'true' });
  const bodyEl = el('div', { class: 'sheet-body' });
  if (body) bodyEl.append(body);
  const footEl = el('div', { class: 'sheet-foot' });

  const backdrop = el('div', {
    class: 'backdrop',
    on: {
      click: (e) => {
        if (e.target === backdrop) close();
      },
    },
  });

  sheetEl.append(
    el(
      'div',
      { class: 'sheet-head' },
      el(
        'div',
        { class: 'sheet-titles' },
        el('h2', { class: 'sheet-title', text: title || '' }),
        subtitle ? el('p', { class: 'sheet-subtitle', text: subtitle }) : null,
      ),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': '关闭',
        text: '✕',
        on: { click: () => close() },
      }),
    ),
    bodyEl,
    footEl,
  );
  backdrop.append(sheetEl);

  function renderActions(list) {
    clear(footEl);
    if (!list.length) {
      footEl.remove();
      return;
    }
    footEl.append(
      ...list.map((action) =>
        el('button', {
          type: 'button',
          class: `btn ${action.kind ? `btn-${action.kind}` : 'btn-ghost'}${action.wide ? ' btn-wide' : ''}`,
          text: action.label,
          disabled: !!action.disabled,
          on: {
            click: () => {
              if (action.onClick) action.onClick(api);
              else close();
            },
          },
        }),
      ),
    );
    if (!footEl.isConnected) sheetEl.append(footEl);
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.classList.remove('no-scroll');
    backdrop.remove();
    if (typeof onClose === 'function') onClose();
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKey);

  const api = {
    close,
    body: bodyEl,
    sheet: sheetEl,
    setActions: renderActions,
    setTitle(t) {
      sheetEl.querySelector('.sheet-title').textContent = t;
    },
    setSubtitle(t) {
      const el2 = sheetEl.querySelector('.sheet-subtitle');
      if (el2) el2.textContent = t;
    },
  };

  renderActions(actions);
  root.append(backdrop);
  openCount++;
  document.body.classList.add('no-scroll');
  setTimeout(() => {
    const focusable = sheetEl.querySelector('input, textarea, select, button.btn-primary');
    if (focusable) focusable.focus({ preventScroll: true });
  }, 0);
  return api;
}

export function confirmDialog(message, { okLabel = '确定', cancelLabel = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const sheet = openSheet({
      title: okLabel === '确定' ? '请确认' : okLabel,
      body: el('p', { class: 'sheet-text', text: message }),
      onClose: () => finish(false),
      actions: [
        { label: cancelLabel, onClick: () => { finish(false); sheet.close(); } },
        {
          label: okLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: () => { finish(true); sheet.close(); },
        },
      ],
    });
  });
}

/* ---------------- toast ---------------- */

export function toast(message, kind = 'info', duration = 2600) {
  const root = document.getElementById('toast-root');
  const node = el('div', { class: `toast toast-${kind}`, text: message });
  root.append(node);
  setTimeout(() => node.remove(), duration);
  return node;
}

/* ---------------- 下载 ---------------- */

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(filename, text, { mime = 'text/plain;charset=utf-8', bom = false } = {}) {
  const parts = bom ? [new Uint8Array([0xef, 0xbb, 0xbf]), text] : [text];
  downloadBlob(filename, new Blob(parts, { type: mime }));
}

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

/* ---------------- 杂项 ---------------- */

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function plural(count, unit) {
  return `${count} ${unit}`;
}

/** 简易的「勾选框」按钮 */
export function checkButton({ checked, label, onChange, size = '' }) {
  return el('button', {
    type: 'button',
    class: `check ${size}${checked ? ' is-checked' : ''}`,
    role: 'checkbox',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label || (checked ? '标记为未完成' : '标记为完成'),
    on: {
      click: (e) => {
        e.stopPropagation();
        onChange(!checked);
      },
    },
  });
}
