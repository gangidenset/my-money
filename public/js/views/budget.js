import { BUDGET_LABELS, EXTRA_FIXED_COSTS, uid } from '../dataService.js';
import {
  n, toDateKey, MAX_PAYDAY, ALLOC_CHOICES, suggestBudget, goalPlan, earmarkedSavings, bonusAllocation, bonusDueThisMonth, yen,
} from '../calc.js';
import { ds, state, esc, catMap, plan, payday, history, freeAlloc, visitsPerWeek, render, flushSaves, bonus, logGoal, unlogGoal } from '../core.js';
import { showToast, moneyInput, signed } from '../ui.js';
import { helpBtn } from '../guides.js';

/* ---------- 予算（収入・固定費・生活費・貯蓄） ---------- */

export function summaryCard() {
  const p = plan();
  return `
    <section class="card sticky-summary" id="live-summary">
      <div class="sum-row"><span>収入</span><strong>${yen(p.income)}</strong></div>
      <div class="sum-row"><span>固定費</span><strong>−${yen(p.fixed)}</strong></div>
      <div class="sum-row"><span>生活費</span><strong>−${yen(p.living)}</strong></div>
      <div class="sum-row"><span>貯蓄</span><strong>−${yen(p.savings)}</strong></div>
      <div class="sum-row"><span>積立投資</span><strong>−${yen(p.investment)}</strong></div>
      ${p.goals > 0 ? `<div class="sum-row"><span>目的別</span><strong>−${yen(p.goals)}</strong></div>` : ''}
      ${p.carry ? `<div class="sum-row"><span>繰り越し</span><strong>${p.carry > 0 ? '+' : '−'}${yen(Math.abs(p.carry))}</strong></div>` : ''}
      <div class="sum-row total"><span>自由に使えるお金</span><strong>${signed(p.free)}</strong></div>
    </section>`;
}

