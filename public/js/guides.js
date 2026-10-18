// 使い方ガイド：各機能の「？」ボタンと、画面右上の「？」（その画面の機能一覧）から開く。
// 文章は guideContent.js に書く（画面のコードには helpBtn('id') を置くだけ）。

import { GUIDES, SCREEN_GUIDES, CARD_MODE_HIDDEN } from './guideContent.js';

export { GUIDES, SCREEN_GUIDES };

/** 機能の見出しなどに置く「？」ボタン */
export const helpBtn = (id, extraClass = '') =>
  `<button type="button" class="help-btn ${extraClass}" data-action="help" data-guide="${id}" aria-label="「${GUIDES[id]?.title ?? ''}」の使い方">?</button>`;

/* ---------- 表示（画面下から出るシート） ---------- */

const $sheet = document.getElementById('guide');
const backStack = [];

const guideLink = (id) => {
  const g = GUIDES[id];
  return `<button type="button" class="guide-link" data-guide="${id}"><span>${g.icon}</span><span>${g.title}</span><span class="muted">›</span></button>`;
};

function sheetHtml(title, body) {
  return `<div class="guide-inner">
    <div class="guide-head">
      ${backStack.length ? '<button type="button" class="icon-btn guide-back" aria-label="戻る">‹</button>' : '<span></span>'}
      <h2 id="guide-title">${title}</h2>
      <button type="button" class="icon-btn guide-close" aria-label="閉じる">✕</button>
    </div>
    <div class="guide-body">${body}</div>
  </div>`;
}

function show(html) {
  $sheet.innerHTML = html;
  if (!$sheet.open) $sheet.showModal();
  $sheet.scrollTop = 0;
  $sheet.querySelector('.guide-close')?.focus();
}

let current = null; // 戻るための、いま表示している内容 { type, id }

function renderGuide(id) {
  const g = GUIDES[id];
  current = { type: 'guide', id };
  show(sheetHtml(`${g.icon} ${g.title}`, `
    <p class="guide-summary">${g.summary}</p>
    ${g.steps?.length ? `<h3>使い方</h3><ol class="guide-steps">${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''}
    ${g.tips?.length ? `<h3>ポイント</h3><ul class="guide-tips">${g.tips.map((s) => `<li>${s}</li>`).join('')}</ul>` : ''}
    ${g.related?.length ? `<h3>関連する機能</h3><div class="guide-links">${g.related.map(guideLink).join('')}</div>` : ''}`));
}

let hiddenGuides = [];

function renderScreen(route) {
  const base = SCREEN_GUIDES[route] ?? SCREEN_GUIDES.home;
  const s = { ...base, guides: base.guides.filter((id) => !hiddenGuides.includes(id)) };
  current = { type: 'screen', id: route };
  show(sheetHtml(s.title, `
    <p class="guide-summary">${s.intro}</p>
    <div class="guide-links">${s.guides.map(guideLink).join('')}</div>
    <button type="button" class="btn block guide-all">すべての使い方を見る</button>`));
}

function renderAll() {
  current = { type: 'all' };
  show(sheetHtml('📖 使い方ガイド', Object.entries(SCREEN_GUIDES).map(([, s]) => `
    <h3>${s.title.replace('の使い方', '')}</h3>
    <div class="guide-links">${s.guides.filter((id, i, a) => a.indexOf(id) === i).map(guideLink).join('')}</div>`).join('')));
}

const reopen = (c) => (c.type === 'guide' ? renderGuide(c.id) : c.type === 'screen' ? renderScreen(c.id) : renderAll());

/** 機能のガイドを開く（シートの中から開いた場合は「戻る」で前の内容に戻れる） */
export function openGuide(id, { fromSheet = false } = {}) {
  if (!GUIDES[id]) return;
  if (fromSheet && current) backStack.push(current);
  else backStack.length = 0;
  renderGuide(id);
}
/** その画面の使い方の一覧。cardMode のときは隠している機能を一覧から外す */
export function openScreenGuide(route, { cardMode = false } = {}) {
  hiddenGuides = cardMode ? CARD_MODE_HIDDEN : [];
  backStack.length = 0;
  renderScreen(route);
}
export function openAllGuides({ fromSheet = false } = {}) {
  if (fromSheet && current) backStack.push(current);
  else backStack.length = 0;
  renderAll();
}

$sheet.addEventListener('click', (ev) => {
  // シートの外（背景）をタップしたら閉じる
  if (ev.target === $sheet) return $sheet.close();
  if (ev.target.closest('.guide-close')) return $sheet.close();
  if (ev.target.closest('.guide-back')) return reopen(backStack.pop());
  if (ev.target.closest('.guide-all')) return openAllGuides({ fromSheet: true });
  const link = ev.target.closest('[data-guide]');
  if (link) openGuide(link.dataset.guide, { fromSheet: true });
});
$sheet.addEventListener('close', () => {
  backStack.length = 0;
  current = null;
});

export const guideActions = {
  help: async (btn) => openGuide(btn.dataset.guide),
  'help-all': async () => openAllGuides(),
};
