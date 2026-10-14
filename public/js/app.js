import { createDefaultStorage } from './storage.js';
import { createDataService, BUDGET_LABELS, EXTRA_FIXED_COSTS, uid } from './dataService.js';
import {
  n, yen, sum, monthlyPlan, allowance, judgeSpend, futureSavings, futureInvestment, nisaCheck,
  summarizeSpending, toDateKey, parseDateKey,
  ALLOC_CHOICES, allocate, weekStartKey, historyAverages, suggestBudget, budgetAlerts,
  requiredMonthly, monthsToReach, formatMonths, incomeGrowth, householdHealth, fixedCostTips, savingEffect,
  MAX_PAYDAY, addDays, budgetPeriod, inPeriod, periodLabel, frequentEntries, backupReminder,
  periodHistory, niceScale, compactYen, parseMoney, formatMoneyText,
  goalPlan, earmarkedSavings,
} from './calc.js';

const { adapter, persistent } = createDefaultStorage();
const ds = createDataService(adapter);

const state = {
  profile: null, fixedCosts: [], budgets: [], simulation: null,
  goal: null, // 資産全体の目標（将来タブの逆算）
  goals: [], // 目的別の貯金（車・引っ越しなど）
  allocations: null, categories: [], expenses: [], meta: {},
};
const ui = {
  entryCategory: 'food',
  ledgerOffset: 0, // 家計簿で表示中の期間（0 = 今の期間、-1 = 前の期間）
  ledgerMode: 'list', // 'list' = 記録 / 'chart' = グラフ
  editingId: null, // 編集中の支出
  categoryBeforeEdit: null, // 編集を終えたら、新規記録用のカテゴリ選択を元に戻す
  quickList: [],
  checkAmount: '',
};

const $main = document.getElementById('main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catMap = () => Object.fromEntries(state.categories.map((c) => [c.id, c]));
const groupOf = (id) => catMap()[id]?.group || 'free';
const catLabel = (id) => {
  const c = catMap()[id];
  return c ? `${c.icon} ${esc(c.name)}` : '❔ 不明';
};
const plan = () => monthlyPlan(state);
/** 将来の資産に数える貯金（目的別に取り分けた分は使う予定なので除く） */
const generalSavings = () => Math.max(0, n(state.profile.currentSavings) - earmarkedSavings(state.goals));
const payday = () => state.profile.payday || 1;
const currentPeriod = () => budgetPeriod(new Date(), payday());
const history = () => historyAverages(state.expenses, new Date(), 3, payday());
const allow = () => allowance({ plan: plan(), expenses: state.expenses, groupOf, payday: payday() });
const freeAlloc = () => allocate(plan().free, state.allocations.percents);
const visitsPerWeek = () => Math.max(1, Math.round(n(state.allocations.eatoutPerWeek)) || 1);

/** 今の期間・今週（月曜〜今日）のカテゴリ別支出 */
function categoryUsage(today = new Date()) {
  const period = budgetPeriod(today, payday());
  const ws = weekStartKey(today);
  const tk = toDateKey(today);
  const month = {};
  const week = {};
  for (const e of state.expenses) {
    if (inPeriod(period, e.date)) month[e.category] = (month[e.category] || 0) + n(e.amount);
    if (e.date >= ws && e.date <= tk) week[e.category] = (week[e.category] || 0) + n(e.amount);
  }
  return { month, week };
}

async function loadAll() {
  [state.profile, state.fixedCosts, state.budgets, state.simulation, state.goal, state.goals, state.allocations, state.categories, state.expenses, state.meta] =
    await Promise.all([ds.getProfile(), ds.listFixedCosts(), ds.listBudgets(), ds.getSimulation(), ds.getGoal(), ds.listGoals(), ds.getAllocations(), ds.listCategories(), ds.listExpenses(), ds.getMeta()]);
  if (!state.meta.firstUsedAt) {
    state.meta.firstUsedAt = new Date().toISOString();
    await ds.saveMeta(state.meta);
  }
}

/* ---------- トースト（取り消しボタン付きのお知らせ） ---------- */

const $toast = document.getElementById('toast');
let toastTimer;
let toastAction = null;
function showToast(message, action = null) {
  clearTimeout(toastTimer);
  toastAction = action;
  $toast.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" class="toast-btn">${esc(action.label)}</button>` : ''}`;
  $toast.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
function hideToast() {
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
const moneyValue = (v) => (n(v) ? Math.round(n(v)).toLocaleString('ja-JP') : '');
const moneyAttrs = 'type="text" inputmode="numeric" autocomplete="off" maxlength="15" data-money';

const numberInput = (bind, value, label, { hint, unit = '円', step = 1, max } = {}) => `
  <label class="field">
    <span class="field-label">${label}${hint ? `<small>${hint}</small>` : ''}</span>
    <span class="money-input">
      ${unit === '円'
        ? `<input ${moneyAttrs} data-bind="${bind}" value="${moneyValue(value)}" placeholder="0">`
        : `<input type="number" inputmode="${step < 1 ? 'decimal' : 'numeric'}" min="0" step="${step}"${max ? ` max="${max}"` : ''} data-bind="${bind}" value="${n(value) || ''}" placeholder="0">`}
      <span class="unit">${unit}</span>
    </span>
  </label>`;
const moneyInput = (bind, value, label, opts = {}) => numberInput(bind, value, label, opts);

const bar = (used, total) => {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : used > 0 ? 100 : 0;
  const tone = pct >= 100 ? 'over' : pct >= 80 ? 'caution' : 'ok';
  return `<div class="bar ${tone}"><span style="width:${pct}%"></span></div>`;
};

const signed = (v) => (v < 0 ? `<span class="neg">−${yen(-v)}</span>` : yen(v));

/* ---------- ホーム ---------- */

function homeView() {
  const p = plan();
  const a = allow();
  const s = a.spending;

  if (p.income <= 0) {
    return `
      <section class="card onboarding">
        <h2>はじめに</h2>
        <p>手取り収入と固定費を入力すると、<strong>今月あといくら使えるか</strong>を計算します。</p>
        <a class="btn primary block" href="#/budget">収入・固定費を入力する</a>
      </section>`;
  }

  const over = a.monthLeft < 0;
  const headline = over
    ? `今月は自由に使えるお金を${yen(-a.monthLeft)}超えています。残り${a.daysLeft}日は生活費予算の中で過ごせば、貯蓄予定${yen(p.savings)}への影響を抑えられます。`
    : a.weekLeft > 0
      ? `今週あと${yen(a.weekLeft)}使えます。今日は${yen(Math.max(0, a.todayLeft))}までなら予定内です。`
      : `今週の予算は使い切りました。今月はまだ${yen(a.monthLeft)}残っているので、来週以降で調整できます。`;

  const check = judgeSpend(parseMoney(ui.checkAmount), a);

  const livingRows = state.budgets
    .filter((b) => n(b.monthlyLimit) > 0 && catMap()[b.category])
    .map((b) => {
      const used = s.byCategory[b.category] || 0;
      return `<div class="meter-row"><div class="meter-head"><span>${catLabel(b.category)}</span><span>${yen(used)} / ${yen(b.monthlyLimit)}</span></div>${bar(used, n(b.monthlyLimit))}</div>`;
    }).join('');

  const usage = categoryUsage();
  const alerts = budgetAlerts([
    ...state.budgets.filter((b) => catMap()[b.category]).map((b) => ({ name: catMap()[b.category].name, limit: n(b.monthlyLimit), used: usage.month[b.category] || 0 })),
    ...freeAlloc().items.filter((i) => catMap()[i.category]).map((i) => ({ name: catMap()[i.category].name, limit: i.monthly, used: usage.month[i.category] || 0 })),
  ]);

  const recent = [...state.expenses]
    .sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id))
    .slice(0, 5);
  const nextPayday = addDays(a.period.end, 1);
  const untilLabel = payday() > 1 ? `次の給料日（${nextPayday.getMonth() + 1}/${nextPayday.getDate()}）まで` : '月末まで';
  const endWord = payday() > 1 ? '給料日前日' : '月末';

  return `
    <section class="hero ${over ? 'is-over' : ''}">
      <p class="hero-label">今月あと</p>
      <p class="hero-value">${over ? '0円' : yen(a.monthLeft)}</p>
      <p class="hero-sub">${untilLabel}残り${a.daysLeft}日</p>
    </section>

    <section class="stat-grid">
      <div class="stat"><span class="stat-label">今週あと</span><span class="stat-value">${yen(Math.max(0, a.weekLeft))}</span></div>
      <div class="stat"><span class="stat-label">今日の目安</span><span class="stat-value">${yen(Math.max(0, a.todayLeft))}</span></div>
      <div class="stat"><span class="stat-label">${p.investment > 0 || p.goals > 0 ? '貯蓄・積立' : '貯蓄予定'}</span><span class="stat-value">${yen(p.savings + p.investment + p.goals)}</span></div>
    </section>

    <p class="advice ${over ? 'caution' : ''}">${headline}</p>
    ${alerts.length ? `<ul class="alerts">${alerts.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join('')}</ul>` : ''}
    ${backupBanner()}

    <section class="card">
      <h2>この出費、大丈夫？</h2>
      <span class="money-input">
        <input ${moneyAttrs} id="check-amount" value="${esc(formatMoneyText(ui.checkAmount))}" placeholder="使いたい金額">
        <span class="unit">円</span>
      </span>
      <p class="check-result ${check ? check.level : ''}" id="check-result">${check ? esc(check.message) : '金額を入れると、今週・今月の予算で判定します。'}</p>
    </section>

    ${allocHomeCard(usage)}

    <section class="card">
      <h2>今月のお金の流れ</h2>
      <dl class="flow">
        <div><dt>収入</dt><dd>${yen(p.income)}</dd></div>
        <div><dt>固定費</dt><dd>−${yen(p.fixed)}</dd></div>
        <div><dt>生活費予算</dt><dd>−${yen(p.living)}</dd></div>
        <div><dt>貯蓄予定</dt><dd>−${yen(p.savings)}</dd></div>
        ${p.investment > 0 ? `<div><dt>積立投資</dt><dd>−${yen(p.investment)}</dd></div>` : ''}
        ${p.goals > 0 ? `<div><dt>目的別の積立</dt><dd>−${yen(p.goals)}</dd></div>` : ''}
        <div class="total"><dt>自由に使えるお金</dt><dd>${signed(p.free)}</dd></div>
      </dl>
      ${p.free < 0 ? `<p class="note caution">固定費・生活費・貯蓄${p.goals > 0 ? "・目的別の積立" : ""}の合計が収入を${yen(-p.free)}上回っています。予算タブで見直してみましょう。</p>` : ''}
      ${healthChip()}
    </section>

    <section class="card">
      <h2>今月の予算消化</h2>
      <div class="meter-row"><div class="meter-head"><span>生活費</span><span>${yen(s.living)} / ${yen(p.living)}</span></div>${bar(s.living, p.living)}</div>
      <div class="meter-row"><div class="meter-head"><span>自由に使えるお金</span><span>${yen(a.monthUsed)} / ${yen(Math.max(0, p.free))}</span></div>${bar(a.monthUsed, Math.max(0, p.free))}</div>
      ${livingRows ? `<details><summary>生活費の内訳</summary>${livingRows}</details>` : ''}
      ${a.dayOfMonth >= 5 && s.total > 0 ? `<p class="note">このペースだと${endWord}までの支出は約${yen(a.projectedSpend)}、${a.projectedLeft >= 0 ? `予算が約${yen(a.projectedLeft)}残る見込みです。` : `予算を約${yen(-a.projectedLeft)}超える見込みです。1日あたり${yen(-a.projectedLeft / a.daysLeft)}抑えると予定内に収まります。`}</p>` : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>最近の支出</h2><a href="#/ledger">家計簿へ</a></div>
      ${recent.length ? `<ul class="exp-list">${recent.map(expenseRow).join('')}</ul>` : '<p class="muted">まだ支出がありません。</p>'}
    </section>

    <a class="fab" href="#/ledger" aria-label="支出を記録">＋</a>`;
}

function allocHomeCard(usage) {
  const rows = freeAlloc().items.filter((i) => catMap()[i.category]);
  if (!rows.length) {
    return `<section class="card">
      <h2>使い道ごとの予算</h2>
      <p class="muted">自由に使えるお金を外食・趣味などに配分すると、「外食は週いくらまで？」が分かります。</p>
      <a class="btn block" href="#/budget">配分を決める</a>
    </section>`;
  }
  return `<section class="card">
    <div class="card-head"><h2>使い道ごとの予算</h2><a href="#/budget">配分を変更</a></div>
    ${rows.map((i) => {
      const used = usage.month[i.category] || 0;
      const weekLeft = i.weekly - (usage.week[i.category] || 0);
      const perVisit = i.category === 'eatout' ? `・1回約${yen(i.weekly / visitsPerWeek())}` : '';
      return `<div class="meter-row">
        <div class="meter-head"><span>${catLabel(i.category)}</span><span>${yen(used)} / ${yen(i.monthly)}</span></div>
        ${bar(used, i.monthly)}
        <p class="meter-sub">今週あと <strong>${yen(Math.max(0, weekLeft))}</strong>（週${yen(i.weekly)}${perVisit}）</p>
      </div>`;
    }).join('')}
  </section>`;
}

function healthChip() {
  const h = householdHealth(plan());
  if (!h) return '';
  return `<a class="health-chip ${h.level}" href="#/sim">
    <span>${h.emoji} 家計の状態：<strong>${h.label}</strong></span>
    <span class="muted">貯蓄率${Math.round(h.savingsRate)}% ›</span>
  </a>`;
}

function expenseRow(e) {
  const d = parseDateKey(e.date);
  return `<li class="exp ${ui.editingId === e.id ? 'is-editing' : ''}">
    <button type="button" class="exp-body" data-action="edit-expense" data-id="${esc(e.id)}" aria-label="${yen(e.amount)}の支出を編集">
      <span class="exp-cat">${catLabel(e.category)}</span>
      <span class="exp-main">${esc(e.shop) || '<span class="muted">（店名なし）</span>'}${e.memo ? `<small>${esc(e.memo)}</small>` : ''}</span>
      <span class="exp-amount">${yen(e.amount)}<small>${d.getMonth() + 1}/${d.getDate()}</small></span>
    </button>
    <button class="icon-btn" data-action="delete-expense" data-id="${esc(e.id)}" aria-label="削除">✕</button>
  </li>`;
}

function backupBanner() {
  const r = backupReminder(state.meta, new Date(), { hasData: state.expenses.length > 0 });
  if (!r) return '';
  return `<section class="backup-banner" role="status">
    <p>💾 ${r.never ? 'まだバックアップがありません。' : `最後のバックアップから${r.days}日たちました。`}スマホの故障や機種変更に備えて保存しておきましょう。</p>
    <div class="btn-row">
      <button class="btn primary" data-action="export">今すぐ保存</button>
      <button class="btn" data-action="snooze-backup">あとで</button>
    </div>
  </section>`;
}

/* ---------- 家計簿 ---------- */

function ledgerView() {
  const period = budgetPeriod(new Date(), payday(), ui.ledgerOffset);
  const list = state.expenses.filter((e) => inPeriod(period, e.date)).sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id));
  const s = summarizeSpending(list, groupOf);
  const editing = ui.editingId ? state.expenses.find((e) => e.id === ui.editingId) : null;
  ui.quickList = editing ? [] : frequentEntries(state.expenses);

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
      <h2>${editing ? '✏️ 支出を編集' : '支出を記録'}</h2>
      ${ui.quickList.length ? `<div class="quick">
        <p class="quick-label">よく使う（タップですぐ記録）</p>
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
        <h2>${periodLabel(period)}</h2>
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
        return `<h3 class="date-head">${d.getMonth() + 1}月${d.getDate()}日（${wd}）<span>${yen(sum(items, (e) => e.amount))}</span></h3>
          <ul class="exp-list">${items.map(expenseRow).join('')}</ul>`;
      }).join('') : '<p class="muted">この期間の支出はまだありません。</p>'}
      <p class="note">固定費（家賃・光熱費など）は予算タブで設定した金額で自動計算されるため、ここでの記録は不要です。</p>
    </section>`;
}

