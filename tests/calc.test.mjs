import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlyIncome, monthlyPlan, allowance, freeUsed, futureSavings, judgeSpend, futureInvestment, nisaCheck,
  allocate, weeklyOf, weekStartKey, historyAverages, suggestBudget, budgetAlerts,
  requiredMonthly, monthsToReach, formatMonths, incomeGrowth, householdHealth, fixedCostTips, savingEffect,
  budgetPeriod, periodLabel, frequentEntries, backupReminder,
  periodHistory, niceScale, compactYen, parseMoney, formatMoneyText,
  goalPlan, goalsMonthlyTotal, earmarkedSavings,
  bonusSchedule, bonusPayoutsBefore, bonusAllocation, bonusDueThisMonth, planAt, upsertPlanSnapshot,
  periodLeftover, goalsPaidIn, reminderCalendar, budgetPeriod as period, dayInPeriod, cardBillIn,
  cardCycle, latestCardUsage, cardUsageStatus, cardBillReview,
} from '../public/js/calc.js';

const groupOf = (id) => (['food', 'daily'].includes(id) ? 'living' : 'free');

test('ボーナスは毎月換算のときだけ収入に加算する', () => {
  const p = { takeHome: 300000, bonus: 600000, sideIncome: 10000, otherIncome: 0 };
  assert.equal(monthlyIncome({ ...p, bonusMode: 'separate' }), 310000);
  assert.equal(monthlyIncome({ ...p, bonusMode: 'monthly' }), 360000);
});

test('自由に使えるお金 = 収入 − 固定費 − 生活費予算 − 貯蓄 − 積立投資', () => {
  const plan = monthlyPlan({
    profile: { takeHome: 300000 },
    fixedCosts: [{ amount: 80000 }, { amount: 40000 }],
    budgets: [{ monthlyLimit: 50000 }, { monthlyLimit: 30000 }],
    simulation: { monthlySavings: 50000, monthlyInvestment: 20000 },
  });
  assert.deepEqual(plan, { income: 300000, fixed: 120000, living: 80000, savings: 50000, investment: 20000, goals: 0, free: 30000 });
});

test('生活費予算の超過分は自由費から差し引く', () => {
  const exps = [{ category: 'food', amount: 50000 }, { category: 'eatout', amount: 3000 }];
  assert.equal(freeUsed(exps, groupOf, 40000), 13000);
  assert.equal(freeUsed(exps, groupOf, 60000), 3000);
});

test('支出なし：30,000円・残り15日 → 1日2,000円', () => {
  // 2026-11-16（月）。11月は30日なので残り15日、今週は16〜22日の7日間
  const a = allowance({
    plan: { living: 0, free: 30000 },
    expenses: [],
    groupOf,
    today: new Date(2026, 10, 16),
  });
  assert.equal(a.daysLeft, 15);
  assert.equal(a.monthLeft, 30000);
  assert.equal(a.todayBudget, 2000);
  assert.equal(a.weekBudget, 14000);
});

test('週・日の残額は期間内の支出を引き、月をまたぐ週は今月分だけ', () => {
  // 2026-10-01 は木曜。週は 10/1〜10/4 の4日間
  const today = new Date(2026, 9, 2);
  const a = allowance({
    plan: { living: 10000, free: 31000 },
    expenses: [
      { date: '2026-10-01', category: 'eatout', amount: 1000 },
      { date: '2026-10-02', category: 'hobby', amount: 500 },
      { date: '2026-10-02', category: 'food', amount: 3000 }, // 生活費予算内なので自由費に影響しない
      { date: '2026-09-30', category: 'eatout', amount: 9999 }, // 先月分は無視
    ],
    groupOf,
    today,
  });
  assert.equal(a.monthLeft, 29500);
  assert.equal(a.weekBudget, 4000); // 31,000 × 4/31
  assert.equal(a.weekLeft, 2500);
  assert.equal(a.todayBudget, 1000); // (31,000 − 1,000) / 30日
  assert.equal(a.todayLeft, 500);
});

test('将来貯蓄：現在50万円・毎月5万円', () => {
  assert.equal(futureSavings(500000, 50000, 1), 1100000);
  assert.equal(futureSavings(500000, 50000, 5), 3500000);
  assert.equal(futureSavings(500000, 50000, 10), 6500000);
});

test('出費判定', () => {
  const a = { todayLeft: 1000, weekLeft: 7500, monthLeft: 20000 };
  assert.equal(judgeSpend(800, a).level, 'ok');
  assert.match(judgeSpend(2000, a).message, /今週あと7,500円使えるので問題ありません/);
  assert.equal(judgeSpend(10000, a).level, 'caution');
  assert.equal(judgeSpend(25000, a).level, 'over');
  assert.equal(judgeSpend(0, a), null);
});

