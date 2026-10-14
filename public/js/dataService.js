// Service 層：アプリのデータ構造（UserProfile / FixedCost / Expense / Budget / Simulation）を扱う。
// UI はこのモジュールだけを呼び、保存先（storage.js）を直接触らない。

export const DEFAULT_CATEGORIES = [
  // group: 'living' = 生活費予算から使う / 'free' = 自由に使えるお金から使う
  { id: 'food', name: '食費', icon: '🍚', group: 'living' },
  { id: 'eatout', name: '外食', icon: '🍜', group: 'free' },
  { id: 'daily', name: '日用品', icon: '🛒', group: 'living' },
  { id: 'transport', name: '交通費', icon: '🚃', group: 'living' },
  { id: 'hobby', name: '趣味', icon: '🎮', group: 'free' },
  { id: 'clothes', name: '衣服', icon: '👕', group: 'free' },
  { id: 'medical', name: '医療', icon: '💊', group: 'living' },
  { id: 'social', name: '交際費', icon: '🍻', group: 'free' },
  { id: 'fun', name: '娯楽', icon: '🎬', group: 'free' },
  { id: 'other', name: 'その他', icon: '💰', group: 'free' },
];

export const DEFAULT_FIXED_COSTS = [
  { category: 'housing', name: '家賃' },
  { category: 'utility', name: '電気代' },
  { category: 'utility', name: 'ガス代' },
  { category: 'utility', name: '水道代' },
  { category: 'telecom', name: 'スマホ代' },
  { category: 'telecom', name: 'ネット代' },
  { category: 'insurance', name: '保険' },
  { category: 'subscription', name: 'サブスク' },
];

export const EXTRA_FIXED_COSTS = [
  { category: 'housing', name: '住宅ローン' },
  { category: 'car', name: '車ローン' },
  { category: 'car', name: '駐車場' },
  { category: 'other', name: 'その他固定費' },
];

export const BUDGET_LABELS = {
  food: '食費',
  daily: '日用品',
  transport: '交通費',
  living_other: 'その他生活費（医療など）',
};

const DEFAULT_PROFILE = {
  id: 'local',
  name: '',
  grossSalary: 0, // 月給（額面）参考値
  takeHome: 0, // 手取り月収（計算はこちらを優先）
  bonus: 0, // 年間ボーナス（手取り）
  bonusMode: 'separate', // 'monthly' = 毎月換算 / 'separate' = 別管理
  payday: 1, // 給料日（1〜28）。この日から翌月の前日までを予算の1か月とする。1 = 暦どおり
  otherIncome: 0,
  sideIncome: 0,
  currentSavings: 0,
  currentInvestment: 0,
};

const DEFAULT_SIMULATION = {
  monthlySavings: 0,
  monthlyInvestment: 0, // 毎月の積立投資額（NISAなど）
  annualReturn: 3, // 想定利回り（年%）
  investYears: 20, // 運用期間（年）
  nisaUsed: 0, // 使用済みの NISA 生涯投資枠（元本）
  incomeGrowthRate: 0, // 毎年の昇給率（%）
  jobChangeIncrease: 0, // 転職などによる手取りの増額（月）
  raiseSaveShare: 50, // 増えた収入のうち貯蓄に回す割合（%）
  savingPlan: {}, // 節約シミュレーション { 'fixed:<id>' | 'budget:<cat>' | 'alloc:<cat>': 見直し後の金額 }
};

const DEFAULT_GOAL = {
  targetAmount: 0,
  years: 10,
};

/* ---------- データの版管理 ---------- */

/** 保存データの形式の版。形式を変えたら上げて、MIGRATIONS に変換を追加する */
export const SCHEMA_VERSION = 2;

/** バックアップ・復元の対象になる保存データ（端末ごとの meta などは含めない） */
export const DATA_KEYS = ['profile', 'fixedCosts', 'budgets', 'simulation', 'goal', 'goals', 'allocations', 'customCategories', 'expenses'];

const toInt = (v) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? x : 0;
};

/**
 * 版ごとの変換。キーは「変換後の版」。古い版から順に1つずつ適用する。
 * 変換は保存データ（storage）を直接読み書きし、何度実行しても同じ結果になるように書く。
 */
export const MIGRATIONS = {
  // v1 → v2：金額を整数にそろえ、日付のない支出を除き、目的別の貯金の項目をそろえる
  2: async (st) => {
    const expenses = await st.get('expenses');
    if (Array.isArray(expenses)) {
      await st.set('expenses', expenses
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e?.date ?? ''))
        .map((e) => ({ ...e, amount: toInt(e.amount), shop: e.shop ?? '', memo: e.memo ?? '' })));
    }
    const fixed = await st.get('fixedCosts');
    if (Array.isArray(fixed)) await st.set('fixedCosts', fixed.map((c) => ({ ...c, amount: toInt(c.amount) })));
    const goals = await st.get('goals');
    if (Array.isArray(goals)) {
      await st.set('goals', goals.map((g) => ({
        lastContributionMonth: null, lastContributionAmount: 0, ...g,
        targetAmount: toInt(g.targetAmount), saved: toInt(g.saved),
      })));
    }
  },
};

async function hasAnyData(storage) {
  for (const k of DATA_KEYS) if ((await storage.get(k)) != null) return true;
  return false;
}

/**
 * 保存データを今の版にそろえる。変換する前に、元のデータを preMigrationBackup として残す。
 * 戻り値 status：'fresh'（初回）/ 'current'（変換なし）/ 'migrated' / 'newer'（新しい版のアプリで保存されたデータ）
 */
