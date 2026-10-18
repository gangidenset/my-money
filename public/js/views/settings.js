import {
  toDateKey, reminderCalendar,
} from '../calc.js';
import { persistent, ds, state, ui, esc, catMap, loadAll, render, payday, bonus } from '../core.js';
import { showToast } from '../ui.js';
import { helpBtn } from '../guides.js';

/* ---------- 設定 ---------- */

/* ---------- PWA（ホーム画面に追加・オフライン） ---------- */

export const APP_VERSION = '1.6.0';
export let installPrompt = null;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function installCard() {
  let body;
  if (isStandalone()) {
    body = '<p>✅ ホーム画面のアプリとして起動しています。データはこの端末の中だけに保存されます。</p>';
  } else if (installPrompt) {
    body = `<p>ホーム画面に追加すると、アプリのように起動でき、オフラインでも使えます。</p>
      <button class="btn primary block" data-action="install">ホーム画面に追加</button>`;
  } else if (isIOS()) {
    body = `<ol class="steps">
      <li>Safari 下部の <strong>共有ボタン</strong>（□に↑）をタップ</li>
      <li><strong>「ホーム画面に追加」</strong>を選ぶ</li>
      <li>右上の<strong>「追加」</strong>をタップ</li>
    </ol>`;
  } else {
    body = '<p>ブラウザのメニュー（︙）から<strong>「アプリをインストール」</strong>または<strong>「ホーム画面に追加」</strong>を選んでください。</p>';
  }
  return `<section class="card" id="install-card"><h2>📱 アプリとして使う${helpBtn('install')}</h2>${body}</section>`;
}

export function refreshInstallCard() {
  const el = document.getElementById('install-card');
  if (el) el.outerHTML = installCard();
}

window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  refreshInstallCard();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  refreshInstallCard();
});

export function updateOnlineBadge() {
  document.getElementById('offline-badge').hidden = navigator.onLine;
}
window.addEventListener('online', updateOnlineBadge);
window.addEventListener('offline', updateOnlineBadge);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./service-worker.js').catch((err) => console.warn('Service worker の登録に失敗しました', err));
}
// ホーム画面から使う場合は、端末の空き容量が少なくてもデータが消されにくくする
if (isStandalone()) navigator.storage?.persist?.();

export function lastBackupText() {
  const at = state.meta.lastBackupAt;
  if (!at) return '💾 まだバックアップしていません';
  const d = new Date(at);
  const days = Math.floor((Date.now() - d) / 86400000);
  return `💾 最後のバックアップ：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${days === 0 ? '今日' : `${days}日前`}）`;
}

