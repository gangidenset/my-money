import {
  n, formatMoneyText, yen,
} from './calc.js';
import { esc } from './core.js';

// 画面に共通の部品（トースト・入力欄・バー）

/* ---------- トースト（取り消しボタン付きのお知らせ） ---------- */

export const $toast = document.getElementById('toast');
export let toastTimer;
export let toastAction = null;
export function showToast(message, action = null) {
  clearTimeout(toastTimer);
  toastAction = action;
  $toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  $toast.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
export function hideToast() {
  clearTimeout(toastTimer);
  $toast.hidden = true;
  toastAction = null;
}
$toast.addEventListener('click', async (ev) => {
  if (!ev.target.closest('.toast-btn') || !toastAction) return;
  const { run } = toastAction;
  hideToast();
  await run();
});

/* ---------- 共通パーツ ---------- */

/** 金額欄の表示用（0 は空欄） */
export const moneyValue = (v) => (n(v) ? Math.round(n(v)).toLocaleString('ja-JP') : '');
export const moneyAttrs = 'type="text" inputmode="numeric" autocomplete="off" maxlength="15" data-money';

export const numberInput = (bind, value, label, { hint, unit = '円', step = 1, max } = {}) => `
  <label class="field">
    <span class="field-label">${label}${hint ? `<small>${hint}</small>` : ''}</span>
    <span class="money-input">
      ${unit === '円'
        ? `<input ${moneyAttrs} data-bind="${bind}" value="${moneyValue(value)}" placeholder="0">`
        : `<input type="number" inputmode="${step < 1 ? 'decimal' : 'numeric'}" min="0" step="${step}"${max ? ` max="${max}"` : ''} data-bind="${bind}" value="${n(value) || ''}" placeholder="0">`}
      <span class="unit">${unit}</span>
    </span>
  </label>`;
export const moneyInput = (bind, value, label, opts = {}) => numberInput(bind, value, label, opts);

export const bar = (used, total) => {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : used > 0 ? 100 : 0;
  const tone = pct >= 100 ? 'over' : pct >= 80 ? 'caution' : 'ok';
  return `<div class="bar ${tone}"><span style="width:${pct}%"></span></div>`;
};

export const signed = (v) => (v < 0 ? `<span class="neg">−${yen(-v)}</span>` : yen(v));


/** 入力中の金額を「300,000」の形に整え、カーソル位置（何桁目か）を保つ */
export function formatMoneyField(el) {
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/[^0-9０-９]/g, '').length;
  const text = formatMoneyText(el.value);
  if (text === el.value) return;
  el.value = text;
  let pos = 0;
  for (let seen = 0; pos < text.length && seen < digitsBefore; pos++) if (/\d/.test(text[pos])) seen++;
  el.setSelectionRange(pos, pos);
}