/* ---------- グラフ ---------- */

const chartTips = new Map(); // data-tip-id → { title, rows: [{ key, label, value | text }] }
function tipAttr(title, rows) {
  const id = `tip${chartTips.size + 1}`;
  chartTips.set(id, { title, rows });
  return `data-tip-id="${id}" tabindex="0"`;
}
const shortPeriod = (period) => (period.payday > 1 ? `${period.start.getMonth() + 1}/${period.start.getDate()}〜` : `${period.start.getMonth() + 1}月`);

function chartsView(period) {
  chartTips.clear();
  if (!state.expenses.length) {
    return `<section class="card"><h2>グラフ</h2><p class="muted">家計簿に支出を記録すると、月ごとの収支やカテゴリ別の支出がグラフで表示されます。</p></section>`;
  }
  const rows = periodHistory({ expenses: state.expenses, plan: plan(), groupOf, payday: payday() });
  return `
    ${categoryChart(period)}
    ${flowChart(rows)}
    ${savingChart(rows)}
    <p class="note center">収入と固定費は、今の設定額で過去の月も計算しています。</p>`;
}

function tableView(head, body) {
  return `<details class="table-view"><summary>表で見る</summary>
    <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </details>`;
}

/** 縦棒グラフの枠（目盛り・横軸）。cols は各列の HTML */
function columnFrame(sc, cols, labels, extra = '') {
  const pct = (v) => ((v - sc.min) / (sc.max - sc.min)) * 100;
  return `
    <div class="plot">
      ${sc.ticks.map((t) => `<div class="gridline ${t === 0 ? 'base' : ''}" style="bottom:${pct(t)}%"><span>${compactYen(t)}</span></div>`).join('')}
      ${extra}
      <div class="cols">${cols.join('')}</div>
    </div>
    <div class="x-axis">${labels.join('')}</div>`;
}

function categoryChart(period) {
  const list = state.expenses.filter((e) => inPeriod(period, e.date));
  const by = {};
  for (const e of list) {
    by[e.category] ||= { amount: 0, count: 0 };
    by[e.category].amount += n(e.amount);
    by[e.category].count += 1;
  }
  const rows = Object.entries(by).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.amount - a.amount);
  const total = sum(rows, (r) => r.amount);
  const max = rows[0]?.amount || 1;
  const name = (id) => catMap()[id]?.name ?? '不明';
  return `
    <section class="card chart-card">
      <div class="month-nav">
        <button class="icon-btn" data-action="month" data-delta="-1" aria-label="前の期間">‹</button>
        <h2>${periodLabel(period)}</h2>
        <button class="icon-btn" data-action="month" data-delta="1" aria-label="次の期間">›</button>
      </div>
      <p class="chart-title">カテゴリ別の支出 <span class="muted">合計 ${yen(total)}</span></p>
      ${rows.length ? `<div class="hbars">
        ${rows.map((r) => `<div class="hbar-row" ${tipAttr(name(r.id), [
          { key: 's1', label: '金額', value: r.amount },
          { label: '支出に占める割合', text: `${Math.round((r.amount / total) * 100)}%` },
          { label: '回数', text: `${r.count}回` },
        ])}>
          <span class="hbar-label">${catLabel(r.id)}</span>
          <span class="hbar-track"><span class="hbar" style="width:${(r.amount / max) * 72}%"></span><span class="hbar-value">${yen(r.amount)}</span></span>
        </div>`).join('')}
      </div>
      ${tableView(['カテゴリ', '金額', '割合', '回数'], rows.map((r) => [esc(name(r.id)), yen(r.amount), `${Math.round((r.amount / total) * 100)}%`, `${r.count}回`]))}`
      : '<p class="muted">この期間の支出はまだありません。</p>'}
    </section>`;
}

