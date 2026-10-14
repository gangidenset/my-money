// 使い方ガイドの抜け・リンク切れを確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { GUIDES, SCREEN_GUIDES } from '../public/js/guideContent.js';

const ROUTES = ['home', 'ledger', 'budget', 'sim', 'settings'];

async function sources() {
  const dir = new URL('../public/js/', import.meta.url);
  const files = [...(await readdir(dir)).filter((f) => f.endsWith('.js')).map((f) => new URL(f, dir)),
    ...(await readdir(new URL('views/', dir))).map((f) => new URL(`views/${f}`, dir))];
  return Promise.all(files.map(async (u) => ({ name: u.pathname.split('/js/')[1], text: await readFile(u, 'utf8') })));
}

test('画面に置いた「？」と data-guide は、すべてガイドがある', async () => {
  const used = new Set();
  // ガイド自身の定義ファイル（説明用の例を含む）は除く
  for (const { text } of (await sources()).filter((f) => !/^guide/.test(f.name))) {
    for (const m of text.matchAll(/helpBtn\(\s*(?:'([\w-]+)'|editing \? '([\w-]+)' : '([\w-]+)')/g)) {
      [m[1], m[2], m[3]].filter(Boolean).forEach((id) => used.add(id));
    }
    for (const m of text.matchAll(/data-guide="([\w-]+)"/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 25, `「？」の数が少なすぎる: ${used.size}`);
  const missing = [...used].filter((id) => !GUIDES[id]);
  assert.deepEqual(missing, []);
});

test('どのガイドも、題名・説明・使い方があり、関連リンクが切れていない', () => {
  for (const [id, g] of Object.entries(GUIDES)) {
    assert.ok(g.icon && g.title && g.summary, `${id} に題名か説明がない`);
    assert.ok(g.steps?.length > 0, `${id} に使い方の手順がない`);
    for (const r of g.related ?? []) {
      assert.ok(GUIDES[r], `${id} の関連 ${r} がない`);
      assert.notEqual(r, id, `${id} が自分自身を関連にしている`);
    }
    // 文章に使ってよい HTML は <strong> だけ
    const html = [g.summary, ...(g.steps ?? []), ...(g.tips ?? [])].join('');
    assert.deepEqual(html.match(/<(?!\/?strong>)[^>]*>/g), null, `${id} に <strong> 以外のタグがある`);
  }
});

test('すべての画面に「この画面の使い方」があり、どのガイドもいずれかの画面から開ける', () => {
  assert.deepEqual(Object.keys(SCREEN_GUIDES).sort(), [...ROUTES].sort());
  const listed = new Set(Object.values(SCREEN_GUIDES).flatMap((s) => s.guides));
  for (const id of listed) assert.ok(GUIDES[id], `一覧の ${id} がない`);
  const unlisted = Object.keys(GUIDES).filter((id) => !listed.has(id));
  assert.deepEqual(unlisted, []);
});
