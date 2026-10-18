import { createDefaultStorage } from './storage.js';
import { createDataService, uid } from './dataService.js';
import {
  n, toDateKey, monthlyPlan, budgetPeriod, inPeriod, allowance, allocate, weekStartKey, historyAverages, earmarkedSavings,
  bonusSchedule, planAt, upsertPlanSnapshot, periodLeftover, goalsPaidIn,
  cardCycle, latestCardUsage, cardUsageStatus, spendAmount,
} from './calc.js';

// アプリ全体で共有する状態・データの読み書き・描画の呼び出し口

export const { adapter, persistent } = createDefaultStorage();
export const ds = createDataService(adapter);

export const state = {
  profile: null, fixedCosts: [], budgets: [], simulation: null,
  goal: null, // 資産全体の目標（将来タブの逆算）
  goals: [], // 目的別の貯金（車・引っ越しなど）
  allocations: null, categories: [], expenses: [], meta: {},
  planHistory: [], // 収入・固定費などの設定の履歴
  settlements: {}, // 期間の締め（期間の初日 → どうしたか）
  goalLog: [], // 目的別の貯金に入れた記録
  cardUsage: [], // クレジットカードの利用額の記録
};
export const ui = {
  entryCategory: 'food',
  ledgerOffset: 0, // 家計簿で表示中の期間（0 = 今の期間、-1 = 前の期間）
  ledgerMode: 'list', // 'list' = 記録 / 'chart' = グラフ
  editingId: null, // 編集中の支出
  categoryBeforeEdit: null, // 編集を終えたら、新規記録用のカテゴリ選択を元に戻す
  quickList: [],
  checkAmount: '',
};

export const $main = document.getElementById('main');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const catMap = () => Object.fromEntries(state.categories.map((c) => [c.id, c]));
export const groupOf = (id) => catMap()[id]?.group || 'free';
export const catLabel = (id) => {
  const c = catMap()[id];
  return c ? `${c.icon} ${esc(c.name)}` : '❔ 不明';
};
/* ---------- 表示モード・クレジットカード ---------- */

/** カード中心のシンプル表示か（使わない機能を隠す） */
export const isCardMode = () => state.profile?.display?.mode === 'card';

/** クレジットカードの設定（古いデータで項目が足りない場合も初期値で補う） */
export const cardSettings = () => ({ enabled: false, payDay: 27, closingDay: 31, budget: 0, ...(state.profile?.card ?? {}) });

/** 今日を含むカードの利用サイクル */
export const cardCycleNow = (today = new Date()) => cardCycle(today, cardSettings().closingDay, cardSettings().payDay);

/** カードで1サイクルに使ってよい額（自分で決めていなければ、毎月の「自由に使えるお金」） */
export const cardLimit = () => (n(cardSettings().budget) > 0 ? n(cardSettings().budget) : Math.max(0, basePlan().free));

/** 積立投資（NISAなど）をクレジットカードで払っているか */
export const investViaCard = () => Boolean(state.simulation?.investViaCard) && n(state.simulation?.monthlyInvestment) > 0;
/** カードの請求額・利用額に含まれる、毎月の積立額 */
export const cardInvestPart = () => (investViaCard() ? Math.round(n(state.simulation.monthlyInvestment)) : 0);

/** カードの今サイクルの状況（利用額・あと使える額・請求見込み） */
export function cardStatus(today = new Date()) {
  const cycle = cardCycleNow(today);
  const latest = latestCardUsage(state.cardUsage, cycle);
  return { cycle, latest, ...cardUsageStatus({ cycle, limit: cardLimit(), latest, today, investment: cardInvestPart() }) };
}

/** ボーナスの予定（「別管理」のときの使い道） */
export const bonus = () => bonusSchedule(state.profile);
/** 今の設定による毎月の計画（前の期間からの繰り越しを含まない） */
export const basePlan = () => monthlyPlan(state);
/** その期間に、前の期間から繰り越したお金（マイナスは前の期間の使いすぎ分） */
export const carryIn = (period = currentPeriod()) => {
  const s = state.settlements[budgetPeriod(period.start, payday(), -1).startKey];
  return s?.action === 'carry' ? n(s.amount) : 0;
};
/** 今の期間の計画（繰り越しを含む）。「今月あといくら」などはこれを使う */
export const plan = () => {
  const p = basePlan();
  const carry = carryIn();
  return { ...p, carry, free: p.free + carry };
};
/** 過去の期間はその時点の設定で、今の期間は今の計画で計算する（グラフ用） */
export function planFor(period) {
  if (period.startKey === currentPeriod().startKey) return plan();
  const snap = planAt(state.planHistory, period.startKey) ?? basePlan();
  return { ...snap, goals: goalsPaidIn(state.goalLog, period) };
}
/** 将来の資産に数える貯金（目的別に取り分けた分は使う予定なので除く） */
export const generalSavings = () => Math.max(0, n(state.profile.currentSavings) - earmarkedSavings(state.goals));
export const payday = () => state.profile.payday || 1;
export const currentPeriod = () => budgetPeriod(new Date(), payday());
export const history = () => historyAverages(state.expenses, new Date(), 3, payday());
export const allow = () => allowance({ plan: plan(), expenses: state.expenses, groupOf, payday: payday() });
export const freeAlloc = () => allocate(plan().free, state.allocations.percents);
export const visitsPerWeek = () => Math.max(1, Math.round(n(state.allocations.eatoutPerWeek)) || 1);