test('積立投資：月3万円・年5%・20年 ≒ 1,233万円（元本720万円）', () => {
  const r = futureInvestment(0, 30000, 5, 20);
  assert.equal(r.principal, 7200000);
  assert.equal(Math.round(r.value / 10000), 1233);
  assert.equal(Math.round(r.gain), Math.round(r.value - r.principal));
});

test('積立投資：利回り0%なら元本のまま', () => {
  assert.deepEqual(futureInvestment(500000, 30000, 0, 1), { value: 860000, principal: 860000, gain: 0 });
});

test('NISA枠チェック', () => {
  assert.equal(nisaCheck(0), null);
  assert.equal(nisaCheck(100000).level, 'ok'); // 年120万円ちょうど
  assert.equal(nisaCheck(100001).level, 'caution'); // つみたて投資枠超え
  assert.equal(nisaCheck(300000).level, 'caution'); // 年360万円ちょうど
  assert.equal(nisaCheck(300001).level, 'over');
  assert.equal(nisaCheck(100000).monthsToLimit, 180); // 1,800万 ÷ 10万
  assert.equal(nisaCheck(100000, 6000000).monthsToLimit, 120);
  assert.equal(nisaCheck(500000).monthsToLimit, 60); // 枠は月30万円までしか埋まらない
  assert.match(nisaCheck(10000, 18000000).lifetimeMessage, /使い切っています/);
});

/* ---------- Phase 4 ---------- */

test('外食30%：自由予算4万円 → 月12,000円・週約2,769円', () => {
  const a = allocate(40000, { eatout: 30, hobby: 20, clothes: 0 });
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].monthly, 12000);
  assert.equal(Math.round(a.items[0].weekly), 2769);
  assert.equal(a.totalPercent, 50);
  assert.equal(a.unallocated, 20000);
  assert.equal(allocate(-5000, { eatout: 30 }).items[0].monthly, 0); // 赤字なら配分0
  assert.equal(weeklyOf(5200), 1200);
});

test('週の初日は月曜（月をまたいでもよい）', () => {
  assert.equal(weekStartKey(new Date(2026, 9, 13)), '2026-10-12'); // 火曜
  assert.equal(weekStartKey(new Date(2026, 9, 12)), '2026-10-12'); // 月曜
  assert.equal(weekStartKey(new Date(2026, 10, 1)), '2026-10-26'); // 日曜
});

test('実績平均は今月を除く直近3か月のうち記録がある月で割る', () => {
  const exps = [
    { date: '2026-10-05', category: 'food', amount: 99999 }, // 今月は除外
    { date: '2026-09-10', category: 'food', amount: 30000 },
    { date: '2026-08-10', category: 'food', amount: 50000 },
    { date: '2026-08-11', category: 'eatout', amount: 8000 },
    { date: '2026-06-01', category: 'food', amount: 99999 }, // 4か月前は除外
  ];
  const h = historyAverages(exps, new Date(2026, 9, 13));
  assert.equal(h.months, 2);
  assert.equal(h.byCategory.food, 40000);
  assert.equal(h.byCategory.eatout, 4000);
  assert.equal(historyAverages([], new Date(2026, 9, 13)), null);
});

test('予算の目安：手取り30万円（実績があれば実績優先、積立分は貯蓄から差し引く）', () => {
  const sg = suggestBudget(300000);
  assert.equal(sg.fixed, 120000);
  assert.equal(sg.living.food.amount, 40000);
  assert.equal(sg.living.daily.amount, 10000);
  assert.equal(sg.living.transport.amount, 10000);
  assert.equal(sg.savings, 70000);
  const withHist = suggestBudget(300000, { investment: 30000, history: { months: 2, byCategory: { food: 46400 } } });
  assert.deepEqual(withHist.living.food, { amount: 46000, source: 'history' });
  assert.equal(withHist.living.daily.source, 'ratio');
  assert.equal(withHist.savings, 40000);
});

test('使いすぎ警告：80%以上で「あと○円まで」、超過で調整の案内', () => {
  const al = budgetAlerts([
    { name: '外食', limit: 10000, used: 8500 },
    { name: '趣味', limit: 10000, used: 12000 },
    { name: '衣服', limit: 10000, used: 7900 },
    { name: '娯楽', limit: 0, used: 500 },
  ]);
  assert.equal(al.length, 2);
  assert.equal(al[0].message, '外食予算の85%を使いました。あと1,500円までなら予定内です。');
  assert.equal(al[1].level, 'over');
  assert.match(al[1].message, /2,000円超えました/);
});