function flowChart(rows) {
  if (!rows.length) return '';
  const sc = niceScale(0, Math.max(...rows.map((r) => Math.max(r.income, r.fixed + r.spent)), 1));
  const pct = (v) => ((v - sc.min) / (sc.max - sc.min)) * 100;
  const cols = rows.map((r) => {
    const segs = [['s1', r.fixed], ['s2', r.living], ['s3', r.free]].filter(([, v]) => v > 0);
    return `<div class="col" ${tipAttr(`${periodLabel(r.period)}${r.current ? '（途中）' : ''}`, [
      { key: 'line', label: '収入', value: r.income },
      { key: 's1', label: '固定費', value: r.fixed },
      { key: 's2', label: '生活費', value: r.living },
      { key: 's3', label: '自由費', value: r.free },
      { label: '収入 − 支出', value: r.income - r.fixed - r.spent },
    ])}>
      <div class="stack" style="height:${pct(r.fixed + r.spent)}%">${segs.map(([cls, v]) => `<span class="${cls}" style="flex-grow:${v}"></span>`).join('')}</div>
      ${r.income > 0 ? `<span class="ref-tick" style="bottom:${pct(r.income)}%"></span>` : ''}
    </div>`;
  });
  const labels = rows.map((r) => `<span>${shortPeriod(r.period)}${r.current ? '<small>途中</small>' : ''}</span>`);
  return `
    <section class="card chart-card">
      <p class="chart-title">月ごとの収支</p>
      <p class="legend">
        <span><i class="key-rect s1"></i>固定費</span><span><i class="key-rect s2"></i>生活費</span>
        <span><i class="key-rect s3"></i>自由費</span><span><i class="key-line"></i>収入</span>
      </p>
      ${columnFrame(sc, cols, labels)}
      ${tableView(['期間', '収入', '固定費', '生活費', '自由費', '収入 − 支出'], rows.map((r) => [
        `${shortPeriod(r.period)}${r.current ? '（途中）' : ''}`, yen(r.income), yen(r.fixed), yen(r.living), yen(r.free), yen(r.income - r.fixed - r.spent),
      ]))}
    </section>`;
}

function savingChart(rows) {
  if (!rows.length) return '';
  const planned = rows[0].planned;
  const sc = niceScale(Math.min(...rows.map((r) => r.saved)), Math.max(...rows.map((r) => r.saved), planned));
  const pct = (v) => ((v - sc.min) / (sc.max - sc.min)) * 100;
  const z = pct(0);
  const anyNeg = rows.some((r) => r.saved < 0);
  const cols = rows.map((r) => {
    const y = pct(r.saved);
    const style = r.saved >= 0 ? `bottom:${z}%;height:${y - z}%` : `bottom:${y}%;height:${z - y}%`;
    return `<div class="col" ${tipAttr(`${periodLabel(r.period)}${r.current ? '（見込み）' : ''}`, [
      { key: r.saved >= 0 ? 's1' : 'neg', label: r.current ? '残る見込み' : '残ったお金', value: r.saved },
      { key: 'line', label: '貯蓄・積立の予定', value: planned },
      { label: '予定との差', value: r.saved - planned },
    ])}><span class="vbar ${r.saved >= 0 ? 'pos' : 'neg'} ${r.current ? 'is-projected' : ''}" style="${style}"></span></div>`;
  });
  const labels = rows.map((r) => `<span>${shortPeriod(r.period)}${r.current ? '<small>見込み</small>' : ''}</span>`);
  const refline = planned > 0 ? `<div class="refline" style="bottom:${pct(planned)}%"></div>` : '';
  return `
    <section class="card chart-card">
      <p class="chart-title">月ごとに残ったお金（貯蓄の推移）</p>
      <p class="legend">
        <span><i class="key-rect s1"></i>残ったお金</span>${anyNeg ? '<span><i class="key-rect neg"></i>足りなかった月</span>' : ''}
        ${planned > 0 ? `<span><i class="key-line"></i>貯蓄・積立の予定（${yen(planned)}）</span>` : ''}
      </p>
      ${columnFrame(sc, cols, labels, refline)}
      <p class="note">収入 − 固定費 − 記録した支出。今の期間は、このペースで使った場合の見込みです。</p>
      ${tableView(['期間', '残ったお金', '予定との差'], rows.map((r) => [
        `${shortPeriod(r.period)}${r.current ? '（見込み）' : ''}`, yen(r.saved), `${r.saved - planned >= 0 ? '+' : ''}${yen(r.saved - planned)}`,
      ]))}
    </section>`;
}

/* ツールチップ：マウスは重ねたとき、スマホはタップ、キーボードはフォーカスで表示 */
const $tip = document.createElement('div');
$tip.className = 'chart-tip';
$tip.setAttribute('role', 'tooltip');
$tip.hidden = true;
document.body.append($tip);

function showTip(el) {
  const t = chartTips.get(el.dataset.tipId);
  if (!t) return;
  hideTip();
  $tip.replaceChildren();
  const title = document.createElement('p');
  title.className = 'tip-title';
  title.textContent = t.title;
  $tip.append(title);
  for (const r of t.rows) {
    const row = document.createElement('p');
    row.className = 'tip-row';
    const key = document.createElement('i');
    key.className = r.key ? `tip-key ${r.key}` : 'tip-key none';
    const value = document.createElement('strong');
    value.textContent = r.text ?? yen(r.value);
    const label = document.createElement('span');
    label.textContent = r.label;
    row.append(key, value, label);
    $tip.append(row);
  }
  $tip.hidden = false;
  el.classList.add('is-active');
  const anchor = (el.querySelector('.stack, .vbar, .hbar') || el).getBoundingClientRect();
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - $tip.offsetWidth / 2), innerWidth - $tip.offsetWidth - 8);
  let top = anchor.top - $tip.offsetHeight - 8;
  if (top < 8) top = anchor.bottom + 8;
  $tip.style.left = `${left}px`;
  $tip.style.top = `${top}px`;
}
function hideTip() {
  $tip.hidden = true;
  document.querySelectorAll('[data-tip-id].is-active').forEach((x) => x.classList.remove('is-active'));
}
$main.addEventListener('pointerover', (ev) => {
  const el = ev.target.closest('[data-tip-id]');
  if (el && ev.pointerType === 'mouse') showTip(el);
});
$main.addEventListener('pointerout', (ev) => {
  const el = ev.target.closest('[data-tip-id]');
  if (el && ev.pointerType === 'mouse' && !el.contains(ev.relatedTarget)) hideTip();
});
$main.addEventListener('focusin', (ev) => {
  const el = ev.target.closest('[data-tip-id]');
  if (el) showTip(el);
});
$main.addEventListener('focusout', (ev) => {
  if (ev.target.closest('[data-tip-id]')) hideTip();
});
$main.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-tip-id]');
  if (el) showTip(el);
  else hideTip();
});
window.addEventListener('scroll', hideTip, { passive: true });

/* ---------- 予算（収入・固定費・生活費・貯蓄） ---------- */

function summaryCard() {
  const p = plan();
  return `
    <section class="card sticky-summary" id="live-summary">
      <div class="sum-row"><span>収入</span><strong>${yen(p.income)}</strong></div>
      <div class="sum-row"><span>固定費</span><strong>−${yen(p.fixed)}</strong></div>
      <div class="sum-row"><span>生活費</span><strong>−${yen(p.living)}</strong></div>
      <div class="sum-row"><span>貯蓄</span><strong>−${yen(p.savings)}</strong></div>
      <div class="sum-row"><span>積立投資</span><strong>−${yen(p.investment)}</strong></div>
      ${p.goals > 0 ? `<div class="sum-row"><span>目的別</span><strong>−${yen(p.goals)}</strong></div>` : ''}
      <div class="sum-row total"><span>自由に使えるお金</span><strong>${signed(p.free)}</strong></div>
    </section>`;
}

function suggestCard() {
  const p = plan();
  if (n(state.profile.takeHome) <= 0) return '';
  const hist = history();
  const sg = suggestBudget(p.income, { investment: p.investment, goals: p.goals, history: hist });
  const untouched = p.living === 0 && p.savings === 0;
  const src = (x) => (x.source === 'history' ? `<small class="tag">実績${hist.months}か月平均</small>` : '<small class="tag muted">目安</small>');
  const pctText = Object.entries(sg.percents).map(([id, pct]) => `${catMap()[id]?.name ?? id} ${pct}%`).join('・');
  return `
    <section class="card" id="suggest-card">
      <details ${untouched ? 'open' : ''}>
        <summary>手取り${yen(p.income)}からの予算の目安</summary>
        <p class="note">一般的な配分をもとにした初期目安です。正解ではないので、暮らしに合わせて調整してください。${hist ? '記録がある項目は、あなたの実績を優先しています。' : '家計簿の記録が貯まると、あなたの実績平均を優先して提案します。'}</p>
        <dl class="flow suggest">
          <div><dt>固定費 <small class="tag muted">目安</small></dt><dd>${yen(sg.fixed)}<small>今 ${yen(p.fixed)}</small></dd></div>
          ${Object.entries(sg.living).map(([id, x]) => `<div><dt>${esc(BUDGET_LABELS[id])} ${src(x)}</dt><dd>${yen(x.amount)}</dd></div>`).join('')}
          <div><dt>貯蓄 <small class="tag muted">目安</small></dt><dd>${yen(sg.savings)}${p.investment + p.goals > 0 ? '<small>積立投資・目的別の分を差し引き済み</small>' : ''}</dd></div>
          <div><dt>自由に使えるお金の配分</dt><dd class="small">${esc(pctText)}</dd></div>
        </dl>
        ${p.fixed > sg.fixed ? `<p class="note caution">固定費が目安より${yen(p.fixed - sg.fixed)}多めです。通信費・保険・サブスクは見直しの効果が出やすい項目です。</p>` : ''}
        <button class="btn primary block" data-action="apply-suggest">未入力の項目に目安を入れる</button>
        <p class="note">入力済みの金額は上書きしません。</p>
      </details>
    </section>`;
}

