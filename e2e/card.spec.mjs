import { test, expect } from '@playwright/test';
import { openApp, baseData, nav, stored, typeMoney } from './helpers.mjs';

test('クレジットカード：請求額を入れると、引き落とし日の支出として「今月あと」から引かれる', async ({ page }) => {
  const data = baseData();
  data.budgets = data.budgets.map((b) => ({ ...b, monthlyLimit: 0 })); // カードで払うので生活費予算は0
  await openApp(page, { data, hash: '#/budget' });
  await page.getByRole('button', { name: 'クレジットカードの請求額を管理する' }).click();
  const card = page.locator('#card-section');
  await card.locator('[data-bind="profile.card.payDay"]').selectOption('27');
  await expect(card).toContainText('10月27日 引き落とし');

  // ホームの「今月のやること」から入れる（30万 − 固定費9.1万 − 貯蓄6万 ＝ 14.9万）
  await nav(page, 'ホーム');
  await expect(page.locator('.hero-value')).toHaveText('149,000円');
  const todo = page.locator('.todo-card');
  await typeMoney(todo.locator('[data-card-bill]'), '85000');
  await todo.getByRole('button', { name: '記録' }).click();
  await expect(page.locator('.hero-value')).toHaveText('64,000円');
  await expect(page.locator('.todo-card [data-card-bill]')).toHaveCount(0);

  const bill = (await stored(page, 'expenses')).find((e) => e.kind === 'cardBill');
  expect(bill).toMatchObject({ date: '2026-10-27', amount: 85000, category: 'card' });

  // 予算タブで直す
  await nav(page, '予算');
  await expect(card).toContainText('85,000円を記録済み');
  await typeMoney(card.locator('[data-card-bill]'), '90000');
  await card.getByRole('button', { name: '更新' }).click();
  expect((await stored(page, 'expenses')).filter((e) => e.kind === 'cardBill')).toHaveLength(1);
  await nav(page, 'ホーム');
  await expect(page.locator('.hero-value')).toHaveText('59,000円');
});

test('生活費予算があると二重になる注意を出し、ボタンで0円にできる', async ({ page }) => {
  const data = baseData();
  data.profile.card = { enabled: true, payDay: 10 };
  await openApp(page, { data, hash: '#/budget' });
  const card = page.locator('#card-section');
  await expect(card).toContainText('生活費予算（月65,000円）も設定されています');
  await card.getByRole('button', { name: '生活費予算を0円にする' }).click();
  expect((await stored(page, 'budgets')).every((b) => b.monthlyLimit === 0)).toBe(true);
  await expect(card).not.toContainText('も設定されています');
  await page.locator('#toast').getByRole('button', { name: '元に戻す' }).click();
  expect((await stored(page, 'budgets'))[0].monthlyLimit).toBe(40000);
});

test('固定費に「同居人への生活費」「車の保険」をワンタップで追加できる', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/budget' });
  await page.getByRole('button', { name: '＋ 同居人への生活費' }).click();
  await typeMoney(page.locator('[data-bind="fixedCosts.3.amount"]'), '50000');
  await page.getByRole('button', { name: '＋ 車の保険' }).click();
  await typeMoney(page.locator('[data-bind="fixedCosts.4.amount"]'), '8000');
  await expect(page.locator('#live-summary')).toContainText('−149,000円'); // 9.1万 + 5万 + 0.8万
  const names = (await stored(page, 'fixedCosts')).map((c) => c.name);
  expect(names).toEqual(expect.arrayContaining(['同居人への生活費', '車の保険']));
});