export function suggestCard() {
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
        <p class="note">${helpBtn('suggest', 'small')}一般的な配分をもとにした初期目安です。正解ではないので、暮らしに合わせて調整してください。${hist ? '記録がある項目は、あなたの実績を優先しています。' : '家計簿の記録が貯まると、あなたの実績平均を優先して提案します。'}</p>
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

export function allocCard() {
  const p = plan();
  const { items, totalPercent, unallocated } = freeAlloc();
  const byCat = Object.fromEntries(items.map((i) => [i.category, i]));
  const cats = state.categories.filter((c) => c.group === 'free');
  const visits = visitsPerWeek();

  if (p.free <= 0) {
    return `<section class="card" id="alloc-card">
      <h2>自由に使えるお金の使い道${helpBtn('alloc')}</h2>
      <p class="muted">自由に使えるお金がまだないため配分できません。収入・固定費・貯蓄目標を入力すると設定できます。</p>
    </section>`;
  }
  return `<section class="card" id="alloc-card">
    <h2>自由に使えるお金の使い道${helpBtn('alloc')}</h2>
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

export function budgetView() {
  const pr = state.profile;
  const usedExtras = new Set(state.fixedCosts.map((c) => c.name));
  const hist = history();
  const histHint = (id) => (hist?.byCategory[id] != null ? `過去${hist.months}か月平均 ${yen(hist.byCategory[id])}` : '');
  return `
    ${summaryCard()}
    <div id="suggest-slot">${suggestCard()}</div>

    <section class="card">
      <h2>収入${helpBtn('income')}</h2>
      ${moneyInput('profile.takeHome', pr.takeHome, '手取り月収', { hint: '計算の基準になります' })}
      ${moneyInput('profile.sideIncome', pr.sideIncome, '副業収入（月）')}
      ${moneyInput('profile.otherIncome', pr.otherIncome, 'その他収入（月）')}
      ${moneyInput('profile.bonus', pr.bonus, 'ボーナス（年間・手取り）')}
      <div class="segmented" role="radiogroup" aria-label="ボーナスの扱い">
        <button type="button" data-action="bonus-mode" data-mode="separate" class="${pr.bonusMode !== 'monthly' ? 'selected' : ''}">別管理</button>
        <button type="button" data-action="bonus-mode" data-mode="monthly" class="${pr.bonusMode === 'monthly' ? 'selected' : ''}">毎月に換算</button>
      </div>
      <p class="note">毎月に換算すると、ボーナスの1/12を毎月の収入に加えます。別管理なら、下の「ボーナスの使い道」で貯金や目的別の貯金に割り振れます。</p>

      <label class="field payday-field">
        <span class="field-label">給料日${helpBtn('payday', 'small')}<small>この日から次の給料日の前日までを「1か月」として計算します</small></span>
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
      <div class="card-head"><h2>固定費${helpBtn('fixed')}</h2><span class="muted">合計 <strong data-live="fixed">${yen(plan().fixed)}</strong></span></div>
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
      <div class="card-head"><h2>生活費予算${helpBtn('living')}</h2><span class="muted">合計 <strong data-live="living">${yen(plan().living)}</strong></span></div>
      ${state.budgets.map((b, i) => moneyInput(`budgets.${i}.monthlyLimit`, b.monthlyLimit, BUDGET_LABELS[b.category] || catMap()[b.category]?.name || b.category, { hint: histHint(b.category) })).join('')}
      <p class="note">外食・趣味・衣服などは下の「自由に使えるお金の使い道」で配分します。</p>
    </section>

    ${allocCard()}

    <section class="card">
      <h2>貯蓄${helpBtn('savings')}</h2>
      ${moneyInput('simulation.monthlySavings', state.simulation.monthlySavings, '毎月の貯蓄目標', { hint: '目的別の貯金とは別枠' })}
      ${moneyInput('profile.currentSavings', pr.currentSavings, '現在の貯金額', { hint: '目的別に貯めている分も含めた合計' })}
    </section>

    ${goalsCard()}
    <div id="bonus-slot">${bonusCard()}</div>

    <section class="card">
      <h2>積立投資（NISAなど）${helpBtn('invest')}</h2>
      ${moneyInput('simulation.monthlyInvestment', state.simulation.monthlyInvestment, '毎月の積立額')}
      ${moneyInput('profile.currentInvestment', pr.currentInvestment, '現在の投資残高')}
      <p class="note">利回りや将来の見込みは「将来」タブで確認できます。</p>
    </section>`;
}

/* ---------- 目的別の貯金（車・引っ越し・家具など） ---------- */

export const GOAL_PRESETS = [
  { icon: '🚗', name: '車' },
  { icon: '📦', name: '引っ越し' },
  { icon: '🛋️', name: '家具・家電' },
  { icon: '✈️', name: '旅行' },
  { icon: '🎯', name: 'その他' },
];

export function goalsCard() {
  return `<section class="card" id="goals-card">
    <h2>🎯 目的別の貯金${helpBtn('goals')}</h2>
    <p class="note lead">車・引っ越し・家具など、使う時期が決まっているお金を目的ごとに貯めます。運用益は考えず、<strong>購入予定月の前月まで</strong>に貯め切るための毎月の金額を逆算します。</p>
    ${state.goals.map(goalRow).join('')}
    <div class="chips">${GOAL_PRESETS.map((x) => `<button class="chip" data-action="add-goal" data-name="${esc(x.name)}" data-icon="${x.icon}">＋ ${x.icon} ${esc(x.name)}</button>`).join('')}</div>
    <div id="goals-foot">${goalsFoot()}</div>
  </section>`;
}

export function goalRow(g, i) {
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
      <div class="bonus-only" ${bonus().active ? '' : 'hidden'}>${moneyInput(`goals.${i}.bonusPerPayout`, g.bonusPerPayout, 'ボーナスから入れる額', { hint: '1回あたり' })}</div>
      <div class="btn-row">
        <button class="btn" data-action="purchase-goal" data-id="${esc(g.id)}">購入済みにする</button>
        <button class="btn danger" data-action="delete-goal" data-id="${esc(g.id)}">削除</button>
      </div>
    </details>
  </div>`;
}

/** 名前・進み具合・毎月の積立額（入力中も部分更新する） */
export function goalResultHtml(g) {
  const gp = goalPlan(g, new Date(), bonus());
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
  } else if (gp.status === 'active' && gp.monthly === 0) {
    body = `<p class="goal-msg ok">🎁 ボーナスから入れる分（${gp.bonusPayouts}回で${yen(gp.bonusCover)}）で達成できる見込みです。毎月の積立は不要です。</p>`;
  } else if (gp.status === 'active') {
    body = `<p class="goal-monthly">毎月 <strong>${yen(gp.monthly)}</strong> <span class="muted">（${last.getFullYear() !== new Date().getFullYear() ? `${last.getFullYear()}年` : ''}${last.getMonth() + 1}月までの${gp.slots}回）</span></p>
      ${gp.bonusCover > 0 ? `<p class="goal-sub">うちボーナスから ${yen(gp.bonusCover)}（${gp.bonusPayouts}回）を入れる前提です。</p>` : ''}
      ${gp.contributed
        ? `<p class="goal-msg ok">✅ 今月分（${yen(gp.thisMonthAmount)}）は積み立て済みです。</p>`
        : `<button class="btn primary block" data-action="contribute-goal" data-id="${esc(g.id)}">今月分を積み立てた（+${yen(gp.monthly)}）</button>`}`;
  } else {
    body = `<p class="goal-msg caution">${gp.status === 'overdue' ? '購入予定月を過ぎています。' : '購入予定月までに積み立てられる回数が残っていません。'}あと${yen(gp.remaining)}足りません。購入予定を後ろにずらすか、目標金額を見直してください。</p>`;
  }
  return head + progress + body;
}