/**
 * まだ締めていない前の期間の、余ったお金（または足りなかったお金）。
 * 使い始める前の期間・記録がない期間・収入がない期間・ちょうど0円のときは null。
 */
export function pendingSettlement(today = new Date()) {
  const prev = budgetPeriod(today, payday(), -1);
  if (state.settlements[prev.startKey]) return null;
  if ((state.meta.firstUsedAt ?? '').slice(0, 10) > prev.endKey) return null;
  if (!state.expenses.some((e) => inPeriod(prev, e.date))) return null;
  const planBase = planAt(state.planHistory, prev.startKey) ?? basePlan();
  if (!(n(planBase.income) > 0)) return null;
  const r = periodLeftover({
    period: prev, planBase, expenses: state.expenses, groupOf,
    goalsPaid: goalsPaidIn(state.goalLog, prev), carryIn: carryIn(prev),
  });
  return r.leftover === 0 ? null : { period: prev, ...r };
}

/** 目的別の貯金に入れた記録を追加する（source：monthly / bonus / leftover）。戻り値の id で取り消せる */
export async function logGoal(entry) {
  const item = { id: uid(), ...entry };
  state.goalLog = [...state.goalLog, item];
  await ds.saveGoalLog(state.goalLog);
  return item.id;
}
export async function unlogGoal(ids) {
  const set = new Set([].concat(ids));
  state.goalLog = state.goalLog.filter((x) => !set.has(x.id));
  await ds.saveGoalLog(state.goalLog);
}

/** 今の期間から有効な設定として履歴に残す（収入が未設定のあいだは残さない） */
export async function recordPlanSnapshot() {
  if (!state.profile) return;
  const base = basePlan();
  if (!(base.income > 0)) return;
  const next = upsertPlanSnapshot(state.planHistory, currentPeriod().startKey, base);
  if (JSON.stringify(next) === JSON.stringify(state.planHistory)) return;
  state.planHistory = next;
  await ds.savePlanHistory(next);
}

/** 今の期間・今週（月曜〜今日）のカテゴリ別支出 */
export function categoryUsage(today = new Date()) {
  const period = budgetPeriod(today, payday());
  const ws = weekStartKey(today);
  const tk = toDateKey(today);
  const month = {};
  const week = {};
  for (const e of state.expenses) {
    if (inPeriod(period, e.date)) month[e.category] = (month[e.category] || 0) + spendAmount(e);
    if (e.date >= ws && e.date <= tk) week[e.category] = (week[e.category] || 0) + spendAmount(e);
  }
  return { month, week };
}

/** 起動時：保存データを今の版にそろえる。新しい版のアプリで保存されたデータなら false（書き換えない） */
export async function prepareData() {
  const result = await ds.migrate();
  return result.status !== 'newer';
}

export async function loadAll() {
  [
    state.profile, state.fixedCosts, state.budgets, state.simulation, state.goal, state.goals, state.allocations,
    state.categories, state.expenses, state.meta, state.planHistory, state.settlements, state.goalLog, state.cardUsage,
  ] = await Promise.all([
    ds.getProfile(), ds.listFixedCosts(), ds.listBudgets(), ds.getSimulation(), ds.getGoal(), ds.listGoals(), ds.getAllocations(),
    ds.listCategories(), ds.listExpenses(), ds.getMeta(), ds.listPlanHistory(), ds.getSettlements(), ds.listGoalLog(), ds.listCardUsage(),
  ]);
  if (!state.meta.firstUsedAt) {
    state.meta.firstUsedAt = new Date().toISOString();
    state.meta.guideIntroSeen = true; // 新しく使い始めた人には「ガイドができました」は出さない
    await ds.saveMeta(state.meta);
  }
}


/* ---------- 画面の切り替え（実際の描画は app.js が登録する） ---------- */

export const ROUTES = ['home', 'ledger', 'budget', 'sim', 'settings'];
export const currentRoute = () => {
  const r = location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'home';
};
export let renderer = () => {};
export const setRenderer = (fn) => {
  renderer = fn;
};
export const render = () => renderer();

/* ---------- 入力の保存 ---------- */

export const persisters = {
  profile: () => ds.saveProfile(state.profile),
  fixedCosts: () => ds.saveFixedCosts(state.fixedCosts),
  budgets: () => ds.saveBudgets(state.budgets),
  simulation: () => ds.saveSimulation(state.simulation),
  allocations: () => ds.saveAllocations(state.allocations),
  goal: () => ds.saveGoal(state.goal),
  goals: () => ds.saveGoals(state.goals),
};
export const pendingSaves = new Set();
export let saveTimer;
export function schedulePersist(root) {
  pendingSaves.add(root);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 300);
}
export function flushSaves() {
  clearTimeout(saveTimer);
  pendingSaves.forEach((k) => persisters[k]());
  pendingSaves.clear();
  recordPlanSnapshot();
}
window.addEventListener('pagehide', flushSaves);

export function setByPath(path, raw, isNumber) {
  const keys = path.split('.');
  let obj = state;
  for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
  const key = keys.at(-1);
  // 節約シミュレーションは空欄＝見直しなし
  if (isNumber && raw === '' && keys.at(-2) === 'savingPlan') delete obj[key];
  else obj[key] = isNumber ? Math.max(0, n(raw)) : raw;
}
