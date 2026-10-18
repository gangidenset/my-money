import {
  n, parseDateKey, addDays, toDateKey, judgeSpend, budgetAlerts, householdHealth, backupReminder, parseMoney, formatMoneyText, yen,
  periodLabel, goalPlan, bonusDueThisMonth, cardBillIn, parseDateKey as parseKey, spendAmount,
} from '../calc.js';
import {
  ds, state, ui, esc, catMap, catLabel, plan, basePlan, payday, allow, freeAlloc, visitsPerWeek, categoryUsage, render,
  pendingSettlement, bonus, logGoal, unlogGoal, currentPeriod, isCardMode, cardSettings, cardStatus,
} from '../core.js';
import { cardBillForm, cardReviewText } from './budget.js';
import { uid } from '../dataService.js';
import { showToast, moneyAttrs, bar, signed } from '../ui.js';
import { helpBtn } from '../guides.js';

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
        <button type="button" class="btn block" data-action="help" data-guide="start">📖 使い方を見る</button>
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
    ${state.meta.guideIntroSeen ? '' : `<section class="guide-intro" role="status">
      <p>📖 <strong>使い方ガイドができました。</strong>各機能の見出しの「?」や、画面右上の「?」を押すと使い方が出ます。</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="help-all">ガイドを見る</button>
        <button type="button" class="btn ghost" data-action="dismiss-guide-intro">閉じる</button>
      </div>
    </section>`}
    ${isCardMode() ? cardHero() : `<section class="hero ${over ? 'is-over' : ''}">
      <p class="hero-label">今月あと ${helpBtn('remaining', 'on-dark')}</p>
      <p class="hero-value">${over ? '0円' : yen(a.monthLeft)}</p>
      <p class="hero-sub">${untilLabel}残り${a.daysLeft}日</p>
    </section>

    <section class="stat-grid">
      <div class="stat"><span class="stat-label">今週あと</span><span class="stat-value">${yen(Math.max(0, a.weekLeft))}</span></div>
      <div class="stat"><span class="stat-label">今日の目安</span><span class="stat-value">${yen(Math.max(0, a.todayLeft))}</span></div>
      <div class="stat"><span class="stat-label">${p.investment > 0 || p.goals > 0 ? '貯蓄・積立' : '貯蓄予定'}</span><span class="stat-value">${yen(p.savings + p.investment + p.goals)}</span></div>
    </section>

    <p class="advice ${over ? 'caution' : ''}">${headline}</p>
    ${alerts.length ? `<ul class="alerts">${alerts.map((x) => `<li class="${x.level}">${esc(x.message)}</li>`).join('')}</ul>` : ''}`}
    ${todoCard()}
    ${cardSettings().enabled ? cardUsageCard() : ''}

    ${isCardMode() ? '' : `<section class="card">
      <h2>この出費、大丈夫？${helpBtn('check')}</h2>
      <span class="money-input">
        <input ${moneyAttrs} id="check-amount" value="${esc(formatMoneyText(ui.checkAmount))}" placeholder="使いたい金額">
        <span class="unit">円</span>
      </span>
      <p class="check-result ${check ? check.level : ''}" id="check-result">${check ? esc(check.message) : '金額を入れると、今週・今月の予算で判定します。'}</p>
    </section>

    ${allocHomeCard(usage)}`}

    <section class="card">
      <h2>今月のお金の流れ${helpBtn('flow')}</h2>
      <dl class="flow">
        <div><dt>収入</dt><dd>${yen(p.income)}</dd></div>
        <div><dt>固定費</dt><dd>−${yen(p.fixed)}</dd></div>
        ${isCardMode() && p.living === 0 ? '' : `<div><dt>生活費予算</dt><dd>−${yen(p.living)}</dd></div>`}
        <div><dt>貯蓄予定</dt><dd>−${yen(p.savings)}</dd></div>
        ${p.investment > 0 ? `<div><dt>積立投資</dt><dd>−${yen(p.investment)}</dd></div>` : ''}
        ${p.goals > 0 ? `<div><dt>目的別の積立</dt><dd>−${yen(p.goals)}</dd></div>` : ''}
        ${p.carry ? `<div><dt>先月からの繰り越し</dt><dd>${p.carry > 0 ? '+' : '−'}${yen(Math.abs(p.carry))}</dd></div>` : ''}
        <div class="total"><dt>自由に使えるお金</dt><dd>${signed(p.free)}</dd></div>
        ${cardSettings().enabled ? cardFlowRows(p, a) : ''}
      </dl>
      ${p.free < 0 ? `<p class="note caution">固定費・生活費・貯蓄${p.goals > 0 ? "・目的別の積立" : ""}の合計が収入を${yen(-p.free)}上回っています。予算タブで見直してみましょう。</p>` : ''}
      ${healthChip()}
    </section>

    ${isCardMode() ? '' : `<section class="card">
      <h2>今月の予算消化${helpBtn('progress')}</h2>
      <div class="meter-row"><div class="meter-head"><span>生活費</span><span>${yen(s.living)} / ${yen(p.living)}</span></div>${bar(s.living, p.living)}</div>
      <div class="meter-row"><div class="meter-head"><span>自由に使えるお金</span><span>${yen(a.monthUsed)} / ${yen(Math.max(0, p.free))}</span></div>${bar(a.monthUsed, Math.max(0, p.free))}</div>
      ${livingRows ? `<details><summary>生活費の内訳</summary>${livingRows}</details>` : ''}
      ${a.dayOfMonth >= 5 && s.total > 0 ? `<p class="note">このペースだと${endWord}までの支出は約${yen(a.projectedSpend)}、${a.projectedLeft >= 0 ? `予算が約${yen(a.projectedLeft)}残る見込みです。` : `予算を約${yen(-a.projectedLeft)}超える見込みです。1日あたり${yen(-a.projectedLeft / a.daysLeft)}抑えると予定内に収まります。`}</p>` : ''}
    </section>`}

    ${isCardMode() ? '' : `<section class="card">
      <div class="card-head"><h2>最近の支出${helpBtn('edit')}</h2><a href="#/ledger">家計簿へ</a></div>
      ${recent.length ? `<ul class="exp-list">${recent.map(expenseRow).join('')}</ul>` : '<p class="muted">まだ支出がありません。</p>'}
    </section>

    <a class="fab" href="#/ledger" aria-label="支出を記録">＋</a>`}`;
}

/* ---------- クレジットカード（利用額・あといくら） ---------- */

const md = (key) => {
  const d = parseKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** カード中心の表示のヒーロー：カードであといくら使えるか */
function cardHero() {
  const c = cardStatus();
  const over = c.remaining < 0;
  let advice;
  if (!c.entered) {
    advice = 'カード会社のアプリやサイトで今月の利用額を見て、下の「カードの利用額」に入れてください。';
  } else if (over) {
    advice = `上限を${yen(-c.remaining)}超えています。次の請求（${md(c.cycle.payKey)}）が多くなるので、締め日まではできるだけカードを使わないようにしましょう。`;
  } else if (c.projectedSpend > c.limit) {
    advice = `このペースだと買い物は約${yen(c.projectedSpend)}で、上限を${yen(c.projectedSpend - c.limit)}超えそうです。1日あたり${yen(c.perDay)}までにすると収まります。`;
  } else {
    advice = `このペースなら買い物は約${yen(c.projectedSpend)}で、上限内に収まる見込みです。`;
  }
  if (c.entered && c.investment > 0) advice += `（利用額のうち積立${yen(c.investment)}は除いて計算しています）`;
  return `<section class="hero ${over ? 'is-over' : ''}">
      <p class="hero-label">カードであと ${helpBtn('card-usage', 'on-dark')}</p>
      <p class="hero-value">${over ? '0円' : yen(c.remaining)}</p>
      <p class="hero-sub">締め日（${md(c.cycle.endKey)}）まで残り${c.daysLeft}日・上限${yen(c.limit)}</p>
    </section>
    <section class="stat-grid">
      <div class="stat"><span class="stat-label">今の利用額</span><span class="stat-value">${c.entered ? yen(c.used) : '—'}</span></div>
      <div class="stat"><span class="stat-label">1日あたり</span><span class="stat-value">${yen(c.perDay)}</span></div>
      <div class="stat"><span class="stat-label">請求見込み</span><span class="stat-value">${c.projected == null ? '—' : yen(c.projected)}</span></div>
    </section>
    <p class="advice ${over || c.projectedSpend > c.limit ? 'caution' : ''}">${advice}</p>`;
}

/** カードの利用額の入力（カード会社のアプリで見た額をときどき入れる） */
function cardUsageCard() {
  const c = cardStatus();
  const latest = c.latest;
  return `<section class="card" id="card-usage-card">
    <h2>💳 カードの利用額${helpBtn('card-usage')}</h2>
    <p class="note lead">${md(c.cycle.startKey)}〜${md(c.cycle.endKey)}の利用分（${md(c.cycle.payKey)}に引き落とし）</p>
    ${isCardMode() ? '' : `<div class="meter-row">
      <div class="meter-head"><span>上限 ${yen(c.limit)}</span><span>${c.entered ? `あと${yen(Math.max(0, c.remaining))}` : '未入力'}</span></div>
      ${bar(c.used, c.limit)}
    </div>`}
    <div class="card-bill-row">
      <span class="money-input">
        <input ${moneyAttrs} data-card-usage placeholder="${latest ? Math.round(latest.amount).toLocaleString('ja-JP') : '今の利用額'}" aria-label="今のカードの利用額">
        <span class="unit">円</span>
      </span>
      <button type="button" class="btn primary" data-action="card-save-usage">更新</button>
    </div>
    <p class="note">${latest ? `最後に入れた日：${md(latest.date)}（${yen(latest.amount)}）` : 'カード会社のアプリやサイトの「ご利用金額（今月の利用額）」を入れてください。'}</p>
  </section>`;
}

/** お金の流れの下に、今月のカード代と、払ったあとに残るお金 */
function cardFlowRows(p, a) {
  const bill = cardBillIn(state.expenses, currentPeriod());
  if (!bill) return '';
  const inv = n(bill.investPart);
  return `<div><dt>カード代（${md(bill.date)}引き落とし）${inv > 0 ? `<small>請求${yen(bill.amount)}のうち積立${yen(inv)}は上の積立投資で計算済み</small>` : ''}</dt><dd>−${yen(spendAmount(bill))}</dd></div>
    <div class="total"><dt>カード代を払ったあとに残るお金</dt><dd>${signed(a.monthLeft)}</dd></div>
    ${cardReviewText(bill) ? `<div class="review-row">${cardReviewText(bill)}</div>` : ''}`;
}

export function allocHomeCard(usage) {
  const rows = freeAlloc().items.filter((i) => catMap()[i.category]);
  if (!rows.length) {
    return `<section class="card">
      <h2>使い道ごとの予算${helpBtn('alloc-home')}</h2>
      <p class="muted">自由に使えるお金を外食・趣味などに配分すると、「外食は週いくらまで？」が分かります。</p>
      <a class="btn block" href="#/budget">配分を決める</a>
    </section>`;
  }
  return `<section class="card">
    <div class="card-head"><h2>使い道ごとの予算${helpBtn('alloc-home')}</h2><a href="#/budget">配分を変更</a></div>
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
      <span class="exp-main">${esc(e.shop) || '<span class="muted">（店名なし）</span>'}${e.memo || n(e.investPart) > 0 ? `<small>${esc(e.memo)}${n(e.investPart) > 0 ? `（うち積立${yen(e.investPart)}）` : ''}</small>` : ''}</span>
      <span class="exp-amount">${yen(e.amount)}<small>${d.getMonth() + 1}/${d.getDate()}</small></span>
    </button>
    <button class="icon-btn" data-action="delete-expense" data-id="${esc(e.id)}" aria-label="${yen(e.amount)}の支出を削除">✕</button>
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
  const items = [settlementItem(), cardItem(), bonusItem(), goalsItem(), backupBanner()].filter(Boolean);
  if (!items.length) return '';
  return `<section class="card todo-card" aria-label="今月のやること">
    <h2>📌 今月のやること${helpBtn('todo')}</h2>
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
      <p>先月（${label}）は、予定より<strong>${yen(-s.leftover)}</strong>多く使いました。どうしますか？${helpBtn('settle')}</p>
      <div class="settle-actions">
        <button class="btn" data-action="settle" data-kind="cover">貯金から補てんした</button>
        <button class="btn" data-action="settle" data-kind="carry">今月の予算から差し引く</button>
        <button class="btn ghost" data-action="settle" data-kind="none">記録しない</button>
      </div>
    </div>`;
  }
  const goals = state.goals.filter((g) => n(g.targetAmount) > 0 && goalPlan(g, new Date(), bonus()).status !== 'done');
  return `<div class="todo-item settle">
    <p>先月（${label}）は、自由に使えるお金が<strong>${yen(s.leftover)}</strong>余りました。どうしますか？${helpBtn('settle')}</p>
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

/** クレジットカードの今月の請求額（まだ入れていないとき） */
function cardItem() {
  if (!state.profile.card?.enabled || cardBillIn(state.expenses, currentPeriod())) return '';
  return `<div class="todo-item">
    <p>💳 今月のクレジットカードの請求額を入れてください。</p>
    ${cardBillForm()}
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
  'card-save-usage': async (btn, ev) => {
    const input = btn.closest('#card-usage-card')?.querySelector('[data-card-usage]');
    if (!input || input.value.trim() === '') {
      showToast('今の利用額を入れてください');
      input?.focus();
      return;
    }
    const amount = parseMoney(input.value);
    const today = toDateKey(new Date());
    const before = state.cardUsage;
    // 同じ日に入れ直したら上書きする（記録は直近200件まで）
    state.cardUsage = [...state.cardUsage.filter((u) => u.date !== today), { id: uid(), date: today, amount }].slice(-200);
    await ds.saveCardUsage(state.cardUsage);
    render();
    const c = cardStatus();
    showToast(`利用額${yen(amount)}を記録。カードであと${yen(Math.max(0, c.remaining))}`, {
      label: '取り消す',
      run: async () => { state.cardUsage = before; await ds.saveCardUsage(state.cardUsage); render(); showToast('取り消しました'); },
    });
  },
  'dismiss-guide-intro': async (btn, ev) => {
    state.meta.guideIntroSeen = true;
    await ds.saveMeta(state.meta);
    render();
  },
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
