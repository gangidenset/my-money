import { test, expect } from '@playwright/test';
import { openApp, baseData, nav, stored, typeMoney } from './helpers.mjs';

test('はじめて：手取りと家賃を入れて目安を使うと、今月あといくら使えるかが出る', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'はじめに' })).toBeVisible();
  await page.getByRole('link', { name: '収入・固定費を入力する' }).click();

  const takeHome = page.locator('[data-bind="profile.takeHome"]');
  await typeMoney(takeHome, '300000');
  await expect(takeHome).toHaveValue('300,000'); // 入力中もカンマ区切り
  await typeMoney(page.locator('[data-bind="fixedCosts.0.amount"]'), '80000');
  await page.getByRole('button', { name: '未入力の項目に目安を入れる' }).click();

  // 30万 − 家賃8万 − 生活費6万（食費4万・日用品1万・交通費1万）− 貯蓄7万 ＝ 9万
  await expect(page.locator('#live-summary')).toContainText('90,000円');
  await nav(page, 'ホーム');
  await expect(page.locator('.hero-value')).toHaveText('90,000円');
  expect((await stored(page, 'profile')).takeHome).toBe(300000);
});

test('給料日を25日にすると、次の給料日までの日数で計算する', async ({ page }) => {
  await openApp(page, { data: baseData() });
  await expect(page.locator('.hero-sub')).toHaveText('月末まで残り18日');
  await nav(page, '予算');
  await page.locator('[data-bind="profile.payday"]').selectOption('25');
  await nav(page, 'ホーム');
  await expect(page.locator('.hero-sub')).toHaveText('次の給料日（10/25）まで残り11日');
  await expect(page.locator('.hero-value')).toHaveText('84,000円');
});

test('この出費、大丈夫？：今週の予算で判定する', async ({ page }) => {
  await openApp(page, { data: baseData() });
  await typeMoney(page.locator('#check-amount'), '2000');
  await expect(page.locator('#check-amount')).toHaveValue('2,000');
  await expect(page.locator('#check-result')).toContainText('今日の目安内です');
});

test('目的別の貯金：逆算・積立・購入済み・元に戻す', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/budget' });
  await page.getByRole('button', { name: '＋ 🛋️ 家具・家電' }).click();
  await typeMoney(page.locator('[data-bind="goals.0.targetAmount"]'), '200000');
  await page.locator('[data-bind="goals.0.targetYear"]').selectOption('2027');
  await page.locator('[data-bind="goals.0.targetMonth"]').selectOption('2');

  const goal = page.locator('.goal').first();
  await expect(goal).toContainText('毎月 50,000円'); // 10〜1月の4回で20万円
  await expect(page.locator('#live-summary')).toContainText('34,000円'); // 8.4万 − 5万

  await goal.getByRole('button', { name: '今月分を積み立てた（+50,000円）' }).click();
  await expect(goal).toContainText('今月分（50,000円）は積み立て済みです');
  expect((await stored(page, 'goals'))[0].saved).toBe(50000);

  page.once('dialog', (d) => d.accept());
  await goal.getByText('設定を変更').click();
  await goal.getByRole('button', { name: '購入済みにする' }).click();
  await expect(page.locator('.goal')).toHaveCount(0);
  expect((await stored(page, 'profile')).currentSavings).toBe(450000);

  await page.locator('#toast').getByRole('button', { name: '元に戻す' }).click();
  await expect(page.locator('.goal')).toHaveCount(1);
  expect((await stored(page, 'profile')).currentSavings).toBe(500000);
});