function allocCard() {
  const p = plan();
  const { items, totalPercent, unallocated } = freeAlloc();
  const byCat = Object.fromEntries(items.map((i) => [i.category, i]));
  const cats = state.categories.filter((c) => c.group === 'free');
  const visits = visitsPerWeek();

  if (p.free <= 0) {
    return `<section class="card" id="alloc-card">
      <h2>自由に使えるお金の使い道</h2>
      <p class="muted">自由に使えるお金がまだないため配分できません。収入・固定費・貯蓄目標を入力すると設定できます。</p>
    </section>`;
  }
  return `<section class="card" id="alloc-card">
    <h2>自由に使えるお金の使い道</h2>
    <p class="note lead">貯蓄・積立を確保したあとの<strong>${yen(p.free)}</strong>を、何に何%使うかを決めます。</p>
    ${cats.map((c) => {
      const it = byCat[c.id];
      const pct = n(state.allocations.percents[c.id]);
      return `<div class="alloc-row">
        <div class="alloc-head"><span>${c.icon} ${esc(c.name)}</span><span class="alloc-amount">${it ? `月${yen(it.monthly)} <span class="muted">/ 週${yen(it.weekly)}</span>` :'<span class="muted">配分なし</span>'}</span></div>
        <div class="segmented small" role="radiogroup" aria-label="${esc(c.name)}の割合">
          ${ALLOC_CHOICES.map((v) => `<button type="button" data-action="alloc" data-id="${esc(c.id)}" data-pct="${v}" class="${pct === v ? 'selected' : ''}" aria-checked="${pct === v}" role="radio">${v}%</button>`).join('')}
        </div>
        ${c.id === 'eatout' && it ? `<div class="visit-row">
          <label>週に<input type="number" inputmode="numeric" min="1" max="21" data-bind="allocations.eatoutPerWeek" value="${visits}" aria-label="週の外食回数">回</label>
          <span>→ 1回あたり約<strong data-live="eatout-visit">${yen(it.weekly / visits)}</strong></span>
        </div>` : ''}
      </div>`;
    }).join('')}
    <div class="alloc-foot ${totalPercent > 100 ? 'over' : ''}">
      ${totalPercent > 100
        ? `配分の合計が${totalPercent}%で、100%を超えています。どれかを減らしてください。`
        : `配分合計 ${totalPercent}%　残り${100 - totalPercent}%（${yen(unallocated)}）は予定外の出費用に残ります。`}
    </div>
  </section>`;
}

function budgetView() {
  const pr = state.profile;
  const usedExtras = new Set(state.fixedCosts.map((c) => c.name));
  const hist = history();
  const histHint = (id) => (hist?.byCategory[id] != null ? `過去${hist.months}か月平均 ${yen(hist.byCategory[id])}` : '');
  return `
    ${summaryCard()}
    ${suggestCard()}

    <section class="card">
      <h2>収入</h2>
      ${moneyInput('profile.takeHome', pr.takeHome, '手取り月収', { hint: '計算の基準になります' })}
      ${moneyInput('profile.sideIncome', pr.sideIncome, '副業収入（月）')}
      ${moneyInput('profile.otherIncome', pr.otherIncome, 'その他収入（月）')}
      ${moneyInput('profile.bonus', pr.bonus, 'ボーナス（年間・手取り）')}
      <div class="segmented" role="radiogroup" aria-label="ボーナスの扱い">
        <button type="button" data-action="bonus-mode" data-mode="separate" class="${pr.bonusMode !== 'monthly' ? 'selected' : ''}">別管理</button>
        <button type="button" data-action="bonus-mode" data-mode="monthly" class="${pr.bonusMode === 'monthly' ? 'selected' : ''}">毎月に換算</button>
      </div>
      <p class="note">毎月に換算すると、ボーナスの1/12を毎月の収入に加えます。</p>
      <label class="field payday-field">
        <span class="field-label">給料日<small>この日から次の給料日の前日までを「1か月」として計算します</small></span>
        <select data-bind="profile.payday" data-num>
          ${Array.from({ length: MAX_PAYDAY }, (_, i) => i + 1).map((d) => `<option value="${d}" ${payday() === d ? 'selected' : ''}>${d === 1 ? '1日（暦どおり・月末締め）' : `${d}日`}</option>`).join('')}
        </select>
      </label>
      <p class="note">29〜31日が給料日の場合は28日を選んでください。</p>
      <details>
        <summary>月給（額面）も記録する</summary>
        ${moneyInput('profile.grossSalary', pr.grossSalary, '月給（額面）', { hint: '参考値。計算には使いません' })}
      </details>
    </section>

    <section class="card">
      <div class="card-head"><h2>固定費</h2><span class="muted">合計 <strong data-live="fixed">${yen(plan().fixed)}</strong></span></div>
      ${state.fixedCosts.map((c, i) => `
        <div class="fixed-row">
          <input type="text" class="fixed-name" data-bind="fixedCosts.${i}.name" value="${esc(c.name)}" aria-label="項目名" maxlength="20">
          <span class="money-input">
            <input type="number" inputmode="numeric" min="0" data-bind="fixedCosts.${i}.amount" value="${n(c.amount) || ''}" placeholder="0" aria-label="${esc(c.name)}の金額">
            <span class="unit">円</span>
          </span>
          <button class="icon-btn" data-action="remove-fixed" data-index="${i}" aria-label="${esc(c.name)}を削除">✕</button>
        </div>`).join('')}
      <div class="chips">
        ${EXTRA_FIXED_COSTS.filter((x) => !usedExtras.has(x.name)).map((x) => `<button class="chip" data-action="add-fixed" data-name="${esc(x.name)}" data-category="${x.category}">＋ ${esc(x.name)}</button>`).join('')}
        <button class="chip" data-action="add-fixed" data-name="" data-category="other">＋ 項目を追加</button>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h2>生活費予算</h2><span class="muted">合計 <strong data-live="living">${yen(plan().living)}</strong></span></div>
      ${state.budgets.map((b, i) => moneyInput(`budgets.${i}.monthlyLimit`, b.monthlyLimit, BUDGET_LABELS[b.category] || catMap()[b.category]?.name || b.category, { hint: histHint(b.category) })).join('')}
      <p class="note">外食・趣味・衣服などは下の「自由に使えるお金の使い道」で配分します。</p>
    </section>

    ${allocCard()}

    <section class="card">
      <h2>貯蓄</h2>
      ${moneyInput('simulation.monthlySavings', state.simulation.monthlySavings, '毎月の貯蓄目標', { hint: '目的別の貯金とは別枠' })}
      ${moneyInput('profile.currentSavings', pr.currentSavings, '現在の貯金額', { hint: '目的別に貯めている分も含めた合計' })}
    </section>

    ${goalsCard()}

    <section class="card">
      <h2>積立投資（NISAなど）</h2>
      ${moneyInput('simulation.monthlyInvestment', state.simulation.monthlyInvestment, '毎月の積立額')}
      ${moneyInput('profile.currentInvestment', pr.currentInvestment, '現在の投資残高')}
      <p class="note">利回りや将来の見込みは「将来」タブで確認できます。</p>
    </section>`;
}

/* ---------- 目的別の貯金（車・引っ越し・家具など） ---------- */

const GOAL_PRESETS = [
  { icon: '🚗', name: '車' },
  { icon: '📦', name: '引っ越し' },
  { icon: '🛋️', name: '家具・家電' },
  { icon: '✈️', name: '旅行' },
  { icon: '🎯', name: 'その他' },
];

function goalsCard() {
  return `<section class="card" id="goals-card">
    <h2>🎯 目的別の貯金</h2>
    <p class="note lead">車・引っ越し・家具など、使う時期が決まっているお金を目的ごとに貯めます。運用益は考えず、<strong>購入予定月の前月まで</strong>に貯め切るための毎月の金額を逆算します。</p>
    ${state.goals.map(goalRow).join('')}
    <div class="chips">${GOAL_PRESETS.map((x) => `<button class="chip" data-action="add-goal" data-name="${esc(x.name)}" data-icon="${x.icon}">＋ ${x.icon} ${esc(x.name)}</button>`).join('')}</div>
    <div id="goals-foot">${goalsFoot()}</div>
  </section>`;
}

function goalRow(g, i) {
  const now = new Date();
  const fromYear = Math.min(now.getFullYear(), n(g.targetYear) || now.getFullYear());
  const years = Array.from({ length: now.getFullYear() + 16 - fromYear }, (_, k) => fromYear + k);
  return `<div class="goal">
    <div id="goal-res-${esc(g.id)}">${goalResultHtml(g)}</div>
    <details ${n(g.targetAmount) <= 0 ? 'open' : ''}>
      <summary>設定を変更</summary>
      <label class="field"><span class="field-label">名前</span><input type="text" data-bind="goals.${i}.name" value="${esc(g.name)}" maxlength="20"></label>
      ${moneyInput(`goals.${i}.targetAmount`, g.targetAmount, '目標金額')}
      <div class="field">
        <span class="field-label">購入予定</span>
        <div class="ym">
          <select data-bind="goals.${i}.targetYear" data-num aria-label="購入予定の年">${years.map((y) => `<option value="${y}" ${n(g.targetYear) === y ? 'selected' : ''}>${y}年</option>`).join('')}</select>
          <select data-bind="goals.${i}.targetMonth" data-num aria-label="購入予定の月">${Array.from({ length: 12 }, (_, k) => k + 1).map((m) => `<option value="${m}" ${n(g.targetMonth) === m ? 'selected' : ''}>${m}月</option>`).join('')}</select>
        </div>
      </div>
      ${moneyInput(`goals.${i}.saved`, g.saved, '今の残高', { hint: '現在の貯金額のうち、この目的で貯めている分' })}
      <div class="btn-row">
        <button class="btn" data-action="purchase-goal" data-id="${esc(g.id)}">購入済みにする</button>
        <button class="btn danger" data-action="delete-goal" data-id="${esc(g.id)}">削除</button>
      </div>
    </details>
  </div>`;
}