/* ---------- Phase 5 ---------- */

test('目標逆算：10年後に1,000万円・現在100万円 → 月75,000円', () => {
  assert.equal(requiredMonthly(10000000, 1000000, 10), 75000);
  assert.equal(requiredMonthly(1000000, 2000000, 10), 0); // すでに達成
  // 運用ありだと必要額は減る（年5%）
  const withReturn = requiredMonthly(10000000, 1000000, 10, 5);
  assert.ok(withReturn < 75000 && withReturn > 50000);
  // 逆算した額で積み立てれば目標に届く
  assert.ok(Math.abs(futureInvestment(1000000, withReturn, 5, 10).value - 10000000) < 1);
});

test('目標到達までの月数', () => {
  const base = { currentSavings: 1000000, monthlySavings: 75000, currentInvestment: 0, monthlyInvestment: 0, annualReturn: 0 };
  assert.equal(monthsToReach(10000000, base), 120);
  assert.equal(monthsToReach(500000, base), 0);
  assert.equal(monthsToReach(10000000, { ...base, monthlySavings: 0 }), null);
  assert.equal(formatMonths(120), '10年');
  assert.equal(formatMonths(27), '2年3か月');
});

test('昇給：手取り30万円・年3% → 1年後309,000円、5年後約347,000円、10年後約403,000円', () => {
  const p = { base: 300000, growthPct: 3 };
  assert.equal(Math.round(incomeGrowth(p, 1).income), 309000);
  assert.equal(Math.round(incomeGrowth(p, 5).income / 1000), 348); // 347,782円
  assert.equal(Math.round(incomeGrowth(p, 10).income / 1000), 403);
  // 転職で月5万円増・昇給なし・増えた分を全額貯蓄 → 1年で60万円上乗せ
  assert.equal(incomeGrowth({ base: 300000, jobIncrease: 50000, saveShare: 100 }, 1).extraSavings, 600000);
  assert.equal(incomeGrowth({ base: 300000, jobIncrease: 50000, saveShare: 50 }, 2).extraSavings, 600000);
});

test('家計の状態判定', () => {
  const plan = (o) => ({ income: 300000, fixed: 90000, living: 60000, savings: 60000, investment: 30000, free: 60000, ...o });
  assert.equal(householdHealth(plan()).level, 'great'); // 貯蓄率30%・固定費率30%
  assert.equal(householdHealth(plan({ investment: 0, free: 90000 })).level, 'stable'); // 貯蓄率20%
  assert.equal(householdHealth(plan({ fixed: 130000, investment: 0, free: 50000 })).level, 'normal'); // 固定費率43%
  assert.equal(householdHealth(plan({ savings: 25000, investment: 0, free: 125000 })).level, 'warn'); // 貯蓄率8%
  const bad = householdHealth(plan({ free: -10000 }));
  assert.equal(bad.level, 'danger');
  assert.match(bad.reasons[0], /10,000円上回っています/);
  assert.equal(householdHealth({ income: 0 }), null);
});

test('固定費の見直しヒントは金額の大きいカテゴリ順', () => {
  const tips = fixedCostTips([
    { category: 'housing', name: '家賃', amount: 80000 },
    { category: 'telecom', name: 'スマホ代', amount: 8000 },
    { category: 'telecom', name: 'ネット代', amount: 5000 },
    { category: 'subscription', name: 'サブスク', amount: 3000 },
    { category: 'insurance', name: '保険', amount: 0 },
    { category: 'other', name: 'その他', amount: 99999 },
  ]);
  assert.deepEqual(tips.map((t) => t.category), ['housing', 'telecom', 'subscription']);
  assert.equal(tips[1].amount, 13000);
  assert.deepEqual(tips[1].names, ['スマホ代', 'ネット代']);
});

test('節約効果：外食2万→1.5万・サブスク5千→3千・携帯8千→4千 → 月11,000円', () => {
  const e = savingEffect([
    { current: 20000, after: 15000 },
    { current: 5000, after: 3000 },
    { current: 8000, after: 4000 },
    { current: 10000, after: null },
    { current: 10000, after: 12000 }, // 増額は対象外
  ]);
  assert.equal(e.monthly, 11000);
  assert.equal(e.yearly, 132000);
  assert.equal(e.tenYears, 1320000);
  assert.equal(e.tenYearsInvested, 1320000); // 利回り0%
});

/* ---------- 改善：給料日区切り・よく使う支出・バックアップ ---------- */