/** バックアップファイルを作り、スマホでは共有メニュー（ファイルに保存・LINE など）、PC ではダウンロードで保存する */
export async function exportBackup() {
  const json = JSON.stringify(await ds.exportAll(), null, 2);
  const name = `my-money-backup-${toDateKey(new Date())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'my-money バックアップ' });
    } catch (err) {
      if (err.name === 'AbortError') return false; // 共有をキャンセルした
      throw err;
    }
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  state.meta.lastBackupAt = new Date().toISOString();
  delete state.meta.snoozedUntil;
  await ds.saveMeta(state.meta);
  return true;
}

export function settingsView() {
  const custom = state.categories.filter((c) => c.custom);
  return `
    <section class="card">
      <h2>📖 使い方ガイド</h2>
      <p class="note lead">機能ごとの使い方をまとめています。各画面の右上や、機能の見出しの「？」からも開けます。</p>
      <div class="btn-row">
        <button type="button" class="btn" data-action="help" data-guide="start">はじめての使い方</button>
        <button type="button" class="btn" data-action="help-all">すべての使い方</button>
      </div>
    </section>

    ${installCard()}

    <section class="card" id="reminder-card">
      <h2>📅 給料日のお知らせ${helpBtn('reminder')}</h2>
      <p class="note lead">給料日（毎月${payday()}日）${bonus().active ? `とボーナス月（${bonus().months.map((m) => `${m}月`).join('・')}）` : ''}の朝9時に、スマホのカレンダーから通知が届くように登録できます。先月の余ったお金・目的別の積立・バックアップの確認に使ってください。</p>
      <button class="btn block" data-action="add-calendar">カレンダーに登録する</button>
      <p class="note">アプリを閉じていても届くよう、スマホのカレンダーの通知を使います（家計のデータを外部のサーバーに送らないため、アプリからの通知はしていません）。給料日やボーナス月を変えたら、もう一度登録し直してください。</p>
    </section>

    <section class="card">
      <h2>カテゴリを追加${helpBtn('category')}</h2>
      <div class="cat-form">
        <input type="text" id="cat-icon" placeholder="🐶" maxlength="2" aria-label="絵文字">
        <input type="text" id="cat-name" placeholder="カテゴリ名（例：ペット）" maxlength="12" aria-label="カテゴリ名">
      </div>
      <div class="segmented" role="radiogroup" aria-label="予算の区分">
        <button type="button" data-action="cat-group" data-group="free" class="selected">自由に使えるお金から</button>
        <button type="button" data-action="cat-group" data-group="living">生活費予算から</button>
      </div>
      <button class="btn block" data-action="add-category">追加する</button>
      ${custom.length ? `<ul class="plain-list">${custom.map((c) => `<li><span>${c.icon} ${esc(c.name)} <small class="muted">${c.group === 'living' ? '生活費' : '自由費'}</small></span><button class="icon-btn" data-action="delete-category" data-id="${esc(c.id)}" aria-label="${esc(c.name)}を削除">✕</button></li>`).join('')}</ul>` : ''}
    </section>

    <section class="card" id="data-card">
      <h2>データ${helpBtn('backup')}</h2>
      <p class="note">${persistent ? 'データはこの端末のブラウザ内にだけ保存され、外部には送信されません。' : '⚠ このブラウザでは保存ができないため、ページを閉じるとデータが消えます。'}</p>
      <p class="backup-status">${lastBackupText()}</p>
      ${isIOS() && !isStandalone() ? '<p class="note caution">Safari のまま使っていると、しばらくアプリを開かなかったときにデータが消えることがあります。ホーム画面に追加して使うと安心です。</p>' : ''}
      <div class="btn-row">
        <button class="btn" data-action="export">バックアップを保存</button>
        <label class="btn">バックアップから復元<input type="file" accept="application/json" id="import-file" hidden></label>
      </div>
      <button class="btn danger block" data-action="reset">すべてのデータを削除</button>
    </section>

    <p class="muted center">my-money v${APP_VERSION}</p>`;
}


/* ---------- ボタン操作（data-action） ---------- */

/** 給料日・ボーナス月のリマインダーをカレンダー形式（.ics）で渡す */
function addCalendar() {
  const b = bonus();
  const ics = reminderCalendar({
    payday: payday(), bonusMonths: b.active ? b.months : [], appUrl: location.origin + location.pathname,
  });
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  // iPhone の Safari は開くとカレンダーへの追加画面になる。ほかはファイルとして保存し、開いて追加する
  if (isIOS()) a.target = '_blank';
  else a.download = 'my-money-reminder.ics';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const settingsActions = {
  'add-calendar': async (btn, ev) => {
    addCalendar();
    showToast(isIOS() ? '開いた画面で「すべて追加」を押してください' : 'ダウンロードしたファイルを開いて、カレンダーに追加してください');
  },
  'install': async (btn, ev) => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    refreshInstallCard();
  },
  'cat-group': async (btn, ev) => {
    btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('selected', b === btn));
  },
  'add-category': async (btn, ev) => {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return document.getElementById('cat-name').focus();
    const group = document.querySelector('[data-action="cat-group"].selected')?.dataset.group || 'free';
    await ds.addCategory({ name, icon: document.getElementById('cat-icon').value.trim(), group });
    state.categories = await ds.listCategories();
    render();
  },
  'delete-category': async (btn, ev) => {
    const c = catMap()[btn.dataset.id];
    if (!confirm(`カテゴリ「${c.name}」を削除しますか？（記録済みの支出は残ります）`)) return;
    await ds.deleteCategory(c.id);
    state.categories = await ds.listCategories();
    if (ui.entryCategory === c.id) ui.entryCategory = 'food';
    render();
  },
  'export': async (btn, ev) => {
    try {
      if (await exportBackup()) {
        render();
        showToast('バックアップを保存しました');
      }
    } catch (err) {
      alert('バックアップを保存できませんでした：' + err.message);
    }
  },
  'reset': async (btn, ev) => {
    if (!confirm('すべてのデータを削除します。元に戻せません。よろしいですか？')) return;
    await ds.resetAll();
    await ds.migrate(); // 空の状態として今の版を記録する
    await loadAll();
    location.hash = '#/home';
    render();
  },
};
