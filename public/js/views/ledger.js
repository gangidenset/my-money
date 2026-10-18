import {
  sum, toDateKey, parseDateKey, summarizeSpending, budgetPeriod, inPeriod, periodLabel, frequentEntries, parseMoney, yen, spendAmount,
} from '../calc.js';
import { ds, state, ui, esc, catMap, groupOf, payday, currentPeriod, allow, currentRoute, render } from '../core.js';
import { showToast, moneyValue, moneyAttrs } from '../ui.js';
import { chartsView } from '../views/charts.js';
import { expenseRow } from '../views/home.js';
import { helpBtn } from '../guides.js';

/* ---------- 家計簿 ---------- */

export function ledgerView() {
  const period = budgetPeriod(new Date(), payday(), ui.ledgerOffset);
  const list = state.expenses.filter((e) => inPeriod(period, e.date)).sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id));
  const s = summarizeSpending(list, groupOf);
  const editing = ui.editingId ? state.expenses.find((e) => e.id === ui.editingId) : null;
  ui.quickList = editing ? [] : frequentEntries(state.expenses.filter((e) => e.kind !== 'cardBill'));

  const byDate = {};
  list.forEach((e) => (byDate[e.date] ||= []).push(e));

  const modeToggle = `<div class="segmented mode-toggle" role="tablist" aria-label="表示の切り替え">
    <button type="button" role="tab" data-action="ledger-mode" data-mode="list" class="${ui.ledgerMode === 'list' ? 'selected' : ''}" aria-selected="${ui.ledgerMode === 'list'}">📝 記録</button>
    <button type="button" role="tab" data-action="ledger-mode" data-mode="chart" class="${ui.ledgerMode === 'chart' ? 'selected' : ''}" aria-selected="${ui.ledgerMode === 'chart'}">📊 グラフ</button>
  </div>`;
  if (ui.ledgerMode === 'chart') return modeToggle + chartsView(period);

  return `
    ${modeToggle}
    <section class="card entry ${editing ? 'is-editing' : ''}">
      <h2>${editing ? '✏️ 支出を編集' : '支出を記録'}${helpBtn(editing ? 'edit' : 'record')}</h2>
      ${ui.quickList.length ? `<div class="quick">
        <p class="quick-label">よく使う（タップですぐ記録）${helpBtn('quick', 'small')}</p>
        <div class="quick-list">
          ${ui.quickList.map((q, i) => `<button type="button" class="quick-btn" data-action="quick-add" data-index="${i}">
            <span>${catMap()[q.category]?.icon ?? '❔'} ${esc(q.shop || catMap()[q.category]?.name || '')}</span><strong>${yen(q.amount)}</strong>
          </button>`).join('')}
        </div>
      </div>` : ''}
      <span class="money-input big">
        <input ${moneyAttrs} id="entry-amount" placeholder="0" value="${editing ? moneyValue(editing.amount) : ''}">
        <span class="unit">円</span>
      </span>
      <div class="cat-grid" role="radiogroup" aria-label="カテゴリ">
        ${state.categories.map((c) => `
          <button type="button" class="cat ${c.id === ui.entryCategory ? 'selected' : ''}" data-action="pick-category" data-id="${esc(c.id)}" role="radio" aria-checked="${c.id === ui.entryCategory}">
            <span class="cat-icon">${c.icon}</span><span>${esc(c.name)}</span>
          </button>`).join('')}
      </div>
      <div class="entry-extra">
        <label class="field"><span class="field-label">日付</span><input type="date" id="entry-date" value="${editing ? esc(editing.date) : toDateKey(new Date())}"></label>
        <label class="field"><span class="field-label">店名</span><input type="text" id="entry-shop" placeholder="任意" maxlength="40" value="${editing ? esc(editing.shop) : ''}"></label>
        <label class="field"><span class="field-label">メモ</span><input type="text" id="entry-memo" placeholder="任意" maxlength="80" value="${editing ? esc(editing.memo) : ''}"></label>
      </div>
      ${editing
        ? `<div class="btn-row"><button class="btn" data-action="cancel-edit">キャンセル</button><button class="btn primary" data-action="save-expense">更新する</button></div>`
        : '<button class="btn primary block" data-action="add-expense">記録する</button>'}
      <p class="entry-msg" id="entry-msg" aria-live="polite"></p>
    </section>

    <section class="card">
      <div class="month-nav">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="前の期間">‹</button>
        <h2>${periodLabel(period)}${helpBtn('edit')}</h2>
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="次の期間">›</button>
      </div>
      <dl class="flow compact">
        <div class="total"><dt>支出合計</dt><dd>${yen(s.total)}</dd></div>
        <div><dt>うち生活費</dt><dd>${yen(s.living)}</dd></div>
        <div><dt>うち自由費</dt><dd>${yen(s.free)}</dd></div>
      </dl>
      ${list.length ? Object.entries(byDate).map(([date, items]) => {
        const d = parseDateKey(date);
        const wd = '日月火水木金土'[d.getDay()];
        return `<h3 class="date-head">${d.getMonth() + 1}月${d.getDate()}日（${wd}）<span>${yen(sum(items, spendAmount))}</span></h3>
          <ul class="exp-list">${items.map(expenseRow).join('')}</ul>`;
      }).join('') : '<p class="muted">この期間の支出はまだありません。</p>'}
      <p class="note">固定費（家賃・光熱費など）は予算タブで設定した金額で自動計算されるため、ここでの記録は不要です。</p>
    </section>`;
}