test('予算の1か月：給料日25日なら25日〜翌月24日', () => {
  const p = budgetPeriod(new Date(2026, 9, 14), 25); // 10/14
  assert.equal(p.startKey, '2026-09-25');
  assert.equal(p.endKey, '2026-10-24');
  assert.equal(p.days, 30);
  assert.equal(periodLabel(p), '9月25日〜10月24日');
  assert.equal(budgetPeriod(new Date(2026, 9, 25), 25).startKey, '2026-10-25'); // 給料日当日から新しい期間
  assert.equal(budgetPeriod(new Date(2026, 9, 24), 25).endKey, '2026-10-24');
  // 年またぎ・前後の期間
  assert.equal(budgetPeriod(new Date(2027, 0, 10), 25).startKey, '2026-12-25');
  assert.equal(budgetPeriod(new Date(2026, 9, 14), 25, -1).startKey, '2026-08-25');
  assert.equal(budgetPeriod(new Date(2026, 9, 14), 25, 3).endKey, '2027-01-24');
  // 給料日1日＝暦どおり（2月も末日まで）
  const feb = budgetPeriod(new Date(2027, 1, 10), 1);
  assert.deepEqual([feb.startKey, feb.endKey, feb.days], ['2027-02-01', '2027-02-28', 28]);
  assert.equal(periodLabel(feb), '2027年2月');
  assert.equal(budgetPeriod(new Date(2026, 9, 14), 31).payday, 28); // 29日以降は28日に丸める
});

test('給料日区切りで今月・今週・今日の残りを計算する', () => {
  // 10/23（金）、給料日25日 → 期間は 9/25〜10/24、残り2日。今週は 10/19（月）〜10/24（土）の6日間
  const a = allowance({
    plan: { living: 0, free: 30000 },
    expenses: [
      { date: '2026-09-24', category: 'eatout', amount: 9999 }, // 前の期間は無視
      { date: '2026-09-25', category: 'eatout', amount: 18000 },
      { date: '2026-10-22', category: 'hobby', amount: 2000 },
    ],
    groupOf,
    today: new Date(2026, 9, 23),
    payday: 25,
  });
  assert.equal(a.period.startKey, '2026-09-25');
  assert.equal(a.daysLeft, 2);
  assert.equal(a.monthLeft, 10000);
  assert.equal(a.todayBudget, 5000); // 残り10,000円 ÷ 2日
  assert.equal(a.weekBudget, 12000); // 週初めの残り12,000円 × 6日 / 6日
  assert.equal(a.weekLeft, 10000);
  assert.equal(a.dayOfMonth, 29);
  assert.equal(a.daysInMonth, 30);
});

test('実績平均も給料日区切りで集計する', () => {
  const exps = [
    { date: '2026-09-24', category: 'food', amount: 30000 }, // 8/25〜9/24 の期間
    { date: '2026-09-26', category: 'food', amount: 99999 }, // 今の期間（9/25〜）は除外
  ];
  const h = historyAverages(exps, new Date(2026, 9, 14), 3, 25);
  assert.equal(h.months, 1);
  assert.equal(h.byCategory.food, 30000);
});

test('よく使う支出：同じカテゴリ・店名・金額が2回以上、回数の多い順', () => {
  const today = new Date(2026, 9, 14);
  const e = (date, category, shop, amount) => ({ date, category, shop, amount });
  const list = frequentEntries([
    e('2026-10-01', 'food', 'コンビニ', 500), e('2026-10-05', 'food', 'コンビニ', 500), e('2026-10-10', 'food', 'コンビニ ', 500),
    e('2026-10-02', 'eatout', 'ラーメン', 900), e('2026-10-12', 'eatout', 'ラーメン', 900),
    e('2026-10-03', 'eatout', 'ラーメン', 1000), // 金額違いは別扱い・1回のみ
    e('2026-06-01', 'transport', 'バス', 230), e('2026-06-02', 'transport', 'バス', 230), // 90日より前
  ], today);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { category: 'food', shop: 'コンビニ', amount: 500, count: 3, last: '2026-10-10' });
  assert.equal(list[1].shop, 'ラーメン');
});

test('バックアップのお知らせ：未実施は7日後、実施済みは30日後、「あとで」中は出さない', () => {
  const now = new Date('2026-10-14T12:00:00');
  assert.equal(backupReminder({ firstUsedAt: '2026-10-10T00:00:00' }, now), null);
  assert.deepEqual(backupReminder({ firstUsedAt: '2026-10-01T00:00:00' }, now), { days: 13, never: true });
  assert.equal(backupReminder({ firstUsedAt: '2026-01-01T00:00:00', lastBackupAt: '2026-09-20T00:00:00' }, now), null);
  assert.equal(backupReminder({ firstUsedAt: '2026-01-01T00:00:00', lastBackupAt: '2026-09-01T00:00:00' }, now).days, 43);
  assert.equal(backupReminder({ firstUsedAt: '2026-10-01T00:00:00', snoozedUntil: '2026-10-20T00:00:00' }, now), null);
  assert.equal(backupReminder({ firstUsedAt: '2026-10-01T00:00:00' }, now, { hasData: false }), null);
});

