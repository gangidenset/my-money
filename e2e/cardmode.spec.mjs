import { test, expect } from '@playwright/test';
import { openApp, baseData, expense, nav, stored, typeMoney } from './helpers.mjs';

/** 手取り25万・固定費（同居人5万・車の保険0.8万）・貯蓄4万 → 自由に使えるお金 15.2万 */
const cardUser = () => {
  const data = baseData();
  data.profile = { takeHome: 250000, currentSavings: 300000, card: { enabled: true, payDay: 27, closingDay: 31, budget: 0 } };
  data.fixedCosts = [
    { id: 'f1', category: 'other', name: '同居人への生活費', amount: 50000 },
    { id: 'f2', category: 'car', name: '車の保険', amount: 8000 },
  ];
  data.simulation = { monthlySavings: 40000 };
  return data;
};

test('カード中心の表示に切り替えると、使わない機能が隠れ、生活費予算が0円になる', async ({ page }) => {
  const data = cardUser();
  await openApp(page, { data, hash: '#/settings' });
  await page.getByRole('radio', { name: 'カード中心' }).click();
  await expect(page.locator('#toast')).toContainText('生活費予算を0円にしました');
  expect((await stored(page, 'budgets')).every((b) => b.monthlyLimit === 0)).toBe(true);
  await expect(page.getByRole('heading', { name: /カテゴリを追加/ })).toHaveCount(0);

  await nav(page, 'ホーム');
  await expect(page.locator('.hero-label')).toContainText('カードであと');
  await expect(page.locator('.hero-value')).toHaveText('152,000円');
  await expect(page.getByRole('heading', { name: /この出費、大丈夫？/ })).toHaveCount(0);
  await expect(page.locator('.fab')).toHaveCount(0);

  await nav(page, '予算');
  await expect(page.getByRole('heading', { name: /生活費予算/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /自由に使えるお金の使い道/ })).toHaveCount(0);

  // 画面右上の「?」の一覧からも隠した機能を外す
  await nav(page, 'ホーム');
  await page.getByRole('button', { name: 'この画面の使い方' }).click();
  await expect(page.locator('#guide')).toContainText('カードの利用額');
  await expect(page.locator('#guide')).not.toContainText('この出費、大丈夫？');
});

test('カードの利用額を入れると、あと使える額・1日あたり・請求見込みが出る', async ({ page }) => {
  const data = cardUser();
  data.profile.display = { mode: 'card' };
  data.budgets = data.budgets.map((b) => ({ ...b, monthlyLimit: 0 }));
  await openApp(page, { data, now: new Date('2026-10-19T10:00:00+09:00') });
  await expect(page.locator('.advice')).toContainText('今月の利用額を見て');

  const usage = page.locator('#card-usage-card');
  await expect(usage).toContainText('10/1〜10/31の利用分（11/27に引き落とし）');
  await typeMoney(usage.locator('[data-card-usage]'), '76000');
  await usage.getByRole('button', { name: '更新' }).click();

  await expect(page.locator('.hero-value')).toHaveText('76,000円'); // 15.2万 − 7.6万
  await expect(page.locator('.stat-grid')).toContainText('124,000円'); // 7.6万 ÷ 19日 × 31日
  await expect(page.locator('.stat-grid')).toContainText('5,846円'); // 7.6万 ÷ 残り13日
  await expect(page.locator('.advice')).toContainText('上限内に収まる見込み');
  expect(await stored(page, 'cardUsage')).toMatchObject([{ date: '2026-10-19', amount: 76000 }]);

  // 同じ日に入れ直すと上書き
  await typeMoney(usage.locator('[data-card-usage]'), '120000');
  await usage.getByRole('button', { name: '更新' }).click();
  expect(await stored(page, 'cardUsage')).toHaveLength(1);
  await expect(page.locator('.advice')).toContainText('上限を');
});

test('自分で決めた上限を使い、請求額は過去の平均と比べる', async ({ page }) => {
  const data = cardUser();
  data.profile.card.budget = 100000;
  data.expenses = [
    expense('b7', '2026-07-27', 'card', 70000), expense('b8', '2026-08-27', 'card', 80000), expense('b9', '2026-09-27', 'card', 90000),
  ].map((e) => ({ ...e, kind: 'cardBill' }));
  await openApp(page, { data, hash: '#/budget' });
  const card = page.locator('#card-section');
  await typeMoney(card.locator('[data-card-bill]'), '99000');
  await card.getByRole('button', { name: '記録', exact: true }).click();
  await expect(card.locator('.card-review')).toContainText('過去3回の平均（80,000円）より19,000円（24%）多く');

  await nav(page, 'ホーム');
  await expect(page.locator('#card-usage-card')).toContainText('上限 100,000円');
  await expect(page.locator('.flow')).toContainText('カード代を払ったあとに残るお金');

  await nav(page, '家計簿');
  await page.getByRole('tab', { name: '📊 グラフ' }).click();
  await expect(page.locator('.chart-card', { hasText: 'カードの請求額の推移' })).toContainText('平均 84,750円');
});
