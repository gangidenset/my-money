// 計算ロジック（純粋関数のみ。DOM・保存処理に依存しない）

export const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + n(f(x)), 0);

const pad = (x) => String(x).padStart(2, '0');
export const toDateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toMonthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const parseDateKey = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
};
export const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

/** 月の収入（手取りベース）。ボーナスは「毎月換算」のときだけ 1/12 を加える */
export function monthlyIncome(profile) {
  const base = n(profile.takeHome) + n(profile.otherIncome) + n(profile.sideIncome);
  return profile.bonusMode === 'monthly' ? base + n(profile.bonus) / 12 : base;
}

/** 収入 − 固定費 − 生活費予算 − 貯蓄予定 − 積立投資 ＝ 自由に使えるお金 */
export function monthlyPlan({ profile, fixedCosts, budgets, simulation }) {
  const income = monthlyIncome(profile);
  const fixed = sum(fixedCosts, (c) => c.amount);
  const living = sum(budgets, (b) => b.monthlyLimit);
  const savings = n(simulation.monthlySavings);
  const investment = n(simulation.monthlyInvestment);
  return { income, fixed, living, savings, investment, free: income - fixed - living - savings - investment };
}

export function summarizeSpending(expenses, groupOf) {
  let living = 0;
  let free = 0;
  const byCategory = {};
  for (const e of expenses) {
    const a = n(e.amount);
    byCategory[e.category] = (byCategory[e.category] || 0) + a;
    if (groupOf(e.category) === 'living') living += a;
    else free += a;
  }
  return { total: living + free, living, free, byCategory };
}

/** 自由に使えるお金の使用額。生活費予算を超えた分も自由費から差し引く */
export function freeUsed(expenses, groupOf, livingBudget) {
  const s = summarizeSpending(expenses, groupOf);
  return s.free + Math.max(0, s.living - livingBudget);
}

/**
 * 今月・今週・今日あといくら使えるか。
 * 今週＝月曜〜日曜（月をまたぐ場合は今月分のみ）。
 * 週と日の予算は「その期間の開始時点の残額」を残り日数で按分し、期間内の支出を引く。
 * 将来、給料日・固定費支払日・休日の重み付けを入れる場合は dayWeight を差し替える。
 */
export function allowance({ plan, expenses, groupOf, today = new Date(), dayWeight = () => 1 }) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const dim = daysInMonth(y, m);
  const mk = toMonthKey(today);
  const todayKey = toDateKey(today);

  const monthExp = expenses.filter((e) => e.date.startsWith(mk));
  const used = (list) => freeUsed(list, groupOf, plan.living);
  const before = (key) => monthExp.filter((e) => e.date < key);
  const usedUpToToday = used(monthExp.filter((e) => e.date <= todayKey));
  const weight = (from, to) => {
    let w = 0;
    for (let i = from; i <= to; i++) w += dayWeight(new Date(y, m, i));
    return w;
  };
  const restWeight = (from) => weight(from, dim) || 1;

  const monthUsed = used(monthExp);
  const monthLeft = plan.free - monthUsed;
  const daysLeft = dim - d + 1;

  const usedBeforeToday = used(before(todayKey));
  const todayBudget = (Math.max(0, plan.free - usedBeforeToday) * weight(d, d)) / restWeight(d);
  const todayLeft = todayBudget - (usedUpToToday - usedBeforeToday);

  const dow = (today.getDay() + 6) % 7; // 月曜=0
  const weekStartDay = Math.max(1, d - dow);
  const weekEndDay = Math.min(dim, d - dow + 6);
  const usedBeforeWeek = used(before(toDateKey(new Date(y, m, weekStartDay))));
  const weekBudget =
    (Math.max(0, plan.free - usedBeforeWeek) * weight(weekStartDay, weekEndDay)) / restWeight(weekStartDay);
  const weekLeft = weekBudget - (usedUpToToday - usedBeforeWeek);

  const spending = summarizeSpending(monthExp, groupOf);
  const spentSoFar = summarizeSpending(monthExp.filter((e) => e.date <= todayKey), groupOf).total;
  const projectedSpend = (spentSoFar / d) * dim;
  const projectedLeft = plan.living + plan.free - projectedSpend;

  return {
    monthUsed, monthLeft, daysLeft,
    weekBudget, weekLeft, weekDaysLeft: weekEndDay - d + 1,
    todayBudget, todayLeft,
    spending, projectedSpend, projectedLeft,
    dayOfMonth: d, daysInMonth: dim,
  };
}

