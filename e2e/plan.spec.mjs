import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, baseData, expense, nav, stored, typeMoney } from './helpers.mjs';

const toast = (page) => page.locator('#toast');

/** 9月から使っていて、9月に外食を amount 円使ったデータ（9月の自由に使えるお金は 8.4万円） */
const septemberData = (amount) => {
  const data = baseData();
  data.meta = { firstUsedAt: '2026-09-01T00:00:00.000Z' };
  data.expenses = [expense('s1', '2026-09-10', 'eatout', amount)];
  return data;
};

test('先月の余ったお金：今月に繰り越すと「今月あと」が増え、取り消せる', async ({ page }) => {
  await openApp(page, { data: septemberData(30000) });
  const todo = page.locator('.todo-card');
  await expect(todo).toContainText('54,000円'); // 8.4万 − 外食3万
  await todo.getByRole('button', { name: '今月に繰り越す' }).click();
  await expect(page.locator('.hero-value')).toHaveText('138,000円');
  await expect(page.locator('.flow')).toContainText('先月からの繰り越し');
  expect((await stored(page, 'settlements'))['2026-09-01']).toMatchObject({ action: 'carry', amount: 54000 });

  await toast(page).getByRole('button', { name: '取り消す' }).click();
  await expect(page.locator('.hero-value')).toHaveText('84,000円');
  await expect(page.locator('.todo-card')).toContainText('54,000円');
});

test('先月の余ったお金を目的別の貯金に入れると、残高と貯金額が増える', async ({ page }) => {
  const data = septemberData(30000);
  data.goals = [{ id: 'g1', name: '車', icon: '🚗', targetAmount: 1000000, targetYear: 2027, targetMonth: 4, saved: 0 }];
  await openApp(page, { data });
  await page.locator('#settle-goal').selectOption('g1');
  await page.getByRole('button', { name: '目的別へ入れる' }).click();
  await expect(toast(page)).toContainText('車に54,000円入れました');
  expect((await stored(page, 'goals'))[0].saved).toBe(54000);
  expect((await stored(page, 'profile')).currentSavings).toBe(554000);
  expect((await stored(page, 'goalLog')).at(-1)).toMatchObject({ goalId: 'g1', amount: 54000, source: 'leftover' });
  await expect(page.locator('.todo-card .settle')).toHaveCount(0);
});

test('先月に使いすぎた分を、貯金から補てんした記録にする', async ({ page }) => {
  await openApp(page, { data: septemberData(100000) });
  await expect(page.locator('.todo-card')).toContainText('予定より16,000円多く使いました');
  await page.getByRole('button', { name: '貯金から補てんした' }).click();
  expect((await stored(page, 'profile')).currentSavings).toBe(484000);
});

test('ボーナス：使い道を決めると目的別の積立額が減り、受け取りを記録できる', async ({ page }) => {
  const data = baseData();
  Object.assign(data.profile, { bonus: 600000, bonusMode: 'separate', bonusMonths: [6, 12], bonusPlan: { savings: 50000 } });
  data.goals = [{ id: 'g1', name: '車', icon: '🚗', targetAmount: 1000000, targetYear: 2027, targetMonth: 4, saved: 400000, bonusPerPayout: 200000 }];
  await openApp(page, { data, hash: '#/budget', now: new Date('2026-12-05T10:00:00+09:00') });

  const goal = page.locator('.goal').first();
  // 12〜3月の4回。残り60万 − ボーナス20万 ＝ 40万 → 月10万
  await expect(goal).toContainText('毎月 100,000円');
  await expect(goal).toContainText('うちボーナスから 200,000円（1回）');
  const card = page.locator('#bonus-card');
  await expect(card.locator('.total')).toContainText('50,000円'); // 30万 − 貯金5万 − 車20万

  await card.getByRole('button', { name: '今月のボーナスを受け取った（割り振りを記録）' }).click();
  await expect(toast(page)).toContainText('貯金へ50,000円・目的別へ200,000円');
  expect((await stored(page, 'goals'))[0].saved).toBe(600000);
  const profile = await stored(page, 'profile');
  expect(profile.currentSavings).toBe(750000);
  expect(profile.bonusReceived).toContain('2026-12');
  await expect(page.locator('#bonus-card').getByRole('button', { name: /受け取った/ })).toHaveCount(0);

  await toast(page).getByRole('button', { name: '取り消す' }).click();
  expect((await stored(page, 'goals'))[0].saved).toBe(400000);
  expect((await stored(page, 'profile')).currentSavings).toBe(500000);
});

test('ボーナスの支給月をすべて外しても、選び直せる', async ({ page }) => {
  const data = baseData();
  Object.assign(data.profile, { bonus: 600000, bonusMode: 'separate' });
  await openApp(page, { data, hash: '#/budget' });
  const card = page.locator('#bonus-card');
  await card.getByRole('button', { name: '6月' }).click();
  await card.getByRole('button', { name: '12月' }).click();
  await expect(card).toContainText('支給月を選んでください');
  await card.getByRole('button', { name: '7月' }).click();
  await expect(card).toContainText('7月に、1回あたり600,000円');
  expect((await stored(page, 'profile')).bonusMonths).toEqual([7]);
});

test('収入を変えると今の期間から反映し、過去の月のグラフは以前の収入のまま', async ({ page }) => {
  const data = baseData();
  data.expenses = [expense('a', '2026-09-10', 'food', 30000), expense('b', '2026-10-05', 'food', 1000)];
  await openApp(page, { data, hash: '#/budget' });
  await typeMoney(page.locator('[data-bind="profile.takeHome"]'), '320000');
  await nav(page, '家計簿');
  await page.getByRole('tab', { name: '📊 グラフ' }).click();
  const flow = page.locator('.chart-card').nth(1);
  await flow.getByText('表で見る').click();
  const rows = flow.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('300,000円'); // 9月
  await expect(rows.nth(1)).toContainText('320,000円'); // 10月
  expect((await stored(page, 'planHistory')).at(-1)).toMatchObject({ from: '2026-10-01', income: 320000 });
});

test('今月のやること：まだ積み立てていない目的別の貯金をホームから記録できる', async ({ page }) => {
  const data = baseData();
  data.goals = [{ id: 'g1', name: '家具', icon: '🛋️', targetAmount: 200000, targetYear: 2027, targetMonth: 2, saved: 0 }];
  await openApp(page, { data });
  const todo = page.locator('.todo-card');
  await expect(todo).toContainText('🛋️ 家具 50,000円');
  await todo.getByRole('button', { name: '積み立てた' }).click();
  await expect(toast(page)).toContainText('家具に50,000円積み立てました');
  await expect(page.locator('.todo-card')).toHaveCount(0);
  expect((await stored(page, 'goalLog'))[0]).toMatchObject({ goalId: 'g1', amount: 50000, source: 'monthly', date: '2026-10-14' });
});

test('給料日のお知らせをカレンダー形式で保存できる', async ({ page }) => {
  const data = baseData();
  data.profile.payday = 25;
  await openApp(page, { data, hash: '#/settings' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'カレンダーに登録する' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('my-money-reminder.ics');
  const ics = await readFile(await file.path(), 'utf8');
  expect(ics).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=25');
  expect(ics).toContain('DTSTART:20261025T090000');
});