/* ---------- グラフ・金額入力 ---------- */

test('期間ごとの収支：記録開始前の期間は除き、今の期間の貯蓄は見込みで出す', () => {
  const plan = { income: 300000, fixed: 100000, savings: 50000, investment: 10000 };
  const rows = periodHistory({
    expenses: [
      { date: '2026-08-10', category: 'food', amount: 40000 },
      { date: '2026-08-20', category: 'eatout', amount: 20000 },
      { date: '2026-10-01', category: 'food', amount: 7000 },
      { date: '2026-10-07', category: 'eatout', amount: 7000 },
    ],
    plan, groupOf, today: new Date(2026, 9, 14), count: 6,
  });
  assert.deepEqual(rows.map((r) => r.period.startKey), ['2026-08-01', '2026-09-01', '2026-10-01']);
  assert.deepEqual([rows[0].living, rows[0].free, rows[0].saved, rows[0].planned], [40000, 20000, 140000, 60000]);
  assert.equal(rows[1].spent, 0);
  assert.equal(rows[2].current, true);
  assert.equal(rows[2].saved, 300000 - 100000 - (14000 / 14) * 31); // 1日1,000円ペースで31日分
  assert.deepEqual(periodHistory({ expenses: [], plan, groupOf }), []);
});

test('目盛りはきりのよい数で、0 を含む', () => {
  assert.deepEqual(niceScale(0, 287000).ticks, [0, 100000, 200000, 300000]);
  assert.deepEqual(niceScale(0, 287000, 5).ticks, [0, 100000, 200000, 300000]);
  assert.deepEqual(niceScale(-30000, 90000), { min: -50000, max: 100000, ticks: [-50000, 0, 50000, 100000] });
  assert.deepEqual(niceScale(0, 0).ticks, [0]);
  assert.equal(compactYen(120000), '12万');
  assert.equal(compactYen(25000), '2.5万');
  assert.equal(compactYen(-50000), '−5万');
  assert.equal(compactYen(5000), '5,000');
});

test('金額入力：カンマ・全角数字・円を受け付ける', () => {
  assert.equal(parseMoney('300,000'), 300000);
  assert.equal(parseMoney('３００，０００円'), 300000);
  assert.equal(parseMoney(''), 0);
  assert.equal(formatMoneyText('300000'), '300,000');
  assert.equal(formatMoneyText('０１２３４'), '1,234');
  assert.equal(formatMoneyText('0'), '0');
  assert.equal(formatMoneyText('abc'), '');
});

/* ---------- 目的別の貯金 ---------- */

const today1014 = new Date(2026, 9, 14);
const car = (o = {}) => ({ name: '車', targetAmount: 1000000, targetYear: 2027, targetMonth: 4, saved: 400000, lastContributionMonth: null, lastContributionAmount: 0, ...o });

test('目的別の貯金：購入予定月の前月までの回数で逆算（運用益なし・100円単位で切り上げ）', () => {
  // 2026年10月 → 2027年4月購入：10〜3月の6回で残り60万円 → 月10万円
  const gp = goalPlan(car(), today1014);
  assert.deepEqual([gp.status, gp.slots, gp.remaining, gp.monthly, gp.thisMonthAmount], ['active', 6, 600000, 100000, 100000]);
  assert.equal(gp.progress, 0.4);
  // 割り切れない場合は切り上げ：残り10万円・3回 → 33,400円
  assert.equal(goalPlan(car({ targetAmount: 500000, targetYear: 2027, targetMonth: 1 }), today1014).monthly, 33400);
});

test('目的別の貯金：今月分を積み立て済みなら、今月は実際の額を差し引き、来月から数え直す', () => {
  const gp = goalPlan(car({ saved: 500000, lastContributionMonth: '2026-10', lastContributionAmount: 100000 }), today1014);
  assert.deepEqual([gp.status, gp.slots, gp.monthly, gp.thisMonthAmount], ['active', 5, 100000, 100000]);
  // 先月の積立は今月に影響しない
  assert.equal(goalPlan(car({ lastContributionMonth: '2026-09', lastContributionAmount: 99999 }), today1014).thisMonthAmount, 100000);
});