export function goalsFoot() {
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

/* ---------- ボーナスの使い道（別管理のとき） ---------- */

export function bonusCard() {
  const b = bonus();
  // 支給月をすべて外しても選び直せるよう、別管理で金額があればカードは出す
  if (state.profile.bonusMode === 'monthly' || !(n(state.profile.bonus) > 0)) return '';
  return `<section class="card" id="bonus-card">
    <h2>🎁 ボーナスの使い道${helpBtn('bonus')}</h2>
    <div class="field">
      <span class="field-label">支給月</span>
      <div class="month-chips" role="group" aria-label="ボーナスの支給月">
        ${Array.from({ length: 12 }, (_, k) => k + 1).map((m) => `<button type="button" class="chip-toggle ${b.months.includes(m) ? 'selected' : ''}" data-action="bonus-month" data-m="${m}" aria-pressed="${b.months.includes(m)}">${m}月</button>`).join('')}
      </div>
    </div>
    ${moneyInput('profile.bonusPlan.savings', b.toSavings, '貯金に回す', { hint: '1回あたり' })}
    <div id="bonus-breakdown">${bonusBreakdown()}</div>
  </section>`;
}

/** 1回分の割り振りと残り（入力中も部分更新する） */
export function bonusBreakdown() {
  const b = bonus();
  if (!b.active || !b.months.length) return '<p class="note caution">支給月を選んでください。</p>';
  const a = bonusAllocation(b, state.goals);
  const goalsWithBonus = state.goals.filter((g) => n(g.bonusPerPayout) > 0);
  const due = bonusDueThisMonth(b);
  return `
    <p class="note">${b.months.map((m) => `${m}月`).join('・')}に、1回あたり<strong>${yen(a.perPayout)}</strong>（年間${yen(state.profile.bonus)}）の予定です。</p>
    <dl class="flow compact-2">
      ${goalsWithBonus.map((g) => `<div><dt>${g.icon} ${esc(g.name)}へ</dt><dd>${yen(g.bonusPerPayout)}</dd></div>`).join('')}
      <div><dt>貯金へ</dt><dd>${yen(a.toSavings)}</dd></div>
      <div class="total"><dt>自由に使える残り</dt><dd>${signed(a.rest)}</dd></div>
    </dl>
    ${a.rest < 0 ? `<p class="note caution">割り振りの合計が、ボーナス1回分を${yen(-a.rest)}超えています。</p>` : ''}
    <p class="note">目的別の貯金へ入れる額は、各目的の「設定を変更」で決めます。入れる予定の分だけ、毎月の積立額が少なくなります。</p>
    ${due ? `<button class="btn primary block" data-action="receive-bonus">今月のボーナスを受け取った（割り振りを記録）</button>` : ''}`;
}

export async function saveGoalsAndRender(message, undo) {
  await ds.saveGoals(state.goals);
  render();
  if (message) showToast(message, undo);
}


/* ---------- ボタン操作（data-action） ---------- */

export const budgetActions = {
  'bonus-month': async (btn, ev) => {
    flushSaves();
    const m = Number(btn.dataset.m);
    const months = bonus().months;
    state.profile.bonusMonths = months.includes(m) ? months.filter((x) => x !== m) : [...months, m].sort((a, b) => a - b);
    await ds.saveProfile(state.profile);
    render();
  },
  'receive-bonus': async (btn, ev) => {
    flushSaves();
    const b = bonus();
    if (!bonusDueThisMonth(b)) return;
    const today = toDateKey(new Date());
    const before = { savings: state.profile.currentSavings, received: [...b.received], saved: state.goals.map((g) => [g, g.saved]) };
    const logIds = [];
    let toGoals = 0;
    for (const g of state.goals) {
      const gp = goalPlan(g, new Date(), b);
      const add = Math.min(n(g.bonusPerPayout), gp.remaining);
      if (add <= 0) continue;
      g.saved = n(g.saved) + add;
      toGoals += add;
      logIds.push(await logGoal({ goalId: g.id, date: today, amount: add, source: 'bonus' }));
    }
    // 現在の貯金額は目的別の残高も含めた合計なので、両方を足す
    state.profile.currentSavings = n(state.profile.currentSavings) + b.toSavings + toGoals;
    state.profile.bonusReceived = [...b.received, today.slice(0, 7)].slice(-24);
    await ds.saveProfile(state.profile);
    await saveGoalsAndRender(`ボーナスを記録しました（貯金へ${yen(b.toSavings)}・目的別へ${yen(toGoals)}）`, {
      label: '取り消す',
      run: async () => {
        state.profile.currentSavings = before.savings;
        state.profile.bonusReceived = before.received;
        for (const [g, saved] of before.saved) g.saved = saved;
        await unlogGoal(logIds);
        await ds.saveProfile(state.profile);
        await saveGoalsAndRender('取り消しました');
      },
    });
  },
  'bonus-mode': async (btn, ev) => {
    state.profile.bonusMode = btn.dataset.mode;
    await ds.saveProfile(state.profile);
    render();
  },
  'add-fixed': async (btn, ev) => {
    flushSaves();
    state.fixedCosts.push({ id: uid(), category: btn.dataset.category, name: btn.dataset.name || '新しい項目', amount: 0, billingDay: null });
    await ds.saveFixedCosts(state.fixedCosts);
    render();
    document.querySelector(`[data-bind="fixedCosts.${state.fixedCosts.length - 1}.amount"]`)?.focus();
  },
  'remove-fixed': async (btn, ev) => {
    flushSaves();
    const i = Number(btn.dataset.index);
    const c = state.fixedCosts[i];
    if (n(c.amount) > 0 && !confirm(`${c.name}（${yen(c.amount)}）を削除しますか？`)) return;
    state.fixedCosts.splice(i, 1);
    await ds.saveFixedCosts(state.fixedCosts);
    render();
  },
  'alloc': async (btn, ev) => {
    state.allocations.percents[btn.dataset.id] = Number(btn.dataset.pct);
    await ds.saveAllocations(state.allocations);
    document.getElementById('alloc-card').outerHTML = allocCard();
  },
  'apply-suggest': async (btn, ev) => {
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
  },
  'add-goal': async (btn, ev) => {
    flushSaves();
    const now = new Date();
    state.goals.push({
      id: uid(), name: btn.dataset.name, icon: btn.dataset.icon, targetAmount: 0,
      targetYear: now.getFullYear() + 1, targetMonth: now.getMonth() + 1, // 初期値は1年後
      saved: 0, lastContributionMonth: null, lastContributionAmount: 0, bonusPerPayout: 0,
    });
    await saveGoalsAndRender();
    document.querySelector(`[data-bind="goals.${state.goals.length - 1}.targetAmount"]`)?.focus();
  },
  'contribute-goal': async (btn, ev) => {
    flushSaves();
    const g = state.goals.find((x) => x.id === btn.dataset.id);
    const gp = g && goalPlan(g, new Date(), bonus());
    if (!gp || gp.status !== 'active') return;
    if (gp.monthly <= 0) return;
    const before = { saved: g.saved, lastContributionMonth: g.lastContributionMonth, lastContributionAmount: g.lastContributionAmount };
    const today = toDateKey(new Date());
    Object.assign(g, { saved: n(g.saved) + gp.monthly, lastContributionMonth: today.slice(0, 7), lastContributionAmount: gp.monthly });
    const logId = await logGoal({ goalId: g.id, date: today, amount: gp.monthly, source: 'monthly' });
    await saveGoalsAndRender(`${g.name}に${yen(gp.monthly)}積み立てました`, {
      label: '取り消す',
      run: async () => {
        Object.assign(g, before);
        await unlogGoal(logId);
        await saveGoalsAndRender('取り消しました');
      },
    });
  },
  'purchase-goal': async (btn, ev) => {
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
  },
  'delete-goal': async (btn, ev) => {
    flushSaves();
    const i = state.goals.findIndex((x) => x.id === btn.dataset.id);
    if (i < 0) return;
    const [g] = state.goals.splice(i, 1);
    await saveGoalsAndRender(`「${g.name}」を削除しました（貯金額はそのままです）`, {
      label: '元に戻す',
      run: async () => { state.goals.splice(i, 0, g); await saveGoalsAndRender('元に戻しました'); },
    });
  },
};
