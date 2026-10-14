import {
  n, parseDateKey, addDays, toDateKey, judgeSpend, budgetAlerts, householdHealth, backupReminder, parseMoney, formatMoneyText, yen,
  periodLabel, goalPlan, bonusDueThisMonth,
} from '../calc.js';
import {
  ds, state, ui, esc, catMap, catLabel, plan, basePlan, payday, allow, freeAlloc, visitsPerWeek, categoryUsage, render,
  pendingSettlement, bonus, logGoal, unlogGoal,
} from '../core.js';
import { showToast, moneyAttrs, bar, signed } from '../ui.js';

/* ---------- ホーム ---------- */

export function homeView() {
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
    ${todoCard()}

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
        ${p.carry ? `<div><dt>先月からの繰り越し</dt><dd>${p.carry > 0 ? '+' : '−'}${yen(Math.abs(p.carry))}</dd></div>` : ''}
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

export function allocHomeCard(usage) {
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

export function healthChip() {
  const h = householdHealth(basePlan());
  if (!h) return '';
  return `<a class="health-chip ${h.level}" href="#/sim">
    <span>${h.emoji} 家計の状態：<strong>${h.label}</strong></span>
    <span class="muted">貯蓄率${Math.round(h.savingsRate)}% ›</span>
  </a>`;
}

export function expenseRow(e) {
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

export function backupBanner() {
  const r = backupReminder(state.meta, new Date(), { hasData: state.expenses.length > 0 });
  if (!r) return '';
  return `<div class="todo-item backup-banner" role="status">
    <p>💾 ${r.never ? 'まだバックアップがありません。' : `最後のバックアップから${r.days}日たちました。`}スマホの故障や機種変更に備えて保存しておきましょう。</p>
    <div class="btn-row">
      <button class="btn primary" data-action="export">今すぐ保存</button>
      <button class="btn" data-action="snooze-backup">あとで</button>
    </div>
  </div>`;
}

/* ---------- 今月のやること（先月の締め・ボーナス・目的別の積立・バックアップ） ---------- */

export function todoCard() {
  const items = [settlementItem(), bonusItem(), goalsItem(), backupBanner()].filter(Boolean);
  if (!items.length) return '';
  return `<section class="card todo-card" aria-label="今月のやること">
    <h2>📌 今月のやること</h2>
    ${items.join('')}
  </section>`;
}

/** 先月の余ったお金（足りなかったお金）をどうするか */
function settlementItem() {
  const s = pendingSettlement();
  if (!s) return '';
  const label = periodLabel(s.period);
  if (s.leftover < 0) {
    return `<div class="todo-item settle">
      <p>先月（${label}）は、予定より<strong>${yen(-s.leftover)}</strong>多く使いました。どうしますか？</p>
      <div class="settle-actions">
        <button class="btn" data-action="settle" data-kind="cover">貯金から補てんした</button>
        <button class="btn" data-action="settle" data-kind="carry">今月の予算から差し引く</button>
        <button class="btn ghost" data-action="settle" data-kind="none">記録しない</button>
      </div>
    </div>`;
  }
  const goals = state.goals.filter((g) => n(g.targetAmount) > 0 && goalPlan(g, new Date(), bonus()).status !== 'done');
  return `<div class="todo-item settle">
    <p>先月（${label}）は、自由に使えるお金が<strong>${yen(s.leftover)}</strong>余りました。どうしますか？</p>
    <div class="settle-actions">
      <button class="btn" data-action="settle" data-kind="savings">貯金に回す</button>
      <button class="btn" data-action="settle" data-kind="carry">今月に繰り越す</button>
      ${goals.length ? `<div class="settle-goal">
        <select id="settle-goal" aria-label="入れる目的">${goals.map((g) => `<option value="${esc(g.id)}">${g.icon} ${esc(g.name)}</option>`).join('')}</select>
        <button class="btn" data-action="settle" data-kind="goal">目的別へ入れる</button>
      </div>` : ''}
      <button class="btn ghost" data-action="settle" data-kind="none">記録しない</button>
    </div>
  </div>`;
}

function bonusItem() {
  if (!bonusDueThisMonth(bonus())) return '';
  return `<div class="todo-item">
    <p>🎁 今月はボーナス月です。受け取ったら記録すると、予算タブで決めた使い道（貯金・目的別）に割り振ります。</p>
    <button class="btn primary block" data-action="receive-bonus">受け取った（割り振りを記録）</button>
  </div>`;
}

/** 今月まだ積み立てていない目的別の貯金 */
function goalsItem() {
  const b = bonus();
  const due = state.goals
    .map((g) => ({ g, gp: goalPlan(g, new Date(), b) }))
    .filter(({ gp }) => gp.status === 'active' && gp.monthly > 0 && !gp.contributed);
  if (!due.length) return '';
  return `<div class="todo-item">
    <p>🎯 目的別の積立（今月分）</p>
    <ul class="todo-goals">
      ${due.map(({ g, gp }) => `<li>
        <span>${g.icon} ${esc(g.name)} <strong>${yen(gp.monthly)}</strong></span>
        <button class="btn small" data-action="contribute-goal" data-id="${esc(g.id)}">積み立てた</button>
      </li>`).join('')}
    </ul>
  </div>`;
}


/* ---------- ボタン操作（data-action） ---------- */

export const homeActions = {
  /** 先月の締め：savings / cover（貯金を増減）・goal（目的別へ）・carry（今月へ繰り越し）・none */
  'settle': async (btn, ev) => {
    const s = pendingSettlement();
    if (!s) return;
    const kind = btn.dataset.kind;
    const amount = s.leftover;
    const before = { savings: state.profile.currentSavings, settlements: state.settlements };
    let goal = null;
    let goalSavedBefore = 0;
    let logId = null;
    let message;
    if (kind === 'savings' || kind === 'cover') {
      state.profile.currentSavings = Math.max(0, n(state.profile.currentSavings) + amount);
      message = amount > 0 ? `${yen(amount)}を貯金に回しました` : `貯金から${yen(-amount)}補てんしました`;
    } else if (kind === 'goal') {
      goal = state.goals.find((g) => g.id === document.getElementById('settle-goal')?.value);
      if (!goal) return;
      goalSavedBefore = goal.saved;
      goal.saved = n(goal.saved) + amount;
      // 目的別の残高は現在の貯金額の内訳なので、貯金額も同じだけ増やす
      state.profile.currentSavings = n(state.profile.currentSavings) + amount;
      logId = await logGoal({ goalId: goal.id, date: toDateKey(new Date()), amount, source: 'leftover' });
      message = `${goal.name}に${yen(amount)}入れました`;
    } else if (kind === 'carry') {
      message = amount > 0 ? `${yen(amount)}を今月に繰り越しました` : `今月の予算から${yen(-amount)}差し引きます`;
    } else {
      message = '先月の分は記録せずに閉じました';
    }
    state.settlements = { ...state.settlements, [s.period.startKey]: { action: kind, amount, goalId: goal?.id ?? null, at: new Date().toISOString() } };
    await Promise.all([ds.saveProfile(state.profile), ds.saveGoals(state.goals), ds.saveSettlements(state.settlements)]);
    render();
    showToast(message, {
      label: '取り消す',
      run: async () => {
        state.profile.currentSavings = before.savings;
        state.settlements = before.settlements;
        if (goal) {
          goal.saved = goalSavedBefore;
          await unlogGoal(logId);
        }
        await Promise.all([ds.saveProfile(state.profile), ds.saveGoals(state.goals), ds.saveSettlements(state.settlements)]);
        render();
        showToast('取り消しました');
      },
    });
  },
  'snooze-backup': async (btn, ev) => {
    state.meta.snoozedUntil = addDays(new Date(), 7).toISOString();
    await ds.saveMeta(state.meta);
    render();
    showToast('7日後にもう一度お知らせします');
  },
};
