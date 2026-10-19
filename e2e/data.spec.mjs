import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openApp, baseData, expense, nav, stored } from './helpers.mjs';

test('バックアップを保存 → 全削除 → 復元で、データが元に戻る（PC：ダウンロード）', async ({ page }) => {
  // 共有メニューが使えない環境として、ダウンロードで保存させる
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined }));
  const data = baseData();
  data.expenses = [expense('e1', '2026-10-10', 'food', 1234, 'スーパー')];
  await openApp(page, { data, hash: '#/settings' });

  const download = page.waitForEvent('download');
  await page.locator('#data-card').getByRole('button', { name: 'バックアップを保存' }).click();
  const file = await (await download).path();
  const backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup.app).toBe('my-money');
  expect(backup.data.expenses[0].amount).toBe(1234);
  await expect(page.locator('.backup-status')).toContainText('今日');

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'すべてのデータを削除' }).click();
  await expect(page.getByRole('heading', { name: 'はじめに' })).toBeVisible();

  await nav(page, '設定');
  page.once('dialog', (d) => d.accept()); // 「復元しました」
  await page.locator('#import-file').setInputFiles(file);
  await expect.poll(async () => (await stored(page, 'expenses'))?.length).toBe(1);
  await nav(page, 'ホーム');
  await expect(page.locator('.exp-list')).toContainText('スーパー');
});

test('バックアップのお知らせ：使い始めて7日たつと表示し、「あとで」で隠せる', async ({ page }) => {
  const data = baseData();
  data.expenses = [expense('e1', '2026-10-01', 'food', 500)];
  data.meta = { firstUsedAt: '2026-10-01T00:00:00.000Z' };
  await openApp(page, { data });
  const banner = page.locator('.backup-banner');
  await expect(banner).toContainText('まだバックアップがありません');
  await banner.getByRole('button', { name: 'あとで' }).click();
  await expect(banner).toHaveCount(0);
});

test('スマホでは共有メニューでバックアップを渡す', async ({ page }) => {
  await page.addInitScript(() => {
    window.__shared = null;
    Navigator.prototype.canShare = () => true;
    Navigator.prototype.share = async (d) => {
      window.__shared = { name: d.files[0].name, text: await d.files[0].text() };
    };
  });
  const data = baseData();
  data.expenses = [expense('e1', '2026-10-10', 'food', 777)];
  await openApp(page, { data, hash: '#/settings' });
  await page.locator('#data-card').getByRole('button', { name: 'バックアップを保存' }).click();
  await expect(page.locator('.backup-status')).toContainText('今日');
  const shared = await page.evaluate(() => window.__shared);
  expect(shared.name).toBe('my-money-backup-2026-10-14.json');
  expect(JSON.parse(shared.text).data.expenses[0].amount).toBe(777);
});

test('古い形式のデータで開くと、今の形式に変換して使える', async ({ page }) => {
  const data = baseData();
  data.expenses = [expense('e1', '2026-10-10', 'eatout', '1200')]; // 金額が文字列の古いデータ
  await openApp(page, { data });
  await expect(page.locator('.hero-value')).toHaveText('82,800円');
  expect((await stored(page, 'expenses'))[0].amount).toBe(1200);
  expect(await stored(page, 'schemaVersion')).toBeGreaterThanOrEqual(2);
  expect((await stored(page, 'preMigrationBackup')).data.expenses[0].amount).toBe('1200');
});

test('新しい版のアプリで保存されたデータなら、書き換えずに更新を促す', async ({ page }) => {
  const data = baseData();
  data.schemaVersion = 999;
  await openApp(page, { data });
  await expect(page.getByRole('heading', { name: 'アプリを更新してください' })).toBeVisible();
  expect(await stored(page, 'schemaVersion')).toBe(999);
});

test('設定からプライバシーポリシー・利用規約を開き、アプリに戻れる（データは残る）', async ({ page }) => {
  await openApp(page, { data: baseData(), hash: '#/settings' });
  await page.getByRole('link', { name: 'プライバシーポリシー' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'プライバシーポリシー' })).toBeVisible();
  await expect(page.getByText('利用者の端末の中だけに保存')).toBeVisible();

  await page.getByRole('link', { name: '利用規約' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '利用規約' })).toBeVisible();
  await expect(page.getByText('投資助言ではありません。').first()).toBeVisible();

  await page.getByRole('link', { name: '← アプリに戻る' }).click();
  await expect(page.locator('#page-title')).toHaveText('設定');
  expect((await stored(page, 'profile')).takeHome).toBe(300000);
});
