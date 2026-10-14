// 画面操作の自動テスト（npm run test:e2e）
// ローカルの Windows では入っている Edge を使い、GitHub Actions では Playwright の Chromium を使う。
import { defineConfig } from '@playwright/test';

const PORT = 4173;
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    channel,
    // スマホ幅で確認する
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    // キャッシュの影響を受けないようサービスワーカーは止める（サービスワーカー自体は単体テストで確認）
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.mjs',
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