/** 名前・進み具合・毎月の積立額（入力中も部分更新する） */
function goalResultHtml(g) {
  const gp = goalPlan(g);
  const by = `${n(g.targetYear)}年${n(g.targetMonth)}月`;
  const last = new Date(n(g.targetYear), n(g.targetMonth) - 2, 1);
  const head = `<div class="goal-head">
    <span class="goal-name">${g.icon} ${esc(g.name) || '（名前なし）'}</span>
    <span class="goal-target">${gp.target > 0 ? `${yen(gp.target)} / ${by}` : by}</span>
  </div>`;
  if (gp.status === 'unset') return `${head}<p class="note">目標金額を入れると、毎月の積立額を計算します。</p>`;
  const progress = `<div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(gp.progress * 100)}"><span style="width:${gp.progress * 100}%"></span></div>
    <p class="goal-sub">${yen(gp.saved)} 貯まっています（${Math.round(gp.progress * 100)}%）${gp.remaining > 0 ? `・あと${yen(gp.remaining)}` : ''}</p>`;
  let body;
  if (gp.status === 'done') {
    body = `<p class="goal-msg ok">🎉 目標達成！ 購入したら「購入済みにする」を押してください。</p>
      <button class="btn block" data-action="purchase-goal" data-id="${esc(g.id)}">購入済みにする</button>`;
  } else if (gp.status === 'active') {
    body = `<p class="goal-monthly">毎月 <strong>${yen(gp.monthly)}</strong> <span class="muted">（${last.getFullYear() !== new Date().getFullYear() ? `${last.getFullYear()}年` : ''}${last.getMonth() + 1}月までの${gp.slots}回）</span></p>
      ${gp.contributed
        ? `<p class="goal-msg ok">✅ 今月分（${yen(gp.thisMonthAmount)}）は積み立て済みです。</p>`
        : `<button class="btn primary block" data-action="contribute-goal" data-id="${esc(g.id)}">今月分を積み立てた（+${yen(gp.monthly)}）</button>`}`;
  } else {
    body = `<p class="goal-msg caution">${gp.status === 'overdue' ? '購入予定月を過ぎています。' : '購入予定月までに積み立てられる回数が残っていません。'}あと${yen(gp.remaining)}足りません。購入予定を後ろにずらすか、目標金額を見直してください。</p>`;
  }
  return head + progress + body;
}

function goalsFoot() {
  if (!state.goals.length) return '<p class="note">上のボタンから、貯めたい目的を追加できます。</p>';
  const p = plan();
  const freeBefore = p.free + p.goals; // 目的別の積立を引く前に残るお金
  const marked = earmarkedSavings(state.goals);
  const cs = n(state.profile.currentSavings);
  const warns = [];
  if (p.goals > 0 && p.free < 0) warns.push(`目的別の積立（月${yen(p.goals)}）が、ほかの予算と貯蓄を引いたあとに残るお金（月${yen(Math.max(0, freeBefore))}）を超えています。購入予定を後ろにずらすか、目標金額を見直してください。`);
  if (marked > cs) warns.push(`目的別の「今の残高」の合計（${yen(marked)}）が、現在の貯金額（${yen(cs)}）を超えています。どちらかの金額を見直してください。`);
  return `
    <div class="goals-total"><span>今月の目的別の積立</span><strong>${yen(p.goals)}</strong></div>
    ${warns.map((w) => `<p class="note caution">${esc(w)}</p>`).join('')}
    <p class="note">毎月の積立額は「自由に使えるお金」から差し引いています。「毎月の貯蓄目標」に車の分などを含めていた場合は、二重にならないよう、その分を貯蓄目標から減らしてください。</p>
    <p class="note">購入したときの支払いは家計簿に記録せず、「購入済みにする」を押してください（現在の貯金額から、その目的の残高を差し引きます）。</p>`;
}

async function saveGoalsAndRender(message, undo) {
  await ds.saveGoals(state.goals);
  render();
  if (message) showToast(message, undo);
}

/* ---------- シミュレーション ---------- */

const SIM_YEARS = [1, 3, 5, 10, 20];
const investYears = () => Math.min(50, Math.max(1, Math.round(n(state.simulation.investYears)) || 20));

function projection(years) {
  const pr = state.profile;
  const sim = state.simulation;
  const savings = futureSavings(generalSavings(), sim.monthlySavings, years);
  const inv = futureInvestment(pr.currentInvestment, sim.monthlyInvestment, sim.annualReturn, years);
  return { years, savings, ...inv, total: savings + inv.value };
}

function simView() {
  const pr = state.profile;
  const sim = state.simulation;
  const goal = state.goal;
  return `
    <section class="card" id="health-card">${healthCard()}</section>

    <section class="card">
      <h2>貯金</h2>
      ${moneyInput('profile.currentSavings', pr.currentSavings, '現在の貯金額')}
      ${moneyInput('simulation.monthlySavings', sim.monthlySavings, '毎月の貯蓄額')}
      <p class="note">年間 <strong data-live="annual">${yen(n(sim.monthlySavings) * 12)}</strong> 貯まる計算です。</p>
      ${state.goals.length ? `<p class="note">目的別の貯金（車・引っ越しなど）は使う予定のお金なので、ここでの将来の資産には含めていません（今の残高 ${yen(earmarkedSavings(state.goals))} を除いて計算）。</p>` : ''}
    </section>

    <section class="card">
      <h2>積立投資（NISAなど）</h2>
      ${moneyInput('profile.currentInvestment', pr.currentInvestment, '現在の投資残高')}
      ${moneyInput('simulation.monthlyInvestment', sim.monthlyInvestment, '毎月の積立額')}
      <div class="field-pair">
        ${numberInput('simulation.annualReturn', sim.annualReturn, '想定利回り', { unit: '%', step: 0.1, max: 20 })}
        ${numberInput('simulation.investYears', sim.investYears, '運用期間', { unit: '年', max: 50 })}
      </div>
      <details>
        <summary>NISAの生涯投資枠をすでに使っている場合</summary>
        ${moneyInput('simulation.nisaUsed', sim.nisaUsed, '使用済みの枠（買付元本）', { hint: '売却で空いた枠は除く' })}
      </details>
      <div id="nisa-check">${nisaCheckHtml()}</div>
    </section>

    <section class="card" id="sim-result">
      ${simResult()}
    </section>

    <section class="card">
      <h2>🎯 目標金額から逆算</h2>
      <div class="field-pair">
        ${moneyInput('goal.targetAmount', goal.targetAmount, '目標金額')}
        ${numberInput('goal.years', goal.years, '期間', { unit: '年後', max: 50 })}
      </div>
      <div id="goal-result">${goalResult()}</div>
    </section>

    <section class="card">
      <h2>📈 昇給・転職シミュレーション</h2>
      <div class="field-pair">
        ${numberInput('simulation.incomeGrowthRate', sim.incomeGrowthRate, '毎年の昇給率', { unit: '%', step: 0.1, max: 20 })}
        ${moneyInput('simulation.jobChangeIncrease', sim.jobChangeIncrease, '転職などで手取り増')}
      </div>
      ${numberInput('simulation.raiseSaveShare', sim.raiseSaveShare, '増えた分のうち貯蓄に回す割合', { unit: '%', max: 100 })}
      <div id="raise-result">${raiseResult()}</div>
    </section>

    <section class="card">
      <h2>✂️ 節約効果シミュレーション</h2>
      ${savingRows()}
      <div id="saving-result">${savingResult()}</div>
    </section>`;
}