test('目的別の貯金：達成・期限切れ・未設定', () => {
  assert.equal(goalPlan(car({ saved: 1000000 }), today1014).status, 'done');
  assert.equal(goalPlan(car({ saved: 1000000 }), today1014).thisMonthAmount, 0);
  const due = goalPlan(car({ targetYear: 2026, targetMonth: 10 }), today1014); // 今月が購入予定月
  assert.deepEqual([due.status, due.monthly, due.remaining], ['due', 0, 600000]);
  assert.equal(goalPlan(car({ targetYear: 2026, targetMonth: 8 }), today1014).status, 'overdue');
  assert.equal(goalPlan(car({ targetAmount: 0 }), today1014).status, 'unset');
});

test('目的別の積立は自由に使えるお金から差し引き、貯蓄率にも含める', () => {
  const goals = [car(), car({ name: '家具', targetAmount: 200000, saved: 0, targetYear: 2027, targetMonth: 2 })]; // 月10万＋月5万
  assert.equal(goalsMonthlyTotal(goals, today1014), 150000);
  assert.equal(earmarkedSavings(goals), 400000);
  const plan = monthlyPlan({
    profile: { takeHome: 400000 }, fixedCosts: [{ amount: 100000 }], budgets: [{ monthlyLimit: 60000 }],
    simulation: { monthlySavings: 40000 }, goals,
  }, today1014);
  assert.equal(plan.goals, 150000);
  assert.equal(plan.free, 50000);
  assert.equal(Math.round(householdHealth(plan).savingsRate), 48); // (4万+15万) / 40万
  assert.equal(suggestBudget(300000, { goals: 30000 }).savings, 40000); // 貯蓄の目安からも差し引く
});

/* ---------- ボーナス・履歴・期間の締め・リマインダー ---------- */

const bonusProfile = (o = {}) => ({ bonus: 600000, bonusMode: 'separate', bonusMonths: [6, 12], bonusPlan: { savings: 100000 }, bonusReceived: [], ...o });

test('ボーナスの予定：別管理で金額があるときだけ有効、1回あたり＝年間÷回数', () => {
  const b = bonusSchedule(bonusProfile());
  assert.deepEqual([b.active, b.months, b.perPayout, b.toSavings], [true, [6, 12], 300000, 100000]);
  assert.equal(bonusSchedule(bonusProfile({ bonusMode: 'monthly' })).active, false);
  assert.equal(bonusSchedule(bonusProfile({ bonus: 0 })).active, false);
  assert.deepEqual(bonusSchedule({ bonus: 1, bonusMode: 'separate' }).months, [6, 12]); // 支給月の初期値
});

test('ボーナスの回数：今月から購入予定月の前月まで、受け取り済みの月は除く', () => {
  const b = bonusSchedule(bonusProfile());
  assert.equal(bonusPayoutsBefore(b, today1014, 2027, 4), 1); // 12月
  assert.equal(bonusPayoutsBefore(b, today1014, 2027, 12), 2); // 12月・6月（購入月の12月は含めない）
  assert.equal(bonusPayoutsBefore(b, new Date(2026, 11, 5), 2027, 4), 1); // 今月12月・未受取
  assert.equal(bonusPayoutsBefore({ ...b, received: ['2026-12'] }, new Date(2026, 11, 5), 2027, 4), 0);
  assert.equal(bonusPayoutsBefore({ ...b, active: false }, today1014, 2027, 12), 0);
});

test('目的別の逆算：ボーナスから入れる分を差し引いて毎月の額を出す', () => {
  const b = bonusSchedule(bonusProfile());
  // 残り60万円・6回。12月のボーナスから20万円 → 残り40万円を6回 → 月66,700円
  const gp = goalPlan(car({ bonusPerPayout: 200000 }), today1014, b);
  assert.deepEqual([gp.bonusPayouts, gp.bonusCover, gp.monthly], [1, 200000, 66700]);
  // ボーナスだけで足りるなら毎月の積立は不要
  const covered = goalPlan(car({ bonusPerPayout: 600000 }), today1014, b);
  assert.deepEqual([covered.status, covered.monthly, covered.bonusCover], ['active', 0, 600000]);
  // ボーナスを使わない設定なら今までどおり
  assert.equal(goalPlan(car(), today1014, b).monthly, 100000);
  // 毎月の予算から引く額もボーナス分だけ減る
  const plan = monthlyPlan({ profile: { takeHome: 300000, ...bonusProfile() }, fixedCosts: [], budgets: [], simulation: {}, goals: [car({ bonusPerPayout: 200000 })] }, today1014);
  assert.equal(plan.goals, 66700);
});

