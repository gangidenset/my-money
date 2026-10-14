import { BUDGET_LABELS } from '../dataService.js';
import {
  n, futureSavings, futureInvestment, nisaCheck, requiredMonthly, monthsToReach, formatMonths, incomeGrowth, householdHealth, fixedCostTips, savingEffect, earmarkedSavings, yen,
} from '../calc.js';
import { ds, state, esc, catMap, plan, generalSavings, freeAlloc, render } from '../core.js';
import { moneyValue, moneyAttrs, numberInput, moneyInput } from '../ui.js';

/* ---------- シミュレーション ---------- */

export const SIM_YEARS = [1, 3, 5, 10, 20];
export const investYears = () => Math.min(50, Math.max(1, Math.round(n(state.simulation.investYears)) || 20));

export function projection(years) {
  const pr = state.profile;
  const sim = state.simulation;
  const savings = futureSavings(generalSavings(), sim.monthlySavings, years);
  const inv = futureInvestment(pr.currentInvestment, sim.monthlyInvestment, sim.annualReturn, years);
  return { years, savings, ...inv, total: savings + inv.value };
}

export function simView() {
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

export function healthCard() {
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

export function goalResult() {
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

export function raiseResult() {
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

export function savingItems() {
  const plan_ = state.simulation.savingPlan || {};
  const items = [
    ...state.fixedCosts.filter((c) => n(c.amount) > 0).map((c) => ({ key: `fixed:${c.id}`, name: c.name, current: n(c.amount) })),
    ...state.budgets.filter((b) => n(b.monthlyLimit) > 0).map((b) => ({ key: `budget:${b.category}`, name: BUDGET_LABELS[b.category] || b.category, current: n(b.monthlyLimit) })),
    ...freeAlloc().items.filter((i) => catMap()[i.category]).map((i) => ({ key: `alloc:${i.category}`, name: catMap()[i.category].name, current: Math.round(i.monthly) })),
  ];
  return items.map((i) => ({ ...i, after: plan_[i.key] ?? null }));
}

export function savingRows() {
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

export function savingResult() {
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

export function nisaCheckHtml() {
  const c = nisaCheck(state.simulation.monthlyInvestment, state.simulation.nisaUsed);
  if (!c) return '';
  const icon = { ok: '✅', caution: '⚠️', over: '⚠️' }[c.level];
  return `<div class="nisa ${c.level}">
    <p><span aria-hidden="true">${icon}</span> ${esc(c.annualMessage)}</p>
    <p class="muted">${esc(c.lifetimeMessage)}</p>
  </div>`;
}

export function simResult() {
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


/* ---------- ボタン操作（data-action） ---------- */

export const simActions = {
  'clear-saving': async (btn, ev) => {
    state.simulation.savingPlan = {};
    await ds.saveSimulation(state.simulation);
    render();
  },
};