/** 「この金額を使っても大丈夫？」の判定 */
export function judgeSpend(amount, a) {
  const amt = n(amount);
  if (amt <= 0) return null;
  if (amt <= a.todayLeft) {
    return { level: 'ok', message: `今日の目安内です。使ったあとも今日あと${yen(a.todayLeft - amt)}あります。` };
  }
  if (amt <= a.weekLeft) {
    return { level: 'ok', message: `今週あと${yen(a.weekLeft)}使えるので問題ありません。使ったあとは今週あと${yen(a.weekLeft - amt)}です。` };
  }
  if (amt <= a.monthLeft) {
    return { level: 'caution', message: `今週の予算は${yen(amt - Math.max(0, a.weekLeft))}超えますが、今月の残り${yen(a.monthLeft)}の中で調整できます。` };
  }
  return { level: 'over', message: `今月の自由に使えるお金を${yen(amt - Math.max(0, a.monthLeft))}超えます。来月の予算か貯蓄予定から回す計画にしましょう。` };
}

/** 単純積立（利息なし）：現在の貯金 + 毎月の貯蓄 × 12 × 年数 */
export function futureSavings(current, monthly, years) {
  return n(current) + n(monthly) * 12 * years;
}

/**
 * 積立投資の想定シミュレーション（月複利、月利＝年利÷12、積立は毎月末）。
 * 税金・手数料・価格変動は考慮しない。あくまで想定利回りが一定で続いた場合の計算。
 */
export function futureInvestment(current, monthly, annualRatePct, years) {
  const months = Math.round(years * 12);
  const r = n(annualRatePct) / 100 / 12;
  const growth = (1 + r) ** months;
  const value = r === 0
    ? n(current) + n(monthly) * months
    : n(current) * growth + n(monthly) * ((growth - 1) / r);
  const principal = n(current) + n(monthly) * months;
  return { value, principal, gain: value - principal };
}

export const NISA = {
  tsumitateAnnual: 1_200_000, // つみたて投資枠（年）
  totalAnnual: 3_600_000, // つみたて投資枠＋成長投資枠（年）
  lifetime: 18_000_000, // 生涯投資枠（元本ベース）
};

/** 新NISAの枠チェック。used は既に使った生涯枠（元本） */
export function nisaCheck(monthly, used = 0) {
  const annual = n(monthly) * 12;
  if (annual <= 0) return null;
  let level = 'ok';
  let annualMessage = `年間${yen(annual)}で、つみたて投資枠（年120万円）の範囲内です。`;
  if (annual > NISA.totalAnnual) {
    level = 'over';
    annualMessage = `年間${yen(annual)}は、NISAの年間投資枠（合計360万円）を${yen(annual - NISA.totalAnnual)}超えます。超えた分は課税口座での投資になります。`;
  } else if (annual > NISA.tsumitateAnnual) {
    level = 'caution';
    annualMessage = `年間${yen(annual)}は、つみたて投資枠（年120万円）を${yen(annual - NISA.tsumitateAnnual)}超えます。超えた分は成長投資枠（年240万円）で買う必要があります。`;
  }
  const remaining = Math.max(0, NISA.lifetime - n(used));
  const monthsToLimit = Math.ceil(remaining / Math.min(n(monthly), NISA.totalAnnual / 12));
  const y = Math.floor(monthsToLimit / 12);
  const m = monthsToLimit % 12;
  const lifetimeMessage = remaining <= 0
    ? '生涯投資枠（1,800万円）をすでに使い切っています。'
    : `このペースだと約${y ? `${y}年` : ''}${m ? `${m}か月` : ''}で生涯投資枠（1,800万円）に達します。`;
  return { level, annual, annualMessage, lifetimeMessage, monthsToLimit };
}

/* ---------- Phase 4：使い道ごとの予算・目安・警告 ---------- */

export const ALLOC_CHOICES = [0, 10, 20, 30, 40, 50];

/** 月の予算を週に換算（1年＝52週） */
export const weeklyOf = (monthly) => (n(monthly) * 12) / 52;

/** 自由に使えるお金を割合で配分する（貯蓄・積立は確保済みの金額が基準） */
export function allocate(free, percents) {
  const base = Math.max(0, n(free));
  const items = Object.entries(percents)
    .filter(([, pct]) => n(pct) > 0)
    .map(([category, pct]) => {
      const monthly = (base * n(pct)) / 100;
      return { category, percent: n(pct), monthly, weekly: weeklyOf(monthly) };
    });
  const totalPercent = sum(items, (i) => i.percent);
  return { items, totalPercent, unallocated: (base * Math.max(0, 100 - totalPercent)) / 100 };
}