test('ボーナス1回分の使い道と、受け取り待ちの判定', () => {
  const b = bonusSchedule(bonusProfile());
  assert.deepEqual(bonusAllocation(b, [{ bonusPerPayout: 150000 }, {}]), { perPayout: 300000, toSavings: 100000, toGoals: 150000, rest: 50000 });
  assert.equal(bonusDueThisMonth(b, new Date(2026, 11, 10)), true);
  assert.equal(bonusDueThisMonth({ ...b, received: ['2026-12'] }, new Date(2026, 11, 10)), false);
  assert.equal(bonusDueThisMonth(b, today1014), false);
});

test('将来の貯金：ボーナスから貯金に回す年額も加える', () => {
  assert.equal(futureSavings(500000, 50000, 2, 200000), 500000 + 50000 * 24 + 400000);
});

test('設定の履歴：変えた期間から反映し、同じ値なら記録しない', () => {
  const v = (income, fixed = 100000) => ({ income, fixed, living: 0, savings: 0, investment: 0 });
  let h = upsertPlanSnapshot([], '2026-08-01', v(300000));
  h = upsertPlanSnapshot(h, '2026-09-01', v(300000)); // 変化なし
  assert.equal(h.length, 1);
  h = upsertPlanSnapshot(h, '2026-10-01', v(320000));
  h = upsertPlanSnapshot(h, '2026-10-01', v(330000)); // 同じ期間は上書き
  assert.deepEqual(h.map((x) => [x.from, x.income]), [['2026-08-01', 300000], ['2026-10-01', 330000]]);
  assert.equal(planAt(h, '2026-09-15').income, 300000);
  assert.equal(planAt(h, '2026-10-01').income, 330000);
  assert.equal(planAt(h, '2026-01-01').income, 300000); // 記録より前は最も古い記録で代用
  assert.equal(planAt([], '2026-01-01'), null);
});

test('期間ごとの収支は、その期間の設定で計算する', () => {
  const rows = periodHistory({
    expenses: [{ date: '2026-09-10', category: 'food', amount: 10000 }, { date: '2026-10-01', category: 'food', amount: 1 }],
    planFor: (p) => (p.startKey < '2026-10-01' ? { income: 250000, fixed: 90000, savings: 50000 } : { income: 300000, fixed: 100000, savings: 50000, goals: 20000 }),
    groupOf, today: today1014,
  });
  assert.deepEqual(rows.map((r) => [r.income, r.fixed, r.planned]), [[250000, 90000, 50000], [300000, 100000, 70000]]);
  assert.equal(rows[0].saved, 150000);
});

test('期間の締め：余ったお金＝その期間の予算 − 実際の積立 ＋ 繰り越し − 使った額', () => {
  const sep = period(new Date(2026, 8, 10), 1); // 2026年9月
  const planBase = { income: 300000, fixed: 100000, living: 50000, savings: 50000, investment: 0 };
  const expenses = [
    { date: '2026-09-05', category: 'eatout', amount: 30000 },
    { date: '2026-09-06', category: 'food', amount: 60000 }, // 生活費を1万円超過 → 自由費から
    { date: '2026-10-01', category: 'eatout', amount: 99999 }, // 別の期間
  ];
  const r = periodLeftover({ period: sep, planBase, expenses, groupOf, goalsPaid: 20000, carryIn: 5000 });
  assert.deepEqual(r, { budget: 85000, used: 40000, leftover: 45000, count: 2 });
  assert.equal(periodLeftover({ period: sep, planBase: null, expenses: [], groupOf }).leftover, 0);
  const log = [
    { date: '2026-09-25', amount: 20000, source: 'monthly' },
    { date: '2026-09-30', amount: 50000, source: 'bonus' },
    { date: '2026-10-02', amount: 7000, source: 'monthly' },
  ];
  assert.equal(goalsPaidIn(log, sep), 20000);
});

