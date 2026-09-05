import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { buildServiceWorker } from '../scripts/build-sw';

function worker(fetcher = vi.fn(async () => new Response('{}'))) {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const stored = new Map<string, Response>();
  const cache = { match: async (request: Request) => stored.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { stored.set(request.url, response); } };
  const deleted: string[] = [];
  runInNewContext(buildServiceWorker([], 'bds-new'), {
    self: { addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => listeners.set(name, handler),
      location: { origin: 'https://example.test' }, clients: { claim: async () => {} } },
    caches: { keys: async () => ['bds-old', 'bds-new', 'other-app-offline'],
      delete: async (name: string) => deleted.push(name), open: async () => cache },
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

it.each(['online', 'offline', 'invalid'] as const)('祝日データ: %s', async (state) => {
  const record = (day: string) => ({ meta: { count: 1, range: { from: '2026-01-01', to: '2026-12-31' } }, holidays: { [day]: '祝日' } });
  const old = record('2026-01-01');
  const latest = record('2026-01-02');
  const fetcher = vi.fn(async () => {
    if (state === 'offline') throw new Error('offline');
    return Response.json(state === 'invalid' ? { holidays: {} } : latest);
  });
  const w = worker(fetcher);
  const request = new Request('https://example.test/Business-Days-Schedule/data/holidays.json');
  w.stored.set(request.url, Response.json(old));
  let response: Promise<Response> = Promise.resolve(Response.error());
  const lifetime: Promise<unknown>[] = [];
  w.listeners.get('fetch')!({ request, respondWith: (value: Promise<Response>) => { response = value; },
    waitUntil: (value: Promise<unknown>) => lifetime.push(value) });
  expect(await (await response).json()).toEqual(state === 'online' ? latest : old);
  await Promise.all(lifetime);
  expect(await w.stored.get(request.url)!.json()).toEqual(state === 'online' ? latest : old);
  expect(lifetime).toHaveLength(1);
});
