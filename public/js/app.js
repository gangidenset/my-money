import { createDefaultStorage } from './storage.js';
import { createDataService, BUDGET_LABELS, EXTRA_FIXED_COSTS, uid } from './dataService.js';
import {
  n, yen, sum, monthlyPlan, allowance, judgeSpend, futureSavings, futureInvestment, nisaCheck,
  summarizeSpending, toDateKey, parseDateKey,
  ALLOC_CHOICES, allocate, weekStartKey, historyAverages, suggestBudget, budgetAlerts,
  requiredMonthly, monthsToReach, formatMonths, incomeGrowth, householdHealth, fixedCostTips, savingEffect,
  MAX_PAYDAY, addDays, budgetPeriod, inPeriod, periodLabel, frequentEntries, backupReminder,
} from './calc.js';

const { adapter, persistent } = createDefaultStorage();
const ds = createDataService(adapter);

const state = {
  profile: null, fixedCosts: [], budgets: [], simulation: null, goal: null, allocations: null, categories: [], expenses: [], meta: {},
};
const ui = {
  entryCategory: 'food',
  ledgerOffset: 0, // 家計簿で表示中の期間（0 = 今の期間、-1 = 前の期間）
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
  [state.profile, state.fixedCosts, state.budgets, state.simulation, state.goal, state.allocations, state.categories, state.expenses, state.meta] =
    await Promise.all([ds.getProfile(), ds.listFixedCosts(), ds.listBudgets(), ds.getSimulation(), ds.getGoal(), ds.getAllocations(), ds.listCategories(), ds.listExpenses(), ds.getMeta()]);
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

const numberInput = (bind, value, label, { hint, unit = '円', step = 1, max } = {}) => `
  <label class="field">
    <span class="field-label">${label}${hint ? `<small>${hint}</small>` : ''}</span>
    <span class="money-input">
      <input type="number" inputmode="${step < 1 ? 'decimal' : 'numeric'}" min="0" step="${step}"${max ? ` max="${max}"` : ''} data-bind="${bind}" value="${n(value) || ''}" placeholder="0">
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

  const check = judgeSpend(ui.checkAmount, a);

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
      <div class="stat"><span class="stat-label">${p.investment > 0 ? '貯蓄・積立' : '貯蓄予定'}</span><span class="stat-value">${yen(p.savings + p.investment)}</span></div>
    </section>

    <p class="advice ${over ? 'caution' : ''}">${headline}</p>
    ${alerts.length ? `<ul class="alerts">${alerts.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join('')}</ul>` : ''}
    ${backupBanner()}

    <section class="card">
      <h2>この出費、大丈夫？</h2>
      <span class="money-input">
        <input type="number" inputmode="numeric" min="0" id="check-amount" value="${esc(ui.checkAmount)}" placeholder="使いたい金額">
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
        <div class="total"><dt>自由に使えるお金</dt><dd>${signed(p.free)}</dd></div>
      </dl>
      ${p.free < 0 ? `<p class="note caution">固定費・生活費・貯蓄予定の合計が収入を${yen(-p.free)}上回っています。予算タブで見直してみましょう。</p>` : ''}
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

  return `
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
        <input type="number" inputmode="numeric" min="1" id="entry-amount" placeholder="0" autocomplete="off" value="${editing ? n(editing.amount) : ''}">
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
      <div class="sum-row total"><span>自由に使えるお金</span><strong>${signed(p.free)}</strong></div>
    </section>`;
}

function suggestCard() {
  const p = plan();
  if (n(state.profile.takeHome) <= 0) return '';
  const hist = history();
  const sg = suggestBudget(p.income, { investment: p.investment, history: hist });
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
          <div><dt>貯蓄 <small class="tag muted">目安</small></dt><dd>${yen(sg.savings)}${p.investment > 0 ? '<small>積立投資の分を差し引き済み</small>' : ''}</dd></div>
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
      ${moneyInput('simulation.monthlySavings', state.simulation.monthlySavings, '毎月の貯蓄目標')}
      ${moneyInput('profile.currentSavings', pr.currentSavings, '現在の貯金額')}
    </section>

    <section class="card">
      <h2>積立投資（NISAなど）</h2>
      ${moneyInput('simulation.monthlyInvestment', state.simulation.monthlyInvestment, '毎月の積立額')}
      ${moneyInput('profile.currentInvestment', pr.currentInvestment, '現在の投資残高')}
      <p class="note">利回りや将来の見込みは「将来」タブで確認できます。</p>
    </section>`;
}

/* ---------- シミュレーション ---------- */

const SIM_YEARS = [1, 3, 5, 10, 20];
const investYears = () => Math.min(50, Math.max(1, Math.round(n(state.simulation.investYears)) || 20));

function projection(years) {
  const pr = state.profile;
  const sim = state.simulation;
  const savings = futureSavings(pr.currentSavings, sim.monthlySavings, years);
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
  const total = Math.max(p.income, p.fixed + p.living + p.savings + p.investment + pos);
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
      <span><i class="dot save"></i>貯蓄・積立 ${pct(p.savings + p.investment)}</span>
      <span><i class="dot gain"></i>自由 ${pct(pos)}</span>
    </p>
    <div class="split-bar income-bar" role="img" aria-label="手取りの内訳">
      ${seg(p.fixed, 'fixed')}${seg(p.living, 'living')}${seg(p.savings + p.investment, 'save')}${seg(pos, 'gain')}
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

  const current = n(pr.currentSavings) + n(pr.currentInvestment);
  const rate = n(sim.annualReturn);
  const need = requiredMonthly(target, current, years);
  const needInvested = rate > 0 ? requiredMonthly(target, current, years, rate) : null;
  const monthlyNow = n(sim.monthlySavings) + n(sim.monthlyInvestment);
  const proj = futureSavings(pr.currentSavings, sim.monthlySavings, years)
    + futureInvestment(pr.currentInvestment, sim.monthlyInvestment, rate, years).value;
  const reachAt = monthsToReach(target, { ...pr, ...sim });
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
            <input type="number" inputmode="numeric" min="0" data-bind="simulation.savingPlan.${esc(i.key)}" value="${i.after ?? ''}" placeholder="${i.current}" aria-label="${esc(i.name)}の見直し後の金額">
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

const APP_VERSION = '1.1.0';
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
  const partials = { 'health-card': healthCard, 'goal-result': goalResult, 'raise-result': raiseResult, 'saving-result': savingResult };
  for (const [id, fn] of Object.entries(partials)) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = fn();
  }
}

const persisters = {
  profile: () => ds.saveProfile(state.profile),
  fixedCosts: () => ds.saveFixedCosts(state.fixedCosts),
  budgets: () => ds.saveBudgets(state.budgets),
  simulation: () => ds.saveSimulation(state.simulation),
  allocations: () => ds.saveAllocations(state.allocations),
  goal: () => ds.saveGoal(state.goal),
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
  setByPath(t.dataset.bind, t.value, t.type === 'number' || 'num' in t.dataset);
  schedulePersist(t.dataset.bind.split('.')[0]);
  refreshLive();
}

$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.bind) {
    onBoundInput(t);
  } else if (t.id === 'check-amount') {
    ui.checkAmount = t.value;
    const res = judgeSpend(t.value, allow());
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
  const amount = Math.round(n(amountEl.value));
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
      const sg = suggestBudget(p.income, { investment: p.investment, history: history() });
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