test('カレンダーのリマインダー：給料日の毎月・ボーナス月の毎年、朝9時に通知', () => {
  const ics = reminderCalendar({ payday: 25, bonusMonths: [12, 6], today: today1014 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261025T090000\r\nDTEND:20261025T091500\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=25\r\n/);
  assert.match(ics, /DTSTART:20261225T090000[\s\S]*RRULE:FREQ=YEARLY;BYMONTH=6,12;BYMONTHDAY=25/);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  // 給料日を過ぎていれば翌月から
  assert.match(reminderCalendar({ payday: 10, today: today1014 }), /DTSTART:20261110T090000/);
  assert.doesNotMatch(reminderCalendar({ payday: 10, today: today1014 }), /BYMONTH=/);
});

/* ---------- クレジットカード ---------- */

test('引き落とし日：期間の中の「毎月○日」、その月にない日は月末', () => {
  assert.equal(dayInPeriod(period(new Date(2026, 9, 14), 1), 27), '2026-10-27');
  assert.equal(dayInPeriod(period(new Date(2026, 9, 14), 25), 27), '2026-09-27'); // 9/25〜10/24 の期間
  assert.equal(dayInPeriod(period(new Date(2026, 9, 14), 25), 10), '2026-10-10');
  assert.equal(dayInPeriod(period(new Date(2027, 1, 10), 1), 31), '2027-02-28'); // 2月は月末
  assert.equal(dayInPeriod(period(new Date(2026, 9, 14), 25), 31), '2026-09-30');
});

test('期間内のカードの請求額の記録を探す', () => {
  const list = [
    { id: 'a', date: '2026-09-27', kind: 'cardBill', amount: 80000 },
    { id: 'b', date: '2026-10-27', kind: 'cardBill', amount: 90000 },
    { id: 'c', date: '2026-10-05', category: 'card', amount: 1 }, // 請求額ではない記録
  ];
  assert.equal(cardBillIn(list, period(new Date(2026, 9, 14), 1)).id, 'b');
  assert.equal(cardBillIn(list, period(new Date(2026, 8, 14), 1)).id, 'a');
  assert.equal(cardBillIn(list, period(new Date(2026, 7, 14), 1)), null);
});

test('カードの利用サイクル：締め日で区切り、請求は翌月の引き落とし日', () => {
  const t = new Date(2026, 9, 19);
  const eom = cardCycle(t, 31, 27); // 月末締め・翌月27日払い
  assert.deepEqual([eom.startKey, eom.endKey, eom.days, eom.payKey], ['2026-10-01', '2026-10-31', 31, '2026-11-27']);
  const mid = cardCycle(t, 15, 10); // 15日締め・翌月10日払い
  assert.deepEqual([mid.startKey, mid.endKey, mid.payKey], ['2026-10-16', '2026-11-15', '2026-12-10']);
  assert.equal(cardCycle(new Date(2026, 9, 15), 15, 10).endKey, '2026-10-15'); // 締め日当日はそのサイクル
  const feb = cardCycle(new Date(2027, 1, 10), 31, 31); // 2月は月末＝28日
  assert.deepEqual([feb.startKey, feb.endKey, feb.payKey], ['2027-02-01', '2027-02-28', '2027-03-31']);
  assert.equal(cardCycle(new Date(2026, 11, 20), 31, 27).payKey, '2027-01-27'); // 年またぎ
});

test('カードの利用額：最後に入れた額から、あと使える額・1日あたり・請求見込みを出す', () => {
  const t = new Date(2026, 9, 19);
  const cycle = cardCycle(t, 31, 27);
  const usage = [
    { id: 'a', date: '2026-09-30', amount: 99999 }, // 前のサイクル
    { id: 'b', date: '2026-10-10', amount: 40000 },
    { id: 'c', date: '2026-10-19', amount: 76000 },
  ];
  const latest = latestCardUsage(usage, cycle);
  assert.equal(latest.id, 'c');
  const st = cardUsageStatus({ cycle, limit: 150000, latest, today: t });
  assert.deepEqual([st.used, st.remaining, st.daysLeft, st.projected], [76000, 74000, 13, 124000]); // 76,000 ÷ 19日 × 31日
  assert.equal(Math.round(st.perDay), 5692);
  const none = cardUsageStatus({ cycle, limit: 150000, latest: latestCardUsage([], cycle), today: t });
  assert.deepEqual([none.entered, none.remaining, none.projected], [false, 150000, null]);
  assert.equal(cardUsageStatus({ cycle, limit: 50000, latest, today: t }).perDay, 0); // 使いすぎ
});

test('請求額のふり返り：直前3回の平均と比べる', () => {
  const bills = [
    { date: '2026-07-27', amount: 70000 }, { date: '2026-08-27', amount: 80000 },
    { date: '2026-09-27', amount: 90000 }, { date: '2026-06-27', amount: 999999 }, // 4回前は使わない
  ];
  const up = cardBillReview(bills, { date: '2026-10-27', amount: 99000 });
  assert.deepEqual([up.avg, up.diff, up.level, up.count], [80000, 19000, 'up', 3]);
  assert.equal(cardBillReview(bills, { date: '2026-10-27', amount: 70000 }).level, 'down');
  assert.equal(cardBillReview(bills, { date: '2026-10-27', amount: 82000 }).level, 'same');
  assert.equal(cardBillReview([], { date: '2026-10-27', amount: 1 }), null);
  assert.equal(cardBillReview(bills, null), null);
});
