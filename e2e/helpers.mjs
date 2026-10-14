import { expect } from '@playwright/test';

/** テストは「2026年10月14日（水）10時」に固定して動かす */
export const NOW = new Date('2026-10-14T10:00:00+09:00');

const PREFIX = 'mymoney:v1:';

/** 手取り30万円・固定費9.1万円・生活費6.5万円・貯蓄6万円 → 自由に使えるお金 8.4万円 */
export const baseData = () => ({
  profile: { takeHome: 300000, currentSavings: 500000, bonusMode: 'separate' },
  fixedCosts: [
    { id: 'f1', category: 'housing', name: '家賃', amount: 80000 },
    { id: 'f2', category: 'telecom', name: 'スマホ代', amount: 5000 },
    { id: 'f3', category: 'utility', name: '電気代', amount: 6000 },
  ],
  budgets: [
    { category: 'food', monthlyLimit: 40000 },
    { category: 'daily', monthlyLimit: 10000 },
    { category: 'transport', monthlyLimit: 10000 },
    { category: 'living_other', monthlyLimit: 5000 },
  ],
  simulation: { monthlySavings: 60000 },
  expenses: [],
});

export const expense = (id, date, category, amount, shop = '') => ({ id, date, category, amount, shop, memo: '' });

/**
 * アプリを開く。data を渡すと最初の読み込み前に端末内の保存データとして入れる
 * （再読み込みしても入れ直さないので、アプリでの変更はそのまま残る）。
 */
export async function openApp(page, { data = null, hash = '#/home' } = {}) {
  await page.clock.setFixedTime(NOW);
  if (data) {
    await page.addInitScript(({ data, prefix }) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      for (const [k, v] of Object.entries(data)) localStorage.setItem(prefix + k, JSON.stringify(v));
      sessionStorage.setItem('e2e-seeded', '1');
    }, { data, prefix: PREFIX });
  }
  await page.goto(`/${hash}`);
  await expect(page.locator('#main > *').first()).toBeVisible();
}

/** 端末内に保存されているデータを読む */
export const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), PREFIX + key);

export const nav = (page, name) => page.locator('.nav').getByRole('link', { name }).click();

/** 金額欄に文字を入力する（1文字ずつ打つので、入力中のカンマ整形も通る） */
export async function typeMoney(locator, text) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text);
}
