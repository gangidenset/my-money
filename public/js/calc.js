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

/** 収入 − 固定費 − 生活費予算 − 貯蓄予定 − 積立投資 − 目的別の積立 ＝ 自由に使えるお金 */
export function monthlyPlan({ profile, fixedCosts, budgets, simulation, goals = [] }, today = new Date()) {
  const income = monthlyIncome(profile);
  const fixed = sum(fixedCosts, (c) => c.amount);
  const living = sum(budgets, (b) => b.monthlyLimit);
  const savings = n(simulation.monthlySavings);
  const investment = n(simulation.monthlyInvestment);
  const goalsMonthly = goalsMonthlyTotal(goals, today, bonusSchedule(profile));
  return {
    income, fixed, living, savings, investment, goals: goalsMonthly,
    free: income - fixed - living - savings - investment - goalsMonthly,
  };
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

/* ---------- 予算の1か月（給料日で区切る） ---------- */

export const MAX_PAYDAY = 28;
export const addDays = (d, k) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
const dayOnly = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const diffDays = (a, b) => Math.round((dayOnly(b) - dayOnly(a)) / 86400000);

/**
 * 予算の1か月。payday=1 なら暦どおり（1日〜末日）、25 なら「25日〜翌月24日」。
 * offset で前（-1）や次（+1）の期間を返す。29〜31日は月によって存在しないため 28 日までとする。
 */
export function budgetPeriod(today = new Date(), payday = 1, offset = 0) {
  const p = Math.min(MAX_PAYDAY, Math.max(1, Math.round(n(payday)) || 1));
  const m = today.getMonth() - (today.getDate() < p ? 1 : 0) + offset;
  const start = new Date(today.getFullYear(), m, p);
  const end = new Date(today.getFullYear(), m + 1, p - 1);
  return { start, end, startKey: toDateKey(start), endKey: toDateKey(end), days: diffDays(start, end) + 1, payday: p };
}

export const inPeriod = (period, dateKey) => dateKey >= period.startKey && dateKey <= period.endKey;

export function periodLabel(period) {
  if (period.payday === 1) return `${period.start.getFullYear()}年${period.start.getMonth() + 1}月`;
  const f = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${f(period.start)}〜${f(period.end)}`;
}

/**
 * 今月・今週・今日あといくら使えるか。「今月」は給料日で区切った予算の1か月。
 * 今週＝月曜〜日曜（期間をまたぐ場合は期間内の分のみ）。
 * 週と日の予算は「その期間の開始時点の残額」を残り日数で按分し、期間内の支出を引く。
 * 将来、固定費支払日・休日の重み付けを入れる場合は dayWeight を差し替える。
 */
export function allowance({ plan, expenses, groupOf, today = new Date(), payday = 1, dayWeight = () => 1 }) {
  const period = budgetPeriod(today, payday);
  const t0 = dayOnly(today);
  const todayKey = toDateKey(t0);

  const monthExp = expenses.filter((e) => inPeriod(period, e.date));
  const used = (list) => freeUsed(list, groupOf, plan.living);
  const before = (key) => monthExp.filter((e) => e.date < key);
  const usedUpToToday = used(monthExp.filter((e) => e.date <= todayKey));
  const weight = (from, to) => {
    let w = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) w += dayWeight(d);
    return w;
  };
  const restWeight = (from) => weight(from, period.end) || 1;

  const monthUsed = used(monthExp);
  const monthLeft = plan.free - monthUsed;
  const daysLeft = diffDays(t0, period.end) + 1;

  const usedBeforeToday = used(before(todayKey));
  const todayBudget = (Math.max(0, plan.free - usedBeforeToday) * weight(t0, t0)) / restWeight(t0);
  const todayLeft = todayBudget - (usedUpToToday - usedBeforeToday);

  const monday = addDays(t0, -((t0.getDay() + 6) % 7));
  const weekStart = monday < period.start ? period.start : monday;
  const sunday = addDays(monday, 6);
  const weekEnd = sunday > period.end ? period.end : sunday;
  const usedBeforeWeek = used(before(toDateKey(weekStart)));
  const weekBudget = (Math.max(0, plan.free - usedBeforeWeek) * weight(weekStart, weekEnd)) / restWeight(weekStart);
  const weekLeft = weekBudget - (usedUpToToday - usedBeforeWeek);

  const dayIndex = diffDays(period.start, t0) + 1;
  const spending = summarizeSpending(monthExp, groupOf);
  const spentSoFar = summarizeSpending(monthExp.filter((e) => e.date <= todayKey), groupOf).total;
  const projectedSpend = (spentSoFar / dayIndex) * period.days;
  const projectedLeft = plan.living + plan.free - projectedSpend;

  return {
    period,
    monthUsed, monthLeft, daysLeft,
    weekBudget, weekLeft, weekDaysLeft: diffDays(t0, weekEnd) + 1,
    todayBudget, todayLeft,
    spending, projectedSpend, projectedLeft,
    dayOfMonth: dayIndex, daysInMonth: period.days,
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

/** 単純積立（利息なし）：現在の貯金 + 毎月の貯蓄 × 12 × 年数（＋ボーナスから貯金に回す年額 × 年数） */
export function futureSavings(current, monthly, years, bonusPerYear = 0) {
  return n(current) + n(monthly) * 12 * years + n(bonusPerYear) * years;
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

/** 直近 months か月（今の期間を除く）のうち記録がある期間の、カテゴリ別の月平均。期間は給料日で区切る */
export function historyAverages(expenses, today = new Date(), months = 3, payday = 1) {
  const periods = [];
  for (let i = 1; i <= months; i++) periods.push(budgetPeriod(today, payday, -i));
  const present = periods.filter((p) => expenses.some((e) => inPeriod(p, e.date)));
  if (!present.length) return null;
  const byCategory = {};
  for (const e of expenses) {
    if (present.some((p) => inPeriod(p, e.date))) byCategory[e.category] = (byCategory[e.category] || 0) + n(e.amount);
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

export function suggestBudget(income, { investment = 0, goals = 0, history = null } = {}) {
  const r = (x) => Math.round(x / 1000) * 1000;
  const pick = (id) => {
    const avg = history?.byCategory?.[id];
    return avg != null ? { amount: r(avg), source: 'history' } : { amount: r(income * SUGGEST_RATIOS[id]), source: 'ratio' };
  };
  return {
    fixed: r(income * SUGGEST_RATIOS.fixed),
    living: { food: pick('food'), daily: pick('daily'), transport: pick('transport') },
    savings: Math.max(0, r(income * SUGGEST_RATIOS.savings - n(investment) - n(goals))),
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
  // 目的別の積立（車・引っ越しなど）も「先に取り分けるお金」として貯蓄率に含める
  const savingsRate = ((plan.savings + n(plan.investment) + n(plan.goals)) / income) * 100;
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

/* ---------- 目的別の貯金（車・引っ越し・家具など。運用益なしで逆算） ---------- */

const monthIndex = (y, month1) => y * 12 + (month1 - 1);

/**
 * 目的別の貯金の逆算。購入予定月の「前月」までに貯め切る前提で、
 * 残りの積立回数で残額を割った金額（100円単位で切り上げ）を毎月の積立額とする。
 * 今月すでに積み立てていれば、今月の枠は使用済みとして来月から数える。
 * status: unset（目標金額なし）/ active / done（達成）/ due（もう積み立てる回数がない）/ overdue（購入予定月を過ぎた）
 * thisMonthAmount: 今月の予算から差し引く額（積立済みなら実際に積み立てた額）
 */
export function goalPlan(goal, today = new Date(), bonus = null) {
  const target = n(goal.targetAmount);
  const saved = n(goal.saved);
  const remaining = Math.max(0, target - saved);
  const contributed = goal.lastContributionMonth === toMonthKey(today);
  const diff = monthIndex(n(goal.targetYear), n(goal.targetMonth)) - monthIndex(today.getFullYear(), today.getMonth() + 1);
  const slots = diff - (contributed ? 1 : 0);
  const contributedAmount = contributed ? n(goal.lastContributionAmount) : 0;
  // 購入予定月の前月までに受け取るボーナスから、この目的に入れる予定の額
  const bonusPayouts = n(goal.bonusPerPayout) > 0 ? bonusPayoutsBefore(bonus, today, n(goal.targetYear), n(goal.targetMonth)) : 0;
  const bonusCover = Math.min(remaining, n(goal.bonusPerPayout) * bonusPayouts);
  const base = {
    target, saved, remaining, slots, contributed, bonusPayouts, bonusCover,
    progress: target > 0 ? Math.min(1, saved / target) : 0,
  };
  if (target <= 0) return { ...base, status: 'unset', monthly: 0, thisMonthAmount: contributedAmount };
  if (remaining === 0) return { ...base, status: 'done', monthly: 0, thisMonthAmount: contributedAmount };
  const fromMonthly = remaining - bonusCover;
  if (fromMonthly <= 0) return { ...base, status: 'active', monthly: 0, thisMonthAmount: contributedAmount };
  if (slots <= 0) return { ...base, status: diff < 0 ? 'overdue' : 'due', monthly: 0, thisMonthAmount: contributedAmount };
  const monthly = Math.ceil(fromMonthly / slots / 100) * 100;
  return { ...base, status: 'active', monthly, thisMonthAmount: contributed ? contributedAmount : monthly };
}

/** 今月の予算から差し引く、目的別の積立の合計 */
export const goalsMonthlyTotal = (goals, today = new Date(), bonus = null) => sum(goals, (g) => goalPlan(g, today, bonus).thisMonthAmount);

/* ---------- ボーナス（「別管理」のときの使い道） ---------- */

/**
 * ボーナスの予定。「別管理」で金額があるときだけ有効。
 * perPayout：1回あたりの手取り（年間 ÷ 支給回数）、received：受け取りを記録した月（YYYY-MM）
 */
export function bonusSchedule(profile) {
  const months = [...new Set((profile.bonusMonths ?? [6, 12]).map(n).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const active = profile.bonusMode !== 'monthly' && n(profile.bonus) > 0 && months.length > 0;
  return {
    active, months,
    perPayout: months.length ? n(profile.bonus) / months.length : 0,
    toSavings: n(profile.bonusPlan?.savings),
    received: profile.bonusReceived ?? [],
  };
}

/** 今月（受け取り済みなら来月）から、購入予定月の前月までに支給されるボーナスの回数 */
export function bonusPayoutsBefore(bonus, today, targetYear, targetMonth) {
  if (!bonus?.active) return 0;
  const end = monthIndex(targetYear, targetMonth); // この月は含めない
  let count = 0;
  for (let i = monthIndex(today.getFullYear(), today.getMonth() + 1); i < end; i++) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    if (!bonus.months.includes(m)) continue;
    if (bonus.received.includes(`${y}-${String(m).padStart(2, '0')}`)) continue;
    count += 1;
  }
  return count;
}

/** ボーナス1回分の使い道：貯金・目的別・残り（自由に使える） */
export function bonusAllocation(bonus, goals) {
  const toGoals = sum(goals, (g) => g.bonusPerPayout);
  const rest = bonus.perPayout - bonus.toSavings - toGoals;
  return { perPayout: bonus.perPayout, toSavings: bonus.toSavings, toGoals, rest };
}

/** 今月がボーナス月で、まだ受け取りを記録していないか */
export const bonusDueThisMonth = (bonus, today = new Date()) =>
  bonus.active && bonus.months.includes(today.getMonth() + 1) && !bonus.received.includes(toMonthKey(today));

/* ---------- 収入・固定費などの履歴（設定を変えた期間から反映） ---------- */

export const PLAN_HISTORY_KEYS = ['income', 'fixed', 'living', 'savings', 'investment'];

/** dateKey の時点で有効だった設定。履歴より前の期間は、いちばん古い記録で代用する */
export function planAt(history, dateKey) {
  let found = null;
  for (const h of history) if (h.from <= dateKey) found = h;
  return found ?? history[0] ?? null;
}

/**
 * 今の期間の初日（fromKey）から有効な設定として記録する。
 * 直前に有効だった設定と同じなら記録しない。同じ期間の記録は上書きする。
 */
export function upsertPlanSnapshot(history, fromKey, plan) {
  const values = Object.fromEntries(PLAN_HISTORY_KEYS.map((k) => [k, Math.round(n(plan[k]))]));
  const others = history.filter((h) => h.from !== fromKey);
  const prev = planAt(others.filter((h) => h.from < fromKey), fromKey);
  const same = prev && PLAN_HISTORY_KEYS.every((k) => n(prev[k]) === values[k]);
  return (same ? others : [...others, { from: fromKey, ...values }]).sort((a, b) => a.from.localeCompare(b.from));
}

/* ---------- 期間の締め：余ったお金・足りなかったお金 ---------- */

/**
 * 期間が終わったときの自由に使えるお金の残り。
 * 予算 ＝ その期間の設定（収入 − 固定費 − 生活費 − 貯蓄 − 積立投資）− 目的別に実際に積み立てた額 ＋ 前の期間からの繰り越し
 */
export function periodLeftover({ period, planBase, expenses, groupOf, goalsPaid = 0, carryIn = 0 }) {
  const p = planBase ?? { income: 0, fixed: 0, living: 0, savings: 0, investment: 0 };
  const list = expenses.filter((e) => inPeriod(period, e.date));
  const budget = n(p.income) - n(p.fixed) - n(p.living) - n(p.savings) - n(p.investment) - n(goalsPaid) + n(carryIn);
  const used = freeUsed(list, groupOf, n(p.living));
  return { budget, used, leftover: Math.round(budget - used), count: list.length };
}

/** 目的別の積立の記録のうち、期間内に毎月の積立として入れた合計（ボーナス・繰り越し分は除く） */
export const goalsPaidIn = (goalLog, period) =>
  sum(goalLog.filter((x) => x.source === 'monthly' && inPeriod(period, x.date)), (x) => x.amount);

/** 現在の貯金額のうち、目的別に取り分けている合計 */
export const earmarkedSavings = (goals) => sum(goals, (g) => g.saved);

/* ---------- 入力の手間を減らす・データを守る ---------- */

/**
 * よく使う支出（カテゴリ・店名・金額が同じ記録）を、直近 days 日の回数が多い順に返す。
 * minCount 回以上記録したものだけを候補にする。
 */
export function frequentEntries(expenses, today = new Date(), { days = 90, limit = 6, minCount = 2 } = {}) {
  const fromKey = toDateKey(addDays(today, -days));
  const map = new Map();
  for (const e of expenses) {
    if (e.date < fromKey) continue;
    const shop = (e.shop || '').trim();
    const key = `${e.category}\u0000${shop}\u0000${n(e.amount)}`;
    const cur = map.get(key) || { category: e.category, shop, amount: n(e.amount), count: 0, last: '' };
    cur.count += 1;
    if (e.date > cur.last) cur.last = e.date;
    map.set(key, cur);
  }
  return [...map.values()]
    .filter((x) => x.count >= minCount)
    .sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    .slice(0, limit);
}

/**
 * バックアップを促すかどうか。一度も取っていなければ使い始めて7日後、
 * 取っていれば前回から30日後に知らせる。「あとで」を押した場合は snoozedUntil まで出さない。
 */
export function backupReminder({ firstUsedAt, lastBackupAt, snoozedUntil } = {}, now = new Date(), { hasData = true } = {}) {
  const since = lastBackupAt || firstUsedAt;
  if (!hasData || !since) return null;
  if (snoozedUntil && now < new Date(snoozedUntil)) return null;
  const days = Math.floor((now - new Date(since)) / 86400000);
  if (days < (lastBackupAt ? 30 : 7)) return null;
  return { days, never: !lastBackupAt };
}

/* ---------- グラフ用の集計 ---------- */

/**
 * 直近 count 期間（給料日区切り）の収支。家計簿の記録が始まる前の期間は含めない。
 * 収入・固定費は履歴を持たないため、今の設定額で計算する。
 * 今の期間（current）は途中なので、貯蓄は「このペースで使った場合の見込み」を返す。
 */
export function periodHistory({ expenses, plan, planFor = () => plan, groupOf, payday = 1, today = new Date(), count = 6 }) {
  if (!expenses.length) return [];
  const firstKey = expenses.reduce((m, e) => (e.date < m ? e.date : m), expenses[0].date);
  const todayKey = toDateKey(today);
  const rows = [];
  for (let i = count - 1; i >= 0; i--) {
    const period = budgetPeriod(today, payday, -i);
    if (period.endKey < firstKey) continue;
    const list = expenses.filter((e) => inPeriod(period, e.date));
    const s = summarizeSpending(list, groupOf);
    const current = i === 0;
    let spendForSaving = s.total;
    if (current) {
      const soFar = sum(list.filter((e) => e.date <= todayKey), (e) => e.amount);
      spendForSaving = (soFar / (diffDays(period.start, today) + 1)) * period.days;
    }
    const p = planFor(period);
    rows.push({
      period, current,
      income: n(p.income), fixed: n(p.fixed), living: s.living, free: s.free, spent: s.total,
      saved: n(p.income) - n(p.fixed) - spendForSaving,
      planned: n(p.savings) + n(p.investment) + n(p.goals),
    });
  }
  return rows;
}

/** 0 を含むきりのよい目盛り（1・2・2.5・5 × 10^n 刻み） */
export function niceScale(lo, hi, count = 4) {
  const min = Math.min(0, lo);
  const max = Math.max(0, hi);
  if (max - min <= 0) return { min: 0, max: 1, ticks: [0] };
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const bottom = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = bottom; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { min: bottom, max: top, ticks };
}

/** 目盛り用の短い金額表記（例：120000 → 12万、25000 → 2.5万） */
export function compactYen(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 10000) return `${sign}${Math.round((a / 10000) * 10) / 10}万`;
  return `${sign}${Math.round(a).toLocaleString('ja-JP')}`;
}

/* ---------- 金額入力（カンマ区切り） ---------- */

/** 全角数字を半角に */
export const toHalfWidth = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 「300,000」「３０００００円」などを数値に。数字がなければ 0 */
export function parseMoney(s) {
  const digits = toHalfWidth(s).replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/** 入力中の文字列を「300,000」の形に整える。空欄は空欄のまま */
export function formatMoneyText(s) {
  const digits = toHalfWidth(s).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
  return digits ? Number(digits).toLocaleString('ja-JP') : '';
}

/* ---------- カレンダーのリマインダー（.ics） ---------- */

/** カレンダー形式の文字列：\ ; , を \ でエスケープし、改行は \n と書く */
const icsText = (t) => String(t).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
const icsDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/**
 * 給料日（毎月）とボーナス月（毎年）の朝9時に通知する予定を、カレンダーアプリに登録できる形式で作る。
 * サーバーを使わずに確実に通知するため、端末のカレンダーの通知機能を使う。
 */
export function reminderCalendar({ payday = 1, bonusMonths = [], today = new Date(), appUrl = '' }) {
  const day = Math.min(MAX_PAYDAY, Math.max(1, Math.round(n(payday)) || 1));
  const first = new Date(today.getFullYear(), today.getMonth() + (today.getDate() > day ? 1 : 0), day);
  const stamp = today.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const event = (uid, start, rrule, summary, description) => [
    'BEGIN:VEVENT',
    `UID:${uid}@my-money`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsDate(start)}T090000`,
    `DTEND:${icsDate(start)}T091500`,
    `RRULE:${rrule}`,
    `SUMMARY:${icsText(summary)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(appUrl ? [`URL:${appUrl}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(summary)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT',
  ];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//my-money//reminder//JA', 'CALSCALE:GREGORIAN',
    ...event('payday', first, `FREQ=MONTHLY;BYMONTHDAY=${day}`, 'my-money：給料日のチェック',
      '先月の余ったお金の行き先・目的別の積立・バックアップをアプリで確認しましょう。'),
  ];
  const months = [...new Set(bonusMonths.map(n))].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  if (months.length) {
    const next = months.map((m) => new Date(today.getFullYear() + (m < today.getMonth() + 1 || (m === today.getMonth() + 1 && today.getDate() > day) ? 1 : 0), m - 1, day))
      .sort((a, b) => a - b)[0];
    lines.push(...event('bonus', next, `FREQ=YEARLY;BYMONTH=${months.join(',')};BYMONTHDAY=${day}`, 'my-money：ボーナス月',
      'ボーナスを受け取ったら、アプリで「受け取った」を押して使い道を記録しましょう。'));
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function yen(v) {
  return Math.round(n(v)).toLocaleString('ja-JP') + '円';
}