/** 月曜始まりの週の初日（月をまたいでもよい） */
export function weekStartKey(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateKey(d);
}

/** 直近 months か月（今月を除く）のうち記録がある月の、カテゴリ別の月平均 */
export function historyAverages(expenses, today = new Date(), months = 3) {
  const keys = [];
  for (let i = 1; i <= months; i++) keys.push(toMonthKey(new Date(today.getFullYear(), today.getMonth() - i, 1)));
  const present = keys.filter((k) => expenses.some((e) => e.date.startsWith(k)));
  if (!present.length) return null;
  const byCategory = {};
  for (const e of expenses) {
    if (present.some((k) => e.date.startsWith(k))) byCategory[e.category] = (byCategory[e.category] || 0) + n(e.amount);
  }
  for (const k of Object.keys(byCategory)) byCategory[k] /= present.length;
  return { months: present.length, byCategory };
}

/**
 * 手取りからの予算初期目安（例：手取り30万円 → 固定費12万・食費4万・日用品1万・交通費1万・貯蓄7万）。
 * 本人の実績（historyAverages）がある項目は実績を優先する。積立投資をしている分は貯蓄目安から差し引く。
 */
export const SUGGEST_RATIOS = { fixed: 0.4, food: 0.133, daily: 0.033, transport: 0.033, savings: 0.233 };
export const SUGGEST_PERCENTS = { eatout: 30, hobby: 20, fun: 20 };

export function suggestBudget(income, { investment = 0, history = null } = {}) {
  const r = (x) => Math.round(x / 1000) * 1000;
  const pick = (id) => {
    const avg = history?.byCategory?.[id];
    return avg != null ? { amount: r(avg), source: 'history' } : { amount: r(income * SUGGEST_RATIOS[id]), source: 'ratio' };
  };
  return {
    fixed: r(income * SUGGEST_RATIOS.fixed),
    living: { food: pick('food'), daily: pick('daily'), transport: pick('transport') },
    savings: Math.max(0, r(income * SUGGEST_RATIOS.savings - n(investment))),
    percents: { ...SUGGEST_PERCENTS },
  };
}

/** 予算の使いすぎ警告（不安を煽らず「あと○円までなら予定内」を優先） */
export function budgetAlerts(items) {
  const alerts = [];
  for (const { name, limit, used } of items) {
    if (!(limit > 0)) continue;
    const pct = Math.floor((used / limit) * 100);
    if (used > limit) {
      alerts.push({ level: 'over', message: `${name}は予算を${yen(used - limit)}超えました。ほかの項目で調整できれば今月の予定内に収まります。` });
    } else if (pct >= 80) {
      alerts.push({ level: 'caution', message: `${name}予算の${pct}%を使いました。あと${yen(limit - used)}までなら予定内です。` });
    }
  }
  return alerts;
}

/* ---------- Phase 5：目標逆算・昇給・家計診断・節約効果 ---------- */

/** 目標額に届くための毎月の積立額（ratePct=0 なら単純割り算） */
export function requiredMonthly(target, current, years, ratePct = 0) {
  const m = Math.round(n(years) * 12);
  if (m <= 0) return Math.max(0, n(target) - n(current));
  const r = n(ratePct) / 100 / 12;
  if (r === 0) return Math.max(0, (n(target) - n(current)) / m);
  const g = (1 + r) ** m;
  return Math.max(0, ((n(target) - n(current) * g) * r) / (g - 1));
}

/** 貯金＋投資の合計が目標額に届くまでの月数（届かなければ null。最大100年） */
export function monthsToReach(target, { currentSavings, monthlySavings, currentInvestment, monthlyInvestment, annualReturn }) {
  const r = n(annualReturn) / 100 / 12;
  let sav = n(currentSavings);
  let inv = n(currentInvestment);
  for (let m = 0; m <= 1200; m++) {
    if (sav + inv >= n(target)) return m;
    sav += n(monthlySavings);
    inv = inv * (1 + r) + n(monthlyInvestment);
  }
  return null;
}

export const formatMonths = (m) => {
  const y = Math.floor(m / 12);
  const mm = m % 12;
  return `${y ? `${y}年` : ''}${mm ? `${mm}か月` : ''}` || '0か月';
};

