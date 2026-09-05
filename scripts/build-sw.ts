/**
 * Service Worker の生成（docs/SPEC.md §13）。
 *
 * ビルド後の dist/ を走査して、事前キャッシュする資産の一覧を埋め込んだ sw.js を書く。
 * 一覧を手で持つと、資産名のハッシュが変わるたびに更新漏れが起きるため。
 *
 * キャッシュ名は中身のハッシュから決める。内容が変われば必ず名前が変わり、
 * 古いキャッシュが残り続けることがない。
 *
 * 使い方: npm run build（vite build のあとに自動で走る）
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist');
const BASE = '/Business-Days-Schedule/';

/** 事前キャッシュしないもの（大きい・使われないもの）。 */
const EXCLUDE = new Set(['sw.js']);

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectFiles(path);
      return [path];
    }),
  );
  return files.flat();
}

export function buildServiceWorker(assets: string[], cacheName: string): string {
  const list = JSON.stringify(assets, null, 2);
  return `/*
 * 自動生成。編集しないこと（scripts/build-sw.ts が書き出す）。
 *
 * 方針:
 *   - 事前キャッシュした資産はキャッシュ優先。資産名にハッシュが入っているため、
 *     内容が変わればURLも変わり、古いものを掴み続けることがない。
 *   - 画面遷移（navigate）はネットワーク優先。オフラインのときだけキャッシュへ。
 *     新しい版をすぐ受け取れるようにするため。
 *   - データはネットワーク優先。通信できない場合だけ保存済みのものを使う。
 */
const CACHE = ${JSON.stringify(cacheName)};
const CACHE_PREFIX = 'bds-';
const BASE = ${JSON.stringify(BASE)};
const PRECACHE = ${list};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

// 利用者が「今すぐ更新」を選んだとき、待機中の版へ切り替える。
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

const isData = (url) => url.pathname.includes('/data/');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(BASE)) ?? (await cache.match(BASE + 'index.html')) ?? Response.error();
      }),
    );
    return;
  }

  if (isData(url)) {
    const task = (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        try {
          const response = await fetch(request, { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
          if (!response.ok) throw new Error('data unavailable');
          const data = await response.clone().json();
          if (url.pathname.endsWith('/holidays.json')) {
            if (!data.meta || !data.meta.range || !data.holidays || Array.isArray(data.holidays)) throw new Error('invalid holidays');
            const entries = Object.entries(data.holidays);
            if (entries.length === 0 || data.meta.count !== entries.length || entries.some(([date, name]) => !/^\\d{4}-\\d{2}-\\d{2}$/.test(date) || typeof name !== 'string' || !name.trim())) throw new Error('invalid holidays');
          }
          await cache.put(request, response.clone());
          return response;
        } catch {
          return cached ?? Response.error();
        }
      })();
    event.respondWith(task);
    event.waitUntil(task.then(() => undefined));
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached !== undefined) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
`;
}

async function main(): Promise<void> {
  const files = await collectFiles(DIST);
  const assets: string[] = [BASE];
  const hash = createHash('sha256');

  for (const file of files.sort()) {
    const name = relative(DIST, file).replace(/\\/g, '/');
    if (EXCLUDE.has(name)) continue;
    assets.push(`${BASE}${name}`);
    hash.update(name);
    hash.update(await readFile(file));
  }

  const cacheName = `bds-${hash.digest('hex').slice(0, 12)}`;
  await writeFile(join(DIST, 'sw.js'), buildServiceWorker(assets, cacheName), 'utf-8');
  console.log(`sw.js を生成しました: ${assets.length} 件 / ${cacheName}`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