function healthCard() {
  const p = plan();
  const h = householdHealth(p);
  if (!h) return '<h2>家計の診断</h2><p class="muted">予算タブで手取り収入を入力すると診断できます。</p>';
  const pos = Math.max(0, p.free);
  const total = Math.max(p.income, p.fixed + p.living + p.savings + p.investment + p.goals + pos);
  const seg = (v, cls) => (v > 0 ? `<span class="seg ${cls}" style="width:${(v / total) * 100}%"></span>` : '');
  const pct = (v) => `${Math.round((v / p.income) * 100)}%`;
  const tips = fixedCostTips(state.fixedCosts);
  const tipsHtml = tips.length ? `
    <ul class="tips">${tips.map((t) => `<li><strong>${esc(t.names.join('・'))}</strong> <span class="muted">月${yen(t.amount)}（手取りの${pct(t.amount)}）</span><br>${esc(t.tip)}</li>`).join('')}</ul>` : '';
  return `
    <h2>家計の診断</h2>
    <div class="health ${h.level}">
      <p class="health-label">${h.emoji} ${h.label}</p>
      <p>${h.description}</p>
    </div>
    <p class="legend">
      <span><i class="dot fixed"></i>固定費 ${pct(p.fixed)}</span>
      <span><i class="dot living"></i>生活費 ${pct(p.living)}</span>
      <span><i class="dot save"></i>貯蓄・積立${p.goals > 0 ? '（目的別を含む）' : ''} ${pct(p.savings + p.investment + p.goals)}</span>
      <span><i class="dot gain"></i>自由 ${pct(pos)}</span>
    </p>
    <div class="split-bar income-bar" role="img" aria-label="手取りの内訳">
      ${seg(p.fixed, 'fixed')}${seg(p.living, 'living')}${seg(p.savings + p.investment + p.goals, 'save')}${seg(pos, 'gain')}
    </div>
    <div class="metrics">
      <div><span>貯蓄率</span><strong>${Math.round(h.savingsRate)}%</strong><small>目安 20%以上</small></div>
      <div><span>固定費率</span><strong>${Math.round(h.fixedRate)}%</strong><small>目安 40%以下</small></div>
      <div><span>自由支出率</span><strong>${Math.round(h.freeRate)}%</strong><small>手取りに対して</small></div>
    </div>
    ${h.reasons.length ? `<ul class="reasons">${h.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${tipsHtml ? (h.fixedRate > 40
      ? `<h3 class="sub-head">見直すと効果が大きい固定費</h3>${tipsHtml}`
      : `<details><summary>固定費の見直しポイント</summary>${tipsHtml}</details>`) : ''}`;
}

function goalResult() {
  const g = state.goal;
  const pr = state.profile;
  const sim = state.simulation;
  const target = n(g.targetAmount);
  const years = Math.min(50, Math.max(1, Math.round(n(g.years)) || 10));
  if (target <= 0) return '<p class="muted">「10年後に1,000万円」のように入力すると、毎月いくら必要かを計算します。</p>';

  const current = generalSavings() + n(pr.currentInvestment);
  const rate = n(sim.annualReturn);
  const need = requiredMonthly(target, current, years);
  const needInvested = rate > 0 ? requiredMonthly(target, current, years, rate) : null;
  const monthlyNow = n(sim.monthlySavings) + n(sim.monthlyInvestment);
  const proj = futureSavings(generalSavings(), sim.monthlySavings, years)
    + futureInvestment(pr.currentInvestment, sim.monthlyInvestment, rate, years).value;
  const reachAt = monthsToReach(target, { ...pr, ...sim, currentSavings: generalSavings() });
  const free = Math.max(0, plan().free);

  let verdict;
  if (proj >= target) {
    verdict = `<div class="result-box ok">
      <p>✅ 今のペース（毎月${yen(monthlyNow)}）なら達成できる見込みです。</p>
      <p class="muted">${years}年後には約${yen(proj)}。目標には約${formatMonths(reachAt)}で届く計算です。</p>
    </div>`;
  } else {
    const extra = (target - proj) / (years * 12);
    const doable = extra <= free;
    verdict = `<div class="result-box ${doable ? 'caution' : 'over'}">
      <p>毎月あと<strong>${yen(extra)}</strong>貯蓄を増やす必要があります。</p>
      <p class="muted">今のペースだと${years}年後は約${yen(proj)}（あと${yen(target - proj)}）。${doable
        ? `自由に使えるお金（月${yen(free)}）から回せば達成できます。`
        : `今の収支では難しいため、${reachAt != null ? `期間を約${formatMonths(reachAt)}に延ばす` : '毎月の貯蓄額を増やす'}か、目標額の見直しを検討しましょう。`}</p>
    </div>`;
  }
  return `
    <dl class="flow compact-2">
      <div><dt>必要な積立額（貯金のみ）</dt><dd>月${yen(need)}</dd></div>
      ${needInvested != null ? `<div><dt>年${rate}%で運用する場合（想定）</dt><dd>月${yen(needInvested)}</dd></div>` : ''}
      <div><dt>今の貯蓄＋積立</dt><dd>月${yen(monthlyNow)}</dd></div>
    </dl>
    ${verdict}`;
}

function raiseResult() {
  const sim = state.simulation;
  const base = n(state.profile.takeHome);
  if (base <= 0) return '<p class="muted">予算タブで手取り月収を入力すると計算できます。</p>';
  const opts = { base, growthPct: sim.incomeGrowthRate, jobIncrease: sim.jobChangeIncrease, saveShare: sim.raiseSaveShare };
  if (n(opts.growthPct) <= 0 && n(opts.jobIncrease) <= 0) return '<p class="muted">昇給率や転職による増額を入れると、将来の手取りと貯蓄への効果を計算します。</p>';
  const rows = SIM_YEARS.map((y) => ({ y, ...incomeGrowth(opts, y) }));
  const ten = rows.find((r) => r.y === 10);
  return `
    <table class="sim-table">
      <thead><tr><th>時期</th><th>手取り月収</th><th>上乗せ貯蓄（累計）</th></tr></thead>
      <tbody>
        <tr><td>現在</td><td>${yen(base)}</td><td>—</td></tr>
        ${rows.map((r) => `<tr><td>${r.y}年後</td><td>${yen(r.income)}</td><td>+${yen(r.extraSavings)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="note">10年後の手取りは約${yen(ten.income)}。増えた分の${n(sim.raiseSaveShare)}%を貯蓄に回すと、10年間で約${yen(ten.extraSavings)}多く貯まります（税・社会保険料の変化は考慮していません）。</p>`;
}

function savingItems() {
  const plan_ = state.simulation.savingPlan || {};
  const items = [
    ...state.fixedCosts.filter((c) => n(c.amount) > 0).map((c) => ({ key: `fixed:${c.id}`, name: c.name, current: n(c.amount) })),
    ...state.budgets.filter((b) => n(b.monthlyLimit) > 0).map((b) => ({ key: `budget:${b.category}`, name: BUDGET_LABELS[b.category] || b.category, current: n(b.monthlyLimit) })),
    ...freeAlloc().items.filter((i) => catMap()[i.category]).map((i) => ({ key: `alloc:${i.category}`, name: catMap()[i.category].name, current: Math.round(i.monthly) })),
  ];
  return items.map((i) => ({ ...i, after: plan_[i.key] ?? null }));
}

function savingRows() {
  const items = savingItems();
  if (!items.length) return '<p class="muted">固定費や予算を入力すると、見直した場合の効果を計算できます。</p>';
  return `
    <p class="note lead">見直したい項目に、見直し後の金額を入れてください（実際の予算は変わりません）。</p>
    <div class="saving-rows">
      ${items.map((i) => `
        <label class="saving-row">
          <span class="saving-name">${esc(i.name)}<small>今 ${yen(i.current)}</small></span>
          <span class="money-input">
            <input ${moneyAttrs} data-bind="simulation.savingPlan.${esc(i.key)}" value="${i.after == null ? '' : Math.round(i.after).toLocaleString('ja-JP')}" placeholder="${moneyValue(i.current)}" aria-label="${esc(i.name)}の見直し後の金額">
            <span class="unit">円</span>
          </span>
        </label>`).join('')}
    </div>
    <button class="btn block" data-action="clear-saving">見直し案をクリア</button>`;
}

function savingResult() {
  const rate = n(state.simulation.annualReturn);
  const e = savingEffect(savingItems(), rate);
  if (e.monthly <= 0) return '';
  return `<div class="result-box ok">
    <p>月<strong>${yen(e.monthly)}</strong>の節約になります。</p>
    <dl class="flow compact-2">
      <div><dt>1年間</dt><dd>${yen(e.yearly)}</dd></div>
      <div><dt>10年間</dt><dd>${yen(e.tenYears)}</dd></div>
      ${rate > 0 ? `<div><dt>節約分を年${rate}%で積立運用した場合（想定）</dt><dd>${yen(e.tenYearsInvested)}</dd></div>` : ''}
    </dl>
  </div>`;
}

function nisaCheckHtml() {
  const c = nisaCheck(state.simulation.monthlyInvestment, state.simulation.nisaUsed);
  if (!c) return '';
  const icon = { ok: '✅', caution: '⚠️', over: '⚠️' }[c.level];
  return `<div class="nisa ${c.level}">
    <p><span aria-hidden="true">${icon}</span> ${esc(c.annualMessage)}</p>
    <p class="muted">${esc(c.lifetimeMessage)}</p>
  </div>`;
}

function simResult() {
  const rate = n(state.simulation.annualReturn);
  const hasInv = n(state.profile.currentInvestment) > 0 || n(state.simulation.monthlyInvestment) > 0;
  const iy = investYears();
  const target = projection(iy);
  const rows = [...new Set([...SIM_YEARS, iy])].sort((a, b) => a - b).map(projection);
  const max = Math.max(...rows.map((r) => r.total), 1);
  const pct = (v) => `${(Math.max(0, v) / max) * 100}%`;

  return `
    ${hasInv ? `
      <div class="sim-highlight">
        <p class="hero-label">${iy}年後の投資資産（年${rate}%の場合）</p>
        <p class="sim-highlight-value">${yen(target.value)}</p>
        <div class="split-bar" aria-hidden="true">
          <span class="seg principal" style="width:${(target.principal / Math.max(target.value, target.principal, 1)) * 100}%"></span>
          <span class="seg gain" style="width:${(Math.max(0, target.gain) / Math.max(target.value, 1)) * 100}%"></span>
        </div>
        <dl class="flow compact-2">
          <div><dt><i class="dot principal"></i>元本（現在の残高＋積立）</dt><dd>${yen(target.principal)}</dd></div>
          <div><dt><i class="dot gain"></i>想定運用益</dt><dd>${target.gain >= 0 ? '+' : ''}${yen(target.gain)}</dd></div>
        </dl>
        <p class="note">同じ金額を積立せず現金で置いておいた場合と比べて、想定上は${yen(target.gain)}の差になります。</p>
      </div>` : ''}

    <h2>このペースで続けると</h2>
    ${hasInv ? `<p class="legend"><span><i class="dot save"></i>貯金</span><span><i class="dot principal"></i>投資元本</span><span><i class="dot gain"></i>想定運用益</span></p>` : ''}
    <ul class="sim-list">
      ${rows.map((r) => `
        <li class="${r.years === iy && hasInv ? 'is-target' : ''}">
          <span class="sim-year">${r.years}年後</span>
          <span class="sim-bar">
            <span class="seg save" style="width:${pct(r.savings)}"></span>
            ${hasInv ? `<span class="seg principal" style="width:${pct(Math.min(r.principal, r.value))}"></span><span class="seg gain" style="width:${pct(r.gain)}"></span>` : ''}
          </span>
          <span class="sim-value">${yen(r.total)}${hasInv ? `<small>貯金 ${yen(r.savings)} ／ 投資 ${yen(r.value)}</small>` : ''}</span>
        </li>`).join('')}
    </ul>
    <p class="note">貯金は利息なし、投資は想定利回り（年${rate}%、月複利）が一定で続いた場合のシミュレーションです。実際の運用成果は相場によって上下し、元本を下回ることもあります。将来の成果を保証するものではありません。税金・手数料・昇給は含めていません。</p>`;
}

/* ---------- 設定 ---------- */

/* ---------- PWA（ホーム画面に追加・オフライン） ---------- */

const APP_VERSION = '1.3.0';
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installCard() {
  let body;
  if (isStandalone()) {
    body = '<p>✅ ホーム画面のアプリとして起動しています。データはこの端末の中だけに保存されます。</p>';
  } else if (installPrompt) {
    body = `<p>ホーム画面に追加すると、アプリのように起動でき、オフラインでも使えます。</p>
      <button class="btn primary block" data-action="install">ホーム画面に追加</button>`;
  } else if (isIOS()) {
    body = `<ol class="steps">
      <li>Safari 下部の <strong>共有ボタン</strong>（□に↑）をタップ</li>
      <li><strong>「ホーム画面に追加」</strong>を選ぶ</li>
      <li>右上の<strong>「追加」</strong>をタップ</li>
    </ol>`;
  } else {
    body = '<p>ブラウザのメニュー（︙）から<strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>を選んでください。</p>';
  }
  return `<section class="card" id="install-card"><h2>📱 アプリとして使う</h2>${body}</section>`;
}

function refreshInstallCard() {
  const el = document.getElementById('install-card');
  if (el) el.outerHTML = installCard();
}

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  refreshInstallCard();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  refreshInstallCard();
});

function updateOnlineBadge() {
  document.getElementById('offline-badge').hidden = navigator.onLine;
}
window.addEventListener('online', updateOnlineBadge);
window.addEventListener('offline', updateOnlineBadge);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./service-worker.js').catch((err) => console.warn('Service worker の登録に失敗しました', err));
}
// ホーム画面から使う場合は、端末の空き容量が少なくてもデータが消されにくくする
if (isStandalone()) navigator.storage?.persist?.();