export async function migrateStorage(storage, migrations = MIGRATIONS, latest = SCHEMA_VERSION) {
  let version = await storage.get('schemaVersion');
  if (version == null) {
    if (!(await hasAnyData(storage))) {
      await storage.set('schemaVersion', latest);
      return { status: 'fresh', from: null, to: latest };
    }
    version = 1; // 版の記録がなかった頃のデータ
  }
  if (version > latest) return { status: 'newer', from: version, to: latest };
  if (version === latest) return { status: 'current', from: version, to: latest };

  const copy = {};
  for (const k of DATA_KEYS) copy[k] = await storage.get(k);
  await storage.set('preMigrationBackup', { fromVersion: version, at: new Date().toISOString(), data: copy });
  for (let v = version + 1; v <= latest; v++) {
    if (migrations[v]) await migrations[v](storage);
    await storage.set('schemaVersion', v);
  }
  return { status: 'migrated', from: version, to: latest };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createDataService(storage) {
  const read = async (key, fallback) => {
    const v = await storage.get(key);
    return v == null ? structuredClone(fallback) : v;
  };

  return {
    async getProfile() {
      return { ...DEFAULT_PROFILE, ...(await read('profile', {})) };
    },
    saveProfile: (profile) => storage.set('profile', profile),

    async listFixedCosts() {
      const saved = await storage.get('fixedCosts');
      if (saved) return saved;
      return DEFAULT_FIXED_COSTS.map((c) => ({ id: uid(), ...c, amount: 0, billingDay: null }));
    },
    saveFixedCosts: (list) => storage.set('fixedCosts', list),

    async listBudgets() {
      const saved = await storage.get('budgets');
      if (saved) return saved;
      return Object.keys(BUDGET_LABELS).map((category) => ({ category, monthlyLimit: 0 }));
    },
    saveBudgets: (list) => storage.set('budgets', list),

    async getSimulation() {
      return { ...DEFAULT_SIMULATION, ...(await read('simulation', {})) };
    },
    saveSimulation: (sim) => storage.set('simulation', sim),

    async getGoal() {
      return { ...DEFAULT_GOAL, ...(await read('goal', {})) };
    },
    saveGoal: (goal) => storage.set('goal', goal),

    /** 目的別の貯金（車・引っ越しなど）。saved は現在の貯金額のうち、この目的に取り分けている額 */
    listGoals: () => read('goals', []),
    saveGoals: (goals) => storage.set('goals', goals),

    async getAllocations() {
      return { percents: {}, eatoutPerWeek: 2, ...(await read('allocations', {})) };
    },
    saveAllocations: (alloc) => storage.set('allocations', alloc),

    async listCategories() {
      const custom = await read('customCategories', []);
      return [...DEFAULT_CATEGORIES, ...custom];
    },
    async addCategory({ name, icon, group }) {
      const custom = await read('customCategories', []);
      const cat = { id: 'c_' + uid(), name, icon: icon || '📌', group, custom: true };
      custom.push(cat);
      await storage.set('customCategories', custom);
      return cat;
    },
    async deleteCategory(id) {
      const custom = await read('customCategories', []);
      await storage.set('customCategories', custom.filter((c) => c.id !== id));
    },

    listExpenses: () => read('expenses', []),
    async addExpense(expense) {
      const list = await read('expenses', []);
      const item = { id: uid(), ...expense };
      list.push(item);
      await storage.set('expenses', list);
      return item;
    },
    async updateExpense(id, patch) {
      const list = await read('expenses', []);
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) throw new Error('支出が見つかりません');
      list[i] = { ...list[i], ...patch, id };
      await storage.set('expenses', list);
      return list[i];
    },
    async deleteExpense(id) {
      const list = await read('expenses', []);
      await storage.set('expenses', list.filter((e) => e.id !== id));
    },
    /** 削除の取り消し用。同じ id のまま戻す */
    async restoreExpense(item) {
      const list = await read('expenses', []);
      if (!list.some((e) => e.id === item.id)) list.push(item);
      await storage.set('expenses', list);
    },

    // 端末ごとの情報（使い始めた日・最後のバックアップ日）。バックアップには含めない
    getMeta: () => read('meta', {}),
    saveMeta: (meta) => storage.set('meta', meta),

    /** 保存データを今の版にそろえる（起動時に最初に呼ぶ） */
    migrate: () => migrateStorage(storage),

    async exportAll() {
      const data = {};
      for (const k of DATA_KEYS) data[k] = await storage.get(k);
      return { app: 'my-money', version: 1, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data };
    },
    /**
     * バックアップから復元する。今のデータは丸ごと置き換える（バックアップにない項目は消す）。
     * 古い版のバックアップは今の版に変換し、新しい版のアプリで作ったものは受け付けない。
     */
    async importAll(json) {
      if (json?.app !== 'my-money' || !json.data || typeof json.data !== 'object') throw new Error('my-money のバックアップファイルではありません');
      const fileVersion = json.schemaVersion ?? 1;
      if (fileVersion > SCHEMA_VERSION) throw new Error('新しいバージョンのアプリで作ったバックアップです。アプリを最新にしてから復元してください');
      for (const k of DATA_KEYS) {
        const v = json.data[k];
        if (v == null) await storage.remove(k);
        else await storage.set(k, v);
      }
      await storage.set('schemaVersion', fileVersion);
      await migrateStorage(storage);
    },
    resetAll: () => storage.clear(),
  };
}
