import { test, expect } from '@playwright/test';
import { openApp, baseData, expense, nav, stored, typeMoney } from './helpers.mjs';

test('支出を記録すると、ホームの残りと最近の支出に反映される', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/ledger' });
  await typeMoney(page.locator('#entry-amount'), '1200');
  await page.locator('[data-action="pick-category"][data-id="eatout"]').click();
  await page.locator('#entry-shop').fill('○○ラーメン');
  await page.getByRole('button', { name: '記録する' }).click();
  await expect(page.locator('#entry-msg')).toContainText('1,200円を記録しました');

  await nav(page, 'ホーム');
  await expect(page.locator('.hero-value')).toHaveText('82,800円'); // 8.4万 − 外食1,200円
  await expect(page.locator('.exp-list')).toContainText('○○ラーメン');
});

test('支出の編集と、削除の取り消し', async ({ page }) => {
  const data = baseData();
  data.expenses = [expense('e1', '2026-10-13', 'hobby', 3000, '本屋')];
  await openApp(page, { data, hash: '#/ledger' });

  await page.getByRole('button', { name: '3,000円の支出を編集' }).click();
  await expect(page.getByRole('heading', { name: '✏️ 支出を編集' })).toBeVisible();
  await typeMoney(page.locator('#entry-amount'), '2500');
  await page.getByRole('button', { name: '更新する' }).click();
  expect((await stored(page, 'expenses'))[0].amount).toBe(2500);

  await page.getByRole('button', { name: '2,500円の支出を削除' }).click();
  await expect(page.locator('#toast')).toContainText('削除しました');
  expect(await stored(page, 'expenses')).toHaveLength(0);
  await page.locator('#toast').getByRole('button', { name: '元に戻す' }).click();
  expect(await stored(page, 'expenses')).toHaveLength(1);
  await expect(page.locator('.exp-list')).toContainText('本屋');
});

test('よく使う支出はワンタップで記録でき、取り消せる', async ({ page }) => {
  const data = baseData();
  data.expenses = [expense('a', '2026-10-02', 'food', 500, 'コンビニ'), expense('b', '2026-10-09', 'food', 500, 'コンビニ')];
  await openApp(page, { data, hash: '#/ledger' });

  await page.locator('.quick-btn', { hasText: 'コンビニ' }).click();
  await expect(page.locator('#toast')).toContainText('コンビニ 500円を記録');
  const after = await stored(page, 'expenses');
  expect(after).toHaveLength(3);
  expect(after.at(-1).date).toBe('2026-10-14');

  await page.locator('#toast').getByRole('button', { name: '取り消す' }).click();
  expect(await stored(page, 'expenses')).toHaveLength(2);
});

test('グラフ：カテゴリ別・月ごとの収支・残ったお金を表示し、タップで内訳が出る', async ({ page }) => {
  const data = baseData();
  data.expenses = [
    expense('a', '2026-08-10', 'food', 40000), expense('b', '2026-08-20', 'eatout', 20000),
    expense('c', '2026-09-10', 'food', 30000), expense('d', '2026-10-05', 'hobby', 3000),
  ];
  await openApp(page, { data, hash: '#/ledger' });
  await page.getByRole('tab', { name: '📊 グラフ' }).click();

  const cards = page.locator('.chart-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('趣味');
  await expect(cards.nth(1).locator('.col')).toHaveCount(3); // 記録を始めた8月から今月まで

  await cards.nth(2).locator('.col').first().click();
  // 8月：30万 − 固定費9.1万 − 支出6万 ＝ 14.9万
  await expect(page.locator('.chart-tip')).toContainText('149,000円');

  await cards.nth(1).getByText('表で見る').click();
  await expect(cards.nth(1).locator('table')).toContainText('149,000円');
});