function lastBackupText() {
  const at = state.meta.lastBackupAt;
  if (!at) return '💾 まだバックアップしていません';
  const d = new Date(at);
  const days = Math.floor((Date.now() - d) / 86400000);
  return `💾 最後のバックアップ：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${days === 0 ? '今日' : `${days}日前`}）`;
}

/** バックアップファイルを作り、スマホでは共有メニュー（ファイルに保存・LINE など）、PC ではダウンロードで保存する */
async function exportBackup() {
  const json = JSON.stringify(await ds.exportAll(), null, 2);
  const name = `my-money-backup-${toDateKey(new Date())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'my-money バックアップ' });
    } catch (err) {
      if (err.name === 'AbortError') return false; // 共有をキャンセルした
      throw err;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  state.meta.lastBackupAt = new Date().toISOString();
  delete state.meta.snoozedUntil;
  await ds.saveMeta(state.meta);
  return true;
}

function settingsView() {
  const custom = state.categories.filter((c) => c.custom);
  return `
    ${installCard()}

    <section class="card">
      <h2>カテゴリを追加</h2>
      <div class="cat-form">
        <input type="text" id="cat-icon" placeholder="🐶" maxlength="2" aria-label="絵文字">
        <input type="text" id="cat-name" placeholder="カテゴリ名（例：ペット）" maxlength="12" aria-label="カテゴリ名">
      </div>
      <div class="segmented" role="radiogroup" aria-label="予算の区分">
        <button type="button" data-action="cat-group" data-group="free" class="selected">自由に使えるお金から</button>
        <button type="button" data-action="cat-group" data-group="living">生活費予算から</button>
      </div>
      <button class="btn block" data-action="add-category">追加する</button>
      ${custom.length ? `<ul class="plain-list">${custom.map((c) => `<li><span>${c.icon} ${esc(c.name)} <small class="muted">${c.group === 'living' ? '生活費' : '自由費'}</small></span><button class="icon-btn" data-action="delete-category" data-id="${esc(c.id)}" aria-label="${esc(c.name)}を削除">✕</button></li>`).join('')}</ul>` : ''}
    </section>

    <section class="card" id="data-card">
      <h2>データ</h2>
      <p class="note">${persistent ? 'データはこの端末のブラウザ内にだけ保存され、外部には送信されません。' : '⚠ このブラウザでは保存ができないため、ページを閉じるとデータが消えます。'}</p>
      <p class="backup-status">${lastBackupText()}</p>
      ${isIOS() && !isStandalone() ? '<p class="note caution">Safari のまま使っていると、しばらくアプリを開かなかったときにデータが消えることがあります。ホーム画面に追加して使うと安心です。</p>' : ''}
      <div class="btn-row">
        <button class="btn" data-action="export">バックアップを保存</button>
        <label class="btn">バックアップから復元<input type="file" accept="application/json" id="import-file" hidden></label>
      </div>
      <button class="btn danger block" data-action="reset">すべてのデータを削除</button>
    </section>

    <p class="muted center">my-money v${APP_VERSION}</p>`;
}

/* ---------- ルーティング・描画 ---------- */

const routes = {
  home: { title: 'ホーム', view: homeView },
  ledger: { title: '家計簿', view: ledgerView },
  budget: { title: '予算', view: budgetView },
  sim: { title: 'シミュレーション', view: simView },
  settings: { title: '設定', view: settingsView },
};
const currentRoute = () => {
  const r = location.hash.replace(/^#\/?/, '');
  return routes[r] ? r : 'home';
};

function render() {
  hideTip();
  const r = currentRoute();
  document.getElementById('page-title').textContent = routes[r].title;
  document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === r));
  $main.innerHTML = routes[r].view();
}

/* 予算・シミュレーション入力中はフォーカスを保つため部分更新のみ行う */
function refreshLive() {
  const p = plan();
  const summary = document.getElementById('live-summary');
  if (summary) summary.outerHTML = summaryCard();
  document.querySelectorAll('[data-live="fixed"]').forEach((el) => (el.textContent = yen(p.fixed)));
  document.querySelectorAll('[data-live="living"]').forEach((el) => (el.textContent = yen(p.living)));
  document.querySelectorAll('[data-live="annual"]').forEach((el) => (el.textContent = yen(n(state.simulation.monthlySavings) * 12)));
  const sim = document.getElementById('sim-result');
  if (sim) sim.innerHTML = simResult();
  const alloc = document.getElementById('alloc-card');
  if (alloc) {
    if (alloc.contains(document.activeElement)) {
      const it = freeAlloc().items.find((i) => i.category === 'eatout');
      const el = alloc.querySelector('[data-live="eatout-visit"]');
      if (it && el) el.textContent = yen(it.weekly / visitsPerWeek());
    } else {
      alloc.outerHTML = allocCard();
    }
  }
  const nisa = document.getElementById('nisa-check');
  if (nisa) nisa.innerHTML = nisaCheckHtml();
  const partials = { 'health-card': healthCard, 'goal-result': goalResult, 'raise-result': raiseResult, 'saving-result': savingResult, 'goals-foot': goalsFoot };
  for (const [id, fn] of Object.entries(partials)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = fn();
  }
  for (const g of state.goals) {
    const el = document.getElementById(`goal-res-${g.id}`);
    if (el) el.innerHTML = goalResultHtml(g);
  }
}

const persisters = {
  profile: () => ds.saveProfile(state.profile),
  fixedCosts: () => ds.saveFixedCosts(state.fixedCosts),
  budgets: () => ds.saveBudgets(state.budgets),
  simulation: () => ds.saveSimulation(state.simulation),
  allocations: () => ds.saveAllocations(state.allocations),
  goal: () => ds.saveGoal(state.goal),
  goals: () => ds.saveGoals(state.goals),
};
const pendingSaves = new Set();
let saveTimer;
function schedulePersist(root) {
  pendingSaves.add(root);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 300);
}
function flushSaves() {
  clearTimeout(saveTimer);
  pendingSaves.forEach((k) => persisters[k]());
  pendingSaves.clear();
}
window.addEventListener('pagehide', flushSaves);

function setByPath(path, raw, isNumber) {
  const keys = path.split('.');
  let obj = state;
  for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
  const key = keys.at(-1);
  // 節約シミュレーションは空欄＝見直しなし
  if (isNumber && raw === '' && keys.at(-2) === 'savingPlan') delete obj[key];
  else obj[key] = isNumber ? Math.max(0, n(raw)) : raw;
}

function onBoundInput(t) {
  const money = 'money' in t.dataset;
  const raw = money && t.value.trim() !== '' ? parseMoney(t.value) : t.value;
  setByPath(t.dataset.bind, raw, money || t.type === 'number' || 'num' in t.dataset);
  schedulePersist(t.dataset.bind.split('.')[0]);
  refreshLive();
}

/** 入力中の金額を「300,000」の形に整え、カーソル位置（何桁目か）を保つ */
function formatMoneyField(el) {
  const caret = el.selectionStart ?? el.value.length;
  const digitsBefore = el.value.slice(0, caret).replace(/[^0-9０-９]/g, '').length;
  const text = formatMoneyText(el.value);
  if (text === el.value) return;
  el.value = text;
  let pos = 0;
  for (let seen = 0; pos < text.length && seen < digitsBefore; pos++) if (/\d/.test(text[pos])) seen++;
  el.setSelectionRange(pos, pos);
}

// 日本語入力（全角）の変換中は整形せず、確定してから整える
$main.addEventListener('compositionend', (ev) => {
  if ('money' in ev.target.dataset) ev.target.dispatchEvent(new Event('input', { bubbles: true }));
});

$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if ('money' in t.dataset) {
    if (ev.isComposing) return;
    formatMoneyField(t);
  }
  if (t.dataset.bind) {
    onBoundInput(t);
  } else if (t.id === 'check-amount') {
    ui.checkAmount = t.value;
    const res = judgeSpend(parseMoney(t.value), allow());
    const el = document.getElementById('check-result');
    el.className = 'check-result ' + (res ? res.level : '');
    el.textContent = res ? res.message : '金額を入れると、今週・今月の予算で判定します。';
  }
});

$main.addEventListener('change', async (ev) => {
  // 古いブラウザでは select が input イベントを出さないため change でも受け取る
  if (ev.target.tagName === 'SELECT' && ev.target.dataset.bind) return onBoundInput(ev.target);
  if (ev.target.id !== 'import-file') return;
  const file = ev.target.files[0];
  if (!file) return;
  try {
    await ds.importAll(JSON.parse(await file.text()));
    await loadAll();
    alert('復元しました。');
    render();
  } catch (err) {
    alert('復元できませんでした：' + err.message);
  }
});

$main.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.id === 'entry-amount') {
    ev.preventDefault();
    if (ui.editingId) saveExpense();
    else addExpense();
  }
});

/** 日付が含まれる期間が、今の期間からいくつ前／後か */
function periodOffsetOf(dateKey) {
  const cur = currentPeriod().start;
  const target = budgetPeriod(parseDateKey(dateKey), payday()).start;
  return (target.getFullYear() - cur.getFullYear()) * 12 + target.getMonth() - cur.getMonth();
}

/** 記録フォームの内容を読み取る。金額がなければ null */
function readEntryForm() {
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

function endEdit() {
  ui.editingId = null;
  if (ui.categoryBeforeEdit && catMap()[ui.categoryBeforeEdit]) ui.entryCategory = ui.categoryBeforeEdit;
  ui.categoryBeforeEdit = null;
}

async function deleteExpenseWithUndo(e) {
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

async function saveExpense() {
  const form = readEntryForm();
  if (!form) return;
  const updated = await ds.updateExpense(ui.editingId, form);
  state.expenses = state.expenses.map((x) => (x.id === updated.id ? updated : x));
  endEdit();
  ui.ledgerOffset = periodOffsetOf(updated.date);
  render();
  showToast('更新しました');
}

async function quickAdd(q) {
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

async function addExpense() {
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

$main.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;

  switch (action) {
    case 'pick-category':
      ui.entryCategory = btn.dataset.id;
      document.querySelectorAll('.cat').forEach((c) => {
        const on = c.dataset.id === ui.entryCategory;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-checked', on);
      });
      break;
    case 'add-expense':
      await addExpense();
      break;
    case 'delete-expense': {
      const e = state.expenses.find((x) => x.id === btn.dataset.id);
      if (e) await deleteExpenseWithUndo(e);
      break;
    }
    case 'edit-expense': {
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
      break;
    }
    case 'save-expense':
      await saveExpense();
      break;
    case 'cancel-edit':
      endEdit();
      render();
      break;
    case 'quick-add': {
      const q = ui.quickList[Number(btn.dataset.index)];
      if (q) await quickAdd(q);
      break;
    }
    case 'month':
      ui.ledgerOffset += Number(btn.dataset.delta);
      render();
      break;
    case 'ledger-mode':
      ui.ledgerMode = btn.dataset.mode;
      if (ui.ledgerMode === 'chart' && ui.editingId) endEdit();
      render();
      break;
    case 'snooze-backup':
      state.meta.snoozedUntil = addDays(new Date(), 7).toISOString();
      await ds.saveMeta(state.meta);
      render();
      showToast('7日後にもう一度お知らせします');
      break;
    case 'bonus-mode':
      state.profile.bonusMode = btn.dataset.mode;
      await ds.saveProfile(state.profile);
      render();
      break;
    case 'add-fixed':
      flushSaves();
      state.fixedCosts.push({ id: uid(), category: btn.dataset.category, name: btn.dataset.name || '新しい項目', amount: 0, billingDay: null });
      await ds.saveFixedCosts(state.fixedCosts);
      render();
      document.querySelector(`[data-bind="fixedCosts.${state.fixedCosts.length - 1}.amount"]`)?.focus();
      break;
    case 'remove-fixed': {
      flushSaves();
      const i = Number(btn.dataset.index);
      const c = state.fixedCosts[i];
      if (n(c.amount) > 0 && !confirm(`${c.name}（${yen(c.amount)}）を削除しますか？`)) return;
      state.fixedCosts.splice(i, 1);
      await ds.saveFixedCosts(state.fixedCosts);
      render();
      break;
    }
    case 'alloc':
      state.allocations.percents[btn.dataset.id] = Number(btn.dataset.pct);
      await ds.saveAllocations(state.allocations);
      document.getElementById('alloc-card').outerHTML = allocCard();
      break;
    case 'apply-suggest': {
      flushSaves();
      const p = plan();
      const sg = suggestBudget(p.income, { investment: p.investment, goals: p.goals, history: history() });
      for (const b of state.budgets) {
        if (sg.living[b.category] && n(b.monthlyLimit) === 0) b.monthlyLimit = sg.living[b.category].amount;
      }
      if (n(state.simulation.monthlySavings) === 0) state.simulation.monthlySavings = sg.savings;
      if (!Object.values(state.allocations.percents).some((v) => n(v) > 0)) state.allocations.percents = { ...sg.percents };
      await Promise.all([ds.saveBudgets(state.budgets), ds.saveSimulation(state.simulation), ds.saveAllocations(state.allocations)]);
      render();
      break;
    }
    case 'clear-saving':
      state.simulation.savingPlan = {};
      await ds.saveSimulation(state.simulation);
      render();
      break;
    case 'install':
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      refreshInstallCard();
      break;
    case 'add-goal': {
      flushSaves();
      const now = new Date();
      state.goals.push({
        id: uid(), name: btn.dataset.name, icon: btn.dataset.icon, targetAmount: 0,
        targetYear: now.getFullYear() + 1, targetMonth: now.getMonth() + 1, // 初期値は1年後
        saved: 0, lastContributionMonth: null, lastContributionAmount: 0,
      });
      await saveGoalsAndRender();
      document.querySelector(`[data-bind="goals.${state.goals.length - 1}.targetAmount"]`)?.focus();
      break;
    }
    case 'contribute-goal': {
      flushSaves();
      const g = state.goals.find((x) => x.id === btn.dataset.id);
      const gp = g && goalPlan(g);
      if (!gp || gp.status !== 'active') return;
      const before = { saved: g.saved, lastContributionMonth: g.lastContributionMonth, lastContributionAmount: g.lastContributionAmount };
      Object.assign(g, { saved: n(g.saved) + gp.monthly, lastContributionMonth: toDateKey(new Date()).slice(0, 7), lastContributionAmount: gp.monthly });
      await saveGoalsAndRender(`${g.name}に${yen(gp.monthly)}積み立てました`, {
        label: '取り消す',
        run: async () => { Object.assign(g, before); await saveGoalsAndRender('取り消しました'); },
      });
      break;
    }
    case 'purchase-goal': {
      flushSaves();
      const i = state.goals.findIndex((x) => x.id === btn.dataset.id);
      if (i < 0) return;
      const g = state.goals[i];
      const deduct = Math.min(n(g.saved), n(state.profile.currentSavings));
      if (!confirm(`「${g.name}」を購入済みにします。\n現在の貯金額から、この目的で貯めた${yen(deduct)}を差し引いて、目標を終了します。`)) return;
      const savingsBefore = state.profile.currentSavings;
      state.profile.currentSavings = n(state.profile.currentSavings) - deduct;
      state.goals.splice(i, 1);
      await ds.saveProfile(state.profile);
      await saveGoalsAndRender(`「${g.name}」を購入済みにしました`, {
        label: '元に戻す',
        run: async () => {
          state.profile.currentSavings = savingsBefore;
          state.goals.splice(i, 0, g);
          await ds.saveProfile(state.profile);
          await saveGoalsAndRender('元に戻しました');
        },
      });
      break;
    }
    case 'delete-goal': {
      flushSaves();
      const i = state.goals.findIndex((x) => x.id === btn.dataset.id);
      if (i < 0) return;
      const [g] = state.goals.splice(i, 1);
      await saveGoalsAndRender(`「${g.name}」を削除しました（貯金額はそのままです）`, {
        label: '元に戻す',
        run: async () => { state.goals.splice(i, 0, g); await saveGoalsAndRender('元に戻しました'); },
      });
      break;
    }
    case 'cat-group':
      btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === btn));
      break;
    case 'add-category': {
      const name = document.getElementById('cat-name').value.trim();
      if (!name) return document.getElementById('cat-name').focus();
      const group = document.querySelector('[data-action="cat-group"].selected')?.dataset.group || 'free';
      await ds.addCategory({ name, icon: document.getElementById('cat-icon').value.trim(), group });
      state.categories = await ds.listCategories();
      render();
      break;
    }
    case 'delete-category': {
      const c = catMap()[btn.dataset.id];
      if (!confirm(`カテゴリ「${c.name}」を削除しますか？（記録済みの支出は残ります）`)) return;
      await ds.deleteCategory(c.id);
      state.categories = await ds.listCategories();
      if (ui.entryCategory === c.id) ui.entryCategory = 'food';
      render();
      break;
    }
    case 'export':
      try {
        if (await exportBackup()) {
          render();
          showToast('バックアップを保存しました');
        }
      } catch (err) {
        alert('バックアップを保存できませんでした：' + err.message);
      }
      break;
    case 'reset':
      if (!confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) return;
      await ds.resetAll();
      await loadAll();
      location.hash = '#/home';
      render();
      break;
  }
});

window.addEventListener('hashchange', () => {
  flushSaves();
  if (currentRoute() !== 'ledger' && ui.editingId) endEdit();
  render();
  window.scrollTo(0, 0);
});

await loadAll();
render();
updateOnlineBadge();