/* ---------- 記録・編集・削除 ---------- */

/** 日付が含まれる期間が、今の期間からいくつ前／後か */
export function periodOffsetOf(dateKey) {
  const cur = currentPeriod().start;
  const target = budgetPeriod(parseDateKey(dateKey), payday()).start;
  return (target.getFullYear() - cur.getFullYear()) * 12 + target.getMonth() - cur.getMonth();
}

/** 記録フォームの内容を読み取る。金額がなければ null */
export function readEntryForm() {
  const amountEl = document.getElementById('entry-amount');
  const amount = parseMoney(amountEl.value);
  if (amount <= 0) {
    const msg = document.getElementById('entry-msg');
    msg.textContent = '金額を入力してください。';
    msg.className = 'entry-msg error';
    amountEl.focus();
    return null;
  }
  return {
    date: document.getElementById('entry-date').value || toDateKey(new Date()),
    amount,
    category: ui.entryCategory,
    shop: document.getElementById('entry-shop').value.trim(),
    memo: document.getElementById('entry-memo').value.trim(),
  };
}

export function endEdit() {
  ui.editingId = null;
  if (ui.categoryBeforeEdit && catMap()[ui.categoryBeforeEdit]) ui.entryCategory = ui.categoryBeforeEdit;
  ui.categoryBeforeEdit = null;
}

export async function deleteExpenseWithUndo(e) {
  await ds.deleteExpense(e.id);
  state.expenses = state.expenses.filter((x) => x.id !== e.id);
  if (ui.editingId === e.id) endEdit();
  render();
  showToast(`${yen(e.amount)}（${e.shop || catMap()[e.category]?.name || ''}）を削除しました`, {
    label: '元に戻す',
    run: async () => {
      await ds.restoreExpense(e);
      state.expenses.push(e);
      render();
      showToast('元に戻しました');
    },
  });
}

export async function saveExpense() {
  const form = readEntryForm();
  if (!form) return;
  const updated = await ds.updateExpense(ui.editingId, form);
  state.expenses = state.expenses.map((x) => (x.id === updated.id ? updated : x));
  endEdit();
  ui.ledgerOffset = periodOffsetOf(updated.date);
  render();
  showToast('更新しました');
}

export async function quickAdd(q) {
  const item = await ds.addExpense({ date: toDateKey(new Date()), amount: q.amount, category: q.category, shop: q.shop, memo: '' });
  state.expenses.push(item);
  ui.ledgerOffset = 0;
  render();
  const a = allow();
  showToast(`${q.shop || catMap()[q.category]?.name || ''} ${yen(q.amount)}を記録。今週あと${yen(Math.max(0, a.weekLeft))}`, {
    label: '取り消す',
    run: async () => {
      await ds.deleteExpense(item.id);
      state.expenses = state.expenses.filter((x) => x.id !== item.id);
      render();
      showToast('取り消しました');
    },
  });
}

export async function addExpense() {
  const form = readEntryForm();
  if (!form) return;
  const item = await ds.addExpense(form);
  const { amount } = item;
  state.expenses.push(item);
  ui.ledgerOffset = periodOffsetOf(item.date);
  render();
  const a = allow();
  const m = document.getElementById('entry-msg');
  m.className = 'entry-msg ok';
  m.textContent = `${yen(amount)}を記録しました。今週あと${yen(Math.max(0, a.weekLeft))}、今月あと${yen(Math.max(0, a.monthLeft))}です。`;
}

/* ---------- ボタン操作（data-action） ---------- */

export const ledgerActions = {
  'pick-category': async (btn, ev) => {
    ui.entryCategory = btn.dataset.id;
    document.querySelectorAll('.cat').forEach((c) => {
      const on = c.dataset.id === ui.entryCategory;
      c.classList.toggle('selected', on);
      c.setAttribute('aria-checked', on);
    });
  },
  'add-expense': async (btn, ev) => {
    await addExpense();
  },
  'delete-expense': async (btn, ev) => {
    const e = state.expenses.find((x) => x.id === btn.dataset.id);
    if (e) await deleteExpenseWithUndo(e);
  },
  'edit-expense': async (btn, ev) => {
    const e = state.expenses.find((x) => x.id === btn.dataset.id);
    if (!e) return;
    if (!ui.editingId) ui.categoryBeforeEdit = ui.entryCategory;
    ui.editingId = e.id;
    ui.ledgerMode = 'list';
    ui.entryCategory = e.category;
    ui.ledgerOffset = periodOffsetOf(e.date);
    if (currentRoute() === 'ledger') render();
    else location.hash = '#/ledger';
    window.scrollTo(0, 0);
    document.getElementById('entry-amount')?.focus();
  },
  'save-expense': async (btn, ev) => {
    await saveExpense();
  },
  'cancel-edit': async (btn, ev) => {
    endEdit();
    render();
  },
  'quick-add': async (btn, ev) => {
    const q = ui.quickList[Number(btn.dataset.index)];
    if (q) await quickAdd(q);
  },
  'month': async (btn, ev) => {
    ui.ledgerOffset += Number(btn.dataset.delta);
    render();
  },
  'ledger-mode': async (btn, ev) => {
    ui.ledgerMode = btn.dataset.mode;
    if (ui.ledgerMode === 'chart' && ui.editingId) endEdit();
    render();
  },
};
