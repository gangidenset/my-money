import { test, expect } from '@playwright/test';
import { openApp, baseData, nav, stored } from './helpers.mjs';
import { GUIDES, SCREEN_GUIDES } from '../public/js/guideContent.js';

const sheet = (page) => page.locator('#guide');

test('画面右上の「?」で、その画面の使い方の一覧が開く', async ({ page }) => {
  await openApp(page, { data: baseData() });
  const tabs = { ホーム: 'home', 家計簿: 'ledger', 予算: 'budget', 将来: 'sim', 設定: 'settings' };
  for (const [tab, route] of Object.entries(tabs)) {
    await nav(page, tab);
    await page.getByRole('button', { name: 'この画面の使い方' }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).locator('#guide-title')).toHaveText(SCREEN_GUIDES[route].title);
    await expect(sheet(page).locator('.guide-link')).toHaveCount(SCREEN_GUIDES[route].guides.length);
    await sheet(page).getByRole('button', { name: '閉じる' }).click();
    await expect(sheet(page)).toBeHidden();
  }
});

test('機能の「?」でその機能の使い方が開き、関連する機能へ移動して戻れる', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/budget' });
  await page.getByRole('button', { name: '「目的別の貯金」の使い方' }).click();
  await expect(sheet(page).locator('#guide-title')).toContainText('目的別の貯金');
  await expect(sheet(page).getByRole('heading', { name: '使い方' })).toBeVisible();
  await expect(sheet(page).locator('.guide-steps li')).toHaveCount(GUIDES.goals.steps.length);

  await sheet(page).getByRole('button', { name: /ボーナスの使い道/ }).click();
  await expect(sheet(page).locator('#guide-title')).toContainText('ボーナスの使い道');
  await sheet(page).getByRole('button', { name: '戻る' }).click();
  await expect(sheet(page).locator('#guide-title')).toContainText('目的別の貯金');

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
});

test('ホームの「今月あと」の「?」も開ける（はみ出さない）', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await openApp(page, { data: baseData() });
  await page.getByRole('button', { name: '「今月あと・今週あと・今日の目安」の使い方' }).click();
  await expect(sheet(page)).toContainText('週の初め（月曜）の残り');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('設定の「すべての使い方」で、全部のガイドを見られる', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/settings' });
  await page.getByRole('button', { name: 'すべての使い方' }).click();
  const ids = new Set(Object.values(SCREEN_GUIDES).flatMap((s) => s.guides));
  // 画面ごとに分けて並べるので、複数の画面に出てくるガイドは重複して数える
  const total = Object.values(SCREEN_GUIDES).reduce((n, s) => n + new Set(s.guides).size, 0);
  await expect(sheet(page).locator('.guide-link')).toHaveCount(total);
  expect(ids.size).toBe(Object.keys(GUIDES).length);
});

test('はじめて使う人は、ホームから「使い方を見る」で始め方を開ける', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: '📖 使い方を見る' }).click();
  await expect(sheet(page).locator('#guide-title')).toContainText('はじめての使い方');
});

test('以前から使っている人には「ガイドができました」を1回だけ出す', async ({ page }) => {
  const data = baseData();
  data.meta = { firstUsedAt: '2026-09-01T00:00:00.000Z', lastBackupAt: '2026-10-10T00:00:00.000Z' };
  await openApp(page, { data });
  const intro = page.locator('.guide-intro');
  await expect(intro).toContainText('使い方ガイドができました');
  await intro.getByRole('button', { name: '閉じる' }).click();
  await expect(intro).toHaveCount(0);
  expect((await stored(page, 'meta')).guideIntroSeen).toBe(true);
  await page.reload();
  await expect(page.locator('.hero-value')).toBeVisible();
  await expect(page.locator('.guide-intro')).toHaveCount(0);
});
