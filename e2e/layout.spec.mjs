import { test, expect } from '@playwright/test';
import { openApp, baseData, expense, nav } from './helpers.mjs';

const TABS = ['ホーム', '家計簿', '予算', '将来', '設定'];

test('幅320pxでも、どの画面も横にはみ出さず、エラーも出ない', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // サービスワーカーはテストでは止めているので、その登録失敗は除く
    if (m.type() === 'error' && !/service ?worker|fetching the script/i.test(m.text())) errors.push(m.text());
  });
  await page.setViewportSize({ width: 320, height: 700 });
  const data = baseData();
  data.expenses = [expense('a', '2026-09-10', 'food', 30000), expense('b', '2026-10-05', 'eatout', 3000, 'とても長い店名のレストランとカフェ')];
  data.goals = [{ id: 'g1', name: '車', icon: '🚗', targetAmount: 1000000, targetYear: 2027, targetMonth: 4, saved: 400000 }];
  await openApp(page, { data });

  for (const tab of TABS) {
    await nav(page, tab);
    await expect(page.locator('#page-title')).not.toBeEmpty();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `${tab} が横にはみ出している`).toBeLessThanOrEqual(0);
  }
  await nav(page, '家計簿');
  await page.getByRole('tab', { name: '📊 グラフ' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
