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
    async deleteExpense(id) {
      const list = await read('expenses', []);
      await storage.set('expenses', list.filter((e) => e.id !== id));
    },

    async exportAll() {
      const keys = ['profile', 'fixedCosts', 'budgets', 'simulation', 'goal', 'allocations', 'customCategories', 'expenses'];
      const data = {};
      for (const k of keys) data[k] = await storage.get(k);
      return { app: 'my-money', version: 1, exportedAt: new Date().toISOString(), data };
    },
    async importAll(json) {
      if (json?.app !== 'my-money' || !json.data) throw new Error('my-money のバックアップファイルではありません');
      for (const [k, v] of Object.entries(json.data)) {
        if (v != null) await storage.set(k, v);
      }
    },
    resetAll: () => storage.clear(),
  };
}
