import {
  n, judgeSpend, parseMoney, yen,
} from './calc.js';
import { ds, state, ui, $main, plan, allow, freeAlloc, visitsPerWeek, loadAll, prepareData, currentRoute, setRenderer, render, schedulePersist, flushSaves, setByPath, bonus, recordPlanSnapshot } from './core.js';
import { formatMoneyField } from './ui.js';
import { hideTip } from './views/charts.js';
import { homeView, homeActions } from './views/home.js';
import { ledgerView, endEdit, saveExpense, addExpense, ledgerActions } from './views/ledger.js';
import { summaryCard, suggestCard, allocCard, budgetView, goalResultHtml, goalsFoot, bonusCard, bonusBreakdown, budgetActions } from './views/budget.js';
import { simView, healthCard, goalResult, raiseResult, savingResult, nisaCheckHtml, simResult, simActions } from './views/sim.js';
import { updateOnlineBadge, settingsView, settingsActions } from './views/settings.js';
import { guideActions, openScreenGuide } from './guides.js';

/* ---------- ルーティング・描画 ---------- */

const routes = {
  home: { title: 'ホーム', view: homeView },
  ledger: { title: '家計簿', view: ledgerView },
  budget: { title: '予算', view: budgetView },
  sim: { title: 'シミュレーション', view: simView },
  settings: { title: '設定', view: settingsView },
};

function renderApp() {
  hideTip();
  recordPlanSnapshot(); // 設定を直接保存した操作のあとも、設定の履歴を更新する
  const r = currentRoute();
  document.getElementById('page-title').textContent = routes[r].title;
  document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.route === r));
  $main.innerHTML = routes[r].view();
}
setRenderer(renderApp);

/* 予算・シミュレーション入力中はフォーカスを保つため部分更新のみ行う */
function refreshLive() {
  const p = plan();
  const summary = document.getElementById('live-summary');
  if (summary) summary.outerHTML = summaryCard();
  // 手取りを入れた直後にも目安カードを出す（開閉状態は保つ）
  const suggest = document.getElementById('suggest-slot');
  if (suggest) {
    const wasOpen = suggest.querySelector('details')?.open;
    suggest.innerHTML = suggestCard();
    const details = suggest.querySelector('details');
    if (details && wasOpen != null) details.open = wasOpen;
  }
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
  // ボーナスの使い道：入力中はカードを作り直さず、内訳だけ更新する
  const bonusSlot = document.getElementById('bonus-slot');
  if (bonusSlot) {
    if (bonusSlot.contains(document.activeElement)) {
      const el = document.getElementById('bonus-breakdown');
      if (el) el.innerHTML = bonusBreakdown();
    } else {
      bonusSlot.innerHTML = bonusCard();
    }
  }
  document.querySelectorAll('.bonus-only').forEach((el) => (el.hidden = !bonus().active));
}

function onBoundInput(t) {
  const money = 'money' in t.dataset;
  const raw = money && t.value.trim() !== '' ? parseMoney(t.value) : t.value;
  setByPath(t.dataset.bind, raw, money || t.type === 'number' || 'num' in t.dataset);
  schedulePersist(t.dataset.bind.split('.')[0]);
  refreshLive();
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

/* ---------- ボタン操作：各画面の操作表に振り分ける ---------- */

const actions = { ...homeActions, ...ledgerActions, ...budgetActions, ...simActions, ...settingsActions, ...guideActions };

// 画面右上の「？」：いま開いている画面の使い方
document.getElementById('topbar-help').addEventListener('click', () => openScreenGuide(currentRoute()));

$main.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn) return;
  await actions[btn.dataset.action]?.(btn, ev);
});

window.addEventListener('hashchange', () => {
  flushSaves();
  if (currentRoute() !== 'ledger' && ui.editingId) endEdit();
  render();
  window.scrollTo(0, 0);
});

if (await prepareData()) {
  await loadAll();
  render();
} else {
  // 古いアプリが新しい形式のデータを書き換えて壊さないよう、ここで止める
  $main.innerHTML = `<section class="card">
    <h2>アプリを更新してください</h2>
    <p>このデータは新しいバージョンのアプリで保存されています。ページを再読み込みすると最新のアプリになります。</p>
    <button class="btn primary block" onclick="location.reload()">再読み込み</button>
  </section>`;
}
updateOnlineBadge();
