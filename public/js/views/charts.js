import {
  n, sum, inPeriod, periodLabel, periodHistory, niceScale, compactYen, yen, parseDateKey,
} from '../calc.js';
import { state, $main, esc, catMap, groupOf, catLabel, planFor, payday } from '../core.js';
import { helpBtn } from '../guides.js';

/* ---------- グラフ ---------- */

export const chartTips = new Map(); // data-tip-id → { title, rows: [{ key, label, value | text }] }
export function tipAttr(title, rows) {
  const id = `tip${chartTips.size + 1}`;
  chartTips.set(id, { title, rows });
  return `data-tip-id="${id}" tabindex="0"`;
}
export const shortPeriod = (period) => (period.payday > 1 ? `${period.start.getMonth() + 1}/${period.start.getDate()}〜` : `${period.start.getMonth() + 1}月`);

export function chartsView(period) {
  chartTips.clear();
  if (!state.expenses.length) {
    return `<section class="card"><h2>グラフ</h2><p class="muted">家計簿に支出を記録すると、月ごとの収支やカテゴリ別の支出がグラフで表示されます。</p></section>`;
  }
  const rows = periodHistory({ expenses: state.expenses, planFor, groupOf, payday: payday() });
  return `
    ${categoryChart(period)}
    ${cardBillChart()}
    ${flowChart(rows)}
    ${savingChart(rows)}
    <p class="note center">収入や固定費は、設定を変えた月から反映しています（それより前の月は、記録が残っている最初の設定で計算）。</p>`;
}

export /** クレジットカードの請求額の推移（直近6回）と平均 */
function cardBillChart() {
  const bills = state.expenses.filter((e) => e.kind === 'cardBill').sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  if (bills.length < 2) return '';
  const avg = sum(bills, (b) => b.amount) / bills.length;
  const sc = niceScale(0, Math.max(...bills.map((b) => b.amount)));
  const pct = (v) => ((v - sc.min) / (sc.max - sc.min)) * 100;
  const label = (b) => `${parseDateKey(b.date).getMonth() + 1}/${parseDateKey(b.date).getDate()}`;
  const cols = bills.map((b) => `<div class="col" ${tipAttr(`${label(b)} の引き落とし`, [
    { key: 's1', label: '請求額', value: b.amount },
    { key: 'line', label: '平均', value: avg },
    { label: '平均との差', value: b.amount - avg },
  ])}><span class="vbar pos" style="bottom:0;height:${pct(b.amount)}%"></span></div>`);
  return `
    <section class="card chart-card">
      <p class="chart-title">💳 カードの請求額の推移 <span class="muted">平均 ${yen(avg)}</span></p>
      <p class="legend"><span><i class="key-rect s1"></i>請求額</span><span><i class="key-line"></i>平均</span></p>
      ${columnFrame(sc, cols, bills.map((b) => `<span>${label(b)}</span>`), `<div class="refline" style="bottom:${pct(avg)}%"></div>`)}
      ${tableView(['引き落とし日', '請求額', '平均との差'], bills.map((b) => [label(b), yen(b.amount), `${b.amount - avg >= 0 ? '+' : '−'}${yen(Math.abs(b.amount - avg))}`]))}
    </section>`;
}

function tableView(head, body) {
  return `<details class="table-view"><summary>表で見る</summary>
    <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </details>`;
}

/** 縦棒グラフの枠（目盛り・横軸）。cols は各列の HTML */
export function columnFrame(sc, cols, labels, extra = '') {
  const pct = (v) => ((v - sc.min) / (sc.max - sc.min)) * 100;
  return `
    <div class="plot">
      ${sc.ticks.map((t) => `<div class="gridline ${t === 0 ? 'base' : ''}" style="bottom:${pct(t)}%"><span>${compactYen(t)}</span></div>`).join('')}
      ${extra}
      <div class="cols">${cols.join('')}</div>
    </div>
    <div class="x-axis">${labels.join('')}</div>`;
}

export function categoryChart(period) {
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
        <h2>${periodLabel(period)}${helpBtn('charts')}</h2>
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

export function flowChart(rows) {
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

export function savingChart(rows) {
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
export const $tip = document.createElement('div');
$tip.className = 'chart-tip';
$tip.setAttribute('role', 'tooltip');
$tip.hidden = true;
document.body.append($tip);

export function showTip(el) {
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
export function hideTip() {
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

