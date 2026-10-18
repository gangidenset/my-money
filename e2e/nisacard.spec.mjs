import { test, expect } from '@playwright/test';
import { openApp, baseData, nav, stored, typeMoney } from './helpers.mjs';

/** 手取り25万・固定費5.8万・貯蓄4万・NISA積立3万（カード払い）→ 自由に使えるお金 12.2万 */
const nisaCardUser = (mode = 'card') => {
  const data = baseData();
  data.profile = { takeHome: 250000, currentSavings: 300000, card: { enabled: true, payDay: 27, closingDay: 31, budget: 0 }, display: { mode } };
  data.fixedCosts = [
    { id: 'f1', category: 'other', name: '同居人への生活費', amount: 50000 },
    { id: 'f2', category: 'car', name: '車の保険', amount: 8000 },
  ];
  data.budgets = data.budgets.map((b) => ({ ...b, monthlyLimit: 0 }));
  data.simulation = { monthlySavings: 40000, monthlyInvestment: 30000 };
  return data;
};

test('NISAをカードで積み立てている：請求額の積立分は二重に引かれない', async ({ page }) => {
  await openApp(page, { data: nisaCardUser('standard'), hash: '#/budget' });
  await page.getByRole('checkbox', { name: 'クレジットカードで積み立てている' }).check();
  await expect(page.locator('#toast')).toContainText('積立分を分けて計算します');
  expect((await stored(page, 'simulation')).investViaCard).toBe(true);

  const card = page.locator('#card-section');
  await expect(card).toContainText('うち積立投資の30,000円は「積立投資」として計算します');
  await typeMoney(card.locator('[data-card-bill]'), '120000');
  await card.getByRole('button', { name: '記録', exact: true }).click();
  await expect(card).toContainText('うち積立30,000円・買い物90,000円');
  expect((await stored(page, 'expenses')).find((e) => e.kind === 'cardBill')).toMatchObject({ amount: 120000, investPart: 30000 });

  // 自由に使えるお金 12.2万 − 買い物 9万 ＝ 3.2万（積立3万は上で1回だけ引いている）
  await nav(page, 'ホーム');
  await expect(page.locator('.hero-value')).toHaveText('32,000円');
  await expect(page.locator('.flow')).toContainText('請求120,000円のうち積立30,000円は上の積立投資で計算済み');
});

test('NISAをカードで積み立てている：利用額から積立分を除いて「カードであと」を出す', async ({ page }) => {
  const data = nisaCardUser('card');
  data.simulation.investViaCard = true;
  await openApp(page, { data, now: new Date('2026-10-19T10:00:00+09:00') });
  const usage = page.locator('#card-usage-card');
  await typeMoney(usage.locator('[data-card-usage]'), '76000');
  await usage.getByRole('button', { name: '更新' }).click();
  // 上限12.2万 −（利用7.6万 − 積立3万）＝ 7.6万
  await expect(page.locator('.hero-value')).toHaveText('76,000円');
  await expect(page.locator('.advice')).toContainText('利用額のうち積立30,000円は除いて計算しています');
  // 請求見込み ＝ 買い物 4.6万 ÷ 19日 × 31日（75,053円）＋ 積立3万
  await expect(page.locator('.stat-grid')).toContainText('105,053円');
});
