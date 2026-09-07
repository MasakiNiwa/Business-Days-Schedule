import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { buildServiceWorker } from '../scripts/build-sw';

function worker(fetcher = vi.fn(async () => new Response('{}'))) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const stored = new Map<string, Response>();
  // 実物の Cache は Request でも URL 文字列でも引ける。
  const keyOf = (request: Request | string) => (typeof request === 'string' ? request : request.url);
  const cache = { match: async (request: Request | string) => stored.get(keyOf(request))?.clone(),
    put: async (request: Request, response: Response) => { stored.set(keyOf(request), response); } };
  const deleted: string[] = [];
  runInNewContext(buildServiceWorker([], 'bds-new'), {
    self: { addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => listeners.set(name, handler),
      location: { origin: 'https://example.test' }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['bds-old', 'bds-new', 'other-app-offline'],
      delete: async (name: string) => deleted.push(name), open: async () => cache,
      match: cache.match },
    fetch: fetcher, URL, Response, AbortSignal,
  });
  return { listeners, stored, deleted };
}

it('このアプリの古いキャッシュだけを削除する', async () => {
  const w = worker();
  let pending: Promise<unknown> = Promise.resolve();
  w.listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  expect(w.deleted).toEqual(['bds-old']);
});

function fetchEvent(w: ReturnType<typeof worker>, url: string, mode = 'no-cors') {
  let response: Promise<Response> = Promise.resolve(Response.error());
  w.listeners.get('fetch')!({
    request: Object.create(new Request(url), {
      mode: { value: mode },
      url: { value: url },
      method: { value: 'GET' },
    }) as Request,
    respondWith: (value: Promise<Response>) => { response = value; },
    waitUntil: () => {},
  });
  return response;
}

it('保存済みの資産は通信せずキャッシュから返す', async () => {
  const fetcher = vi.fn(async () => new Response('network'));
  const w = worker(fetcher);
  const url = 'https://example.test/Business-Days-Schedule/data/samples/tax.json';
  w.stored.set(url, new Response('cached'));

  expect(await (await fetchEvent(w, url)).text()).toBe('cached');
  expect(fetcher).not.toHaveBeenCalled();
});

it('未保存の資産は取得し、次回のために保存する', async () => {
  const fetcher = vi.fn(async () => new Response('network'));
  const w = worker(fetcher);
  const url = 'https://example.test/Business-Days-Schedule/data/samples/tax.json';

  expect(await (await fetchEvent(w, url)).text()).toBe('network');
  expect(await w.stored.get(url)!.text()).toBe('network');
});

it('画面遷移はネットワーク優先で、切れているときだけキャッシュへ落ちる', async () => {
  const fetcher = vi.fn(async () => { throw new Error('offline'); });
  const w = worker(fetcher);
  w.stored.set('/Business-Days-Schedule/', new Response('shell'));

  const response = await fetchEvent(w, 'https://example.test/Business-Days-Schedule/rules', 'navigate');
  expect(await response.text()).toBe('shell');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('他のオリジンには手を出さない', async () => {
  const w = worker();
  let touched = false;
  w.listeners.get('fetch')!({
    request: new Request('https://elsewhere.test/thing.json'),
    respondWith: () => { touched = true; },
    waitUntil: () => {},
  });
  expect(touched).toBe(false);
});
