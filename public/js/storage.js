// Storage 層：保存先の実装だけを担当する。
// 将来 IndexedDB / Firebase / Supabase に差し替える場合は、同じインターフェース
// （get / set / remove / clear）を持つアダプタを作って dataService に渡せばよい。

const PREFIX = 'mymoney:v1:';

function createMemoryAdapter() {
  const mem = new Map();
  return {
    async get(key) { return mem.has(key) ? structuredClone(mem.get(key)) : null; },
    async set(key, value) { mem.set(key, structuredClone(value)); },
    async remove(key) { mem.delete(key); },
    async clear() { mem.clear(); },
  };
}

function createLocalStorageAdapter() {
  return {
    async get(key) {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw == null) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async set(key, value) { localStorage.setItem(PREFIX + key, JSON.stringify(value)); },
    async remove(key) { localStorage.removeItem(PREFIX + key); },
    async clear() {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(PREFIX))
        .forEach((k) => localStorage.removeItem(k));
    },
  };
}

// プライベートブラウズ等で localStorage が使えない場合はメモリ保存で動かす
export function createDefaultStorage() {
  try {
    const probe = PREFIX + '__probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { adapter: createLocalStorageAdapter(), persistent: true };
  } catch {
    return { adapter: createMemoryAdapter(), persistent: false };
  }
}

export { createMemoryAdapter };
