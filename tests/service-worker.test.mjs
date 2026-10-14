// service-worker.js をブラウザなしで動かし、キャッシュとオフライン時の挙動を確認する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const ORIGIN = 'http://localhost:8080';
const source = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');

function createWorker({ online }) {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    const key = (req) => new URL(typeof req === 'string' ? req : req.url, ORIGIN + '/').href.split('?')[0];
    return {
      async addAll(urls) { for (const u of urls) store.set(key(u), new Response(`cached:${u}`)); },
      async put(req, res) { store.set(key(req), res); },
      async match(req) { return store.get(key(req))?.clone(); },
    };
  };
  const listeners = {};
  const net = { online, calls: [] };
  const self = {
    location: new URL(ORIGIN + '/service-worker.js'),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const context = {
    self,
    caches: {
      open: async (name) => cacheFor(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch: async (req) => {
      net.calls.push(req.url);
      if (!net.online) throw new TypeError('Failed to fetch');
      return new Response(`network:${new URL(req.url).pathname}`);
    },
    URL, Response, Promise, setTimeout, clearTimeout, Error,
  };
  vm.runInNewContext(source, context);

  const run = async (type, extra = {}) => {
    let done;
    const event = { ...extra, waitUntil: (p) => { done = p; }, respondWith: (p) => { done = p; } };
    listeners[type](event);
    return done;
  };
  const request = (path, mode = 'cors') => ({ url: ORIGIN + path, method: 'GET', mode });
  return { run, request, net, stores };
}

test('インストール時にアプリ本体をキャッシュし、古いキャッシュを消す', async () => {
  const sw = createWorker({ online: true });
  sw.stores.set('my-money-v0', new Map());
  sw.stores.set('other-app', new Map());
  await sw.run('install');
  await sw.run('activate');
  const names = [...sw.stores.keys()];
  assert.ok(!names.includes('my-money-v0'));
  assert.ok(names.includes('other-app')); // 他アプリのキャッシュは触らない
  const shell = sw.stores.get(names.find((n) => n.startsWith('my-money-')));
  assert.ok(shell.has(`${ORIGIN}/js/app.js`));
  assert.ok(shell.has(`${ORIGIN}/index.html`));
});

test('オンライン：ネットワークから最新を取得してキャッシュを更新', async () => {
  const sw = createWorker({ online: true });
  await sw.run('install');
  const res = await sw.run('fetch', { request: sw.request('/js/calc.js') });
  assert.equal(await res.text(), 'network:/js/calc.js');
});

test('オフライン：キャッシュから起動でき、画面遷移は index.html を返す', async () => {
  const sw = createWorker({ online: true });
  await sw.run('install');
  sw.net.online = false;
  const js = await sw.run('fetch', { request: sw.request('/js/app.js') });
  assert.equal(await js.text(), 'cached:./js/app.js');
  const page = await sw.run('fetch', { request: sw.request('/some/deep/link?x=1', 'navigate') });
  assert.equal(await page.text(), 'cached:./index.html');
});

test('外部への通信や POST には関与しない', async () => {
  const sw = createWorker({ online: true });
  assert.equal(await sw.run('fetch', { request: { url: 'https://example.com/a.js', method: 'GET', mode: 'cors' } }), undefined);
  assert.equal(await sw.run('fetch', { request: { url: ORIGIN + '/api', method: 'POST', mode: 'cors' } }), undefined);
});

test('キャッシュ対象のファイルがすべて存在する', async () => {
  const list = source.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'\.\/[^']*'/g).map((s) => s.slice(3, -1));
  for (const f of list) {
    await access(new URL(`../public/${f || 'index.html'}`, import.meta.url));
  }
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  for (const icon of manifest.icons) await access(new URL(`../public/${icon.src}`, import.meta.url));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  assert.equal(manifest.display, 'standalone');
});

test('public/ のファイルはすべてオフライン用の一覧に入っている', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../public/', import.meta.url);
  const walk = async (dir, prefix = '') => (await Promise.all((await readdir(new URL(dir, root), { withFileTypes: true }))
    .map((e) => (e.isDirectory() ? walk(`${dir}${e.name}/`, `${prefix}${e.name}/`) : [`${prefix}${e.name}`])))).flat();
  const files = (await walk('')).filter((f) => f !== 'service-worker.js');
  const shell = new Set(source.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'\.\/[^']*'/g).map((s) => s.slice(3, -1)));
  const missing = files.filter((f) => !shell.has(f));
  assert.deepEqual(missing, [], `SHELL に追加が必要: ${missing.join(', ')}`);
});