/**
 * 昇給・転職シミュレーション。year 年後の手取り月収＝(現在＋転職による増額)×(1＋昇給率)^year。
 * 増えた分のうち saveShare% を貯蓄に回した場合の累計上乗せ額も返す。
 */
export function incomeGrowth({ base, growthPct = 0, jobIncrease = 0, saveShare = 0 }, years) {
  const g = n(growthPct) / 100;
  const start = n(base) + n(jobIncrease);
  let extra = 0;
  for (let k = 0; k < years; k++) extra += 12 * (start * (1 + g) ** k - n(base)) * (n(saveShare) / 100);
  return { income: start * (1 + g) ** years, extraSavings: extra };
}

/** 家計の状態判定。貯蓄率・固定費率・自由支出率の組み合わせで判定する */
export function householdHealth(plan) {
  const income = n(plan.income);
  if (income <= 0) return null;
  const savingsRate = ((plan.savings + n(plan.investment)) / income) * 100;
  const fixedRate = (plan.fixed / income) * 100;
  const freeRate = (plan.free / income) * 100;
  const reasons = [];
  if (plan.free < 0) reasons.push(`予定の合計が収入を${yen(-plan.free)}上回っています`);
  if (savingsRate < 10) reasons.push('貯蓄率が10%未満です');
  if (fixedRate > 50) reasons.push('固定費が手取りの半分を超えています');
  else if (fixedRate > 40) reasons.push('固定費が手取りの40%を超えています');
  if (plan.free >= 0 && freeRate < 3) reasons.push('自由に使えるお金がほとんど残りません');

  let level;
  if (plan.free < 0 || savingsRate < 5) level = 'danger';
  else if (savingsRate < 10 || fixedRate > 50 || freeRate < 3) level = 'warn';
  else if (savingsRate < 15 || fixedRate > 40) level = 'normal';
  else if (savingsRate >= 25 && fixedRate <= 35) level = 'great';
  else level = 'stable';

  const LEVELS = {
    great: { emoji: '🟢', label: 'かなり余裕あり', description: '毎月しっかり貯蓄でき、余剰資金も十分です。' },
    stable: { emoji: '🟢', label: '安定', description: '無理なく貯蓄できています。' },
    normal: { emoji: '🟡', label: '普通', description: '貯蓄はできていますが、多少の節約余地があります。' },
    warn: { emoji: '🟠', label: '注意', description: '支出が収入に近く、貯蓄や余裕が少なめです。' },
    danger: { emoji: '🔴', label: '要見直し', description: '赤字、または貯蓄がほとんどできない状態です。固定費から見直すと効果が大きいです。' },
  };
  return { level, ...LEVELS[level], savingsRate, fixedRate, freeRate, reasons };
}

const FIXED_TIPS = {
  housing: '家賃は手取りの25〜30%以内がひとつの目安です。更新時の交渉や住み替えで大きく変わります。',
  telecom: '格安SIMや光回線のプラン見直しで、月数千円下がることがあります。',
  insurance: '保障の重複や、貯蓄で備えられる保障がないか確認してみましょう。',
  subscription: '使っていないサービスの解約は、すぐ効果が出る節約です。',
  car: '車関連は金額が大きい項目です。利用頻度に合っているか見直してみましょう。',
  utility: '電力・ガス会社のプラン変更で下がることがあります。',
};

/** 固定費のうち、見直し効果が大きい順の項目とヒント */
export function fixedCostTips(fixedCosts, limit = 3) {
  const byCat = {};
  for (const c of fixedCosts) {
    if (n(c.amount) <= 0 || !FIXED_TIPS[c.category]) continue;
    (byCat[c.category] ||= { category: c.category, names: [], amount: 0 });
    byCat[c.category].names.push(c.name);
    byCat[c.category].amount += n(c.amount);
  }
  return Object.values(byCat)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((x) => ({ ...x, tip: FIXED_TIPS[x.category] }));
}

/** 節約効果。items: [{ current, after }]（after が null の項目は対象外） */
export function savingEffect(items, ratePct = 0) {
  const monthly = sum(items.filter((i) => i.after != null && i.after < i.current), (i) => n(i.current) - n(i.after));
  return {
    monthly,
    yearly: monthly * 12,
    tenYears: monthly * 120,
    tenYearsInvested: futureInvestment(0, monthly, ratePct, 10).value,
  };
}

export function yen(v) {
  return Math.round(n(v)).toLocaleString('ja-JP') + '円';
}
