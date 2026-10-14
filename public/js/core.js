import { createDefaultStorage } from './storage.js';
import { createDataService } from './dataService.js';
import {
  n, toDateKey, monthlyPlan, budgetPeriod, inPeriod, allowance, allocate, weekStartKey, historyAverages, earmarkedSavings,
} from './calc.js';

// アプリ全体で共有する状態・データの読み書き・描画の呼び出し口

export const { adapter, persistent } = createDefaultStorage();
export const ds = createDataService(adapter);

export const state = {
  profile: null, fixedCosts: [], budgets: [], simulation: null,
  goal: null, // 資産全体の目標（将来タブの逆算）
  goals: [], // 目的別の貯金（車・引っ越しなど）
  allocations: null, categories: [], expenses: [], meta: {},
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
export const plan = () => monthlyPlan(state);
/** 将来の資産に数える貯金（目的別に取り分けた分は使う予定なので除く） */
export const generalSavings = () => Math.max(0, n(state.profile.currentSavings) - earmarkedSavings(state.goals));
export const payday = () => state.profile.payday || 1;
export const currentPeriod = () => budgetPeriod(new Date(), payday());
export const history = () => historyAverages(state.expenses, new Date(), 3, payday());
export const allow = () => allowance({ plan: plan(), expenses: state.expenses, groupOf, payday: payday() });
export const freeAlloc = () => allocate(plan().free, state.allocations.percents);
export const visitsPerWeek = () => Math.max(1, Math.round(n(state.allocations.eatoutPerWeek)) || 1);

/** 今の期間・今週（月曜〜今日）のカテゴリ別支出 */
export function categoryUsage(today = new Date()) {
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

export async function loadAll() {
  [state.profile, state.fixedCosts, state.budgets, state.simulation, state.goal, state.goals, state.allocations, state.categories, state.expenses, state.meta] =
    await Promise.all([ds.getProfile(), ds.listFixedCosts(), ds.listBudgets(), ds.getSimulation(), ds.getGoal(), ds.listGoals(), ds.getAllocations(), ds.listCategories(), ds.listExpenses(), ds.getMeta()]);
  if (!state.meta.firstUsedAt) {
    state.meta.firstUsedAt = new Date().toISOString();
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
