import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlyIncome, monthlyPlan, allowance, freeUsed, futureSavings, judgeSpend, futureInvestment, nisaCheck,
  allocate, weeklyOf, weekStartKey, historyAverages, suggestBudget, budgetAlerts,
  requiredMonthly, monthsToReach, formatMonths, incomeGrowth, householdHealth, fixedCostTips, savingEffect,
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
  assert.deepEqual(plan, { income: 300000, fixed: 120000, living: 80000, savings: 50000, investment: 20000, free: 30000 });
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
