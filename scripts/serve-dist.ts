/**
 * dist/ を GitHub Pages と同じ形（サブパス配下の素の静的配信）で出す小さなサーバー。
 *
 * E2E は本番と同じ成果物に対して動かしたい。開発サーバーやプレビューサーバー特有の
 * 振る舞いに依存すると、公開後にだけ壊れる不具合を取り逃がすため。
 *
 * 使い方: npm run serve:dist -- [port]
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const DIST = join(ROOT, 'dist');
export const BASE_PATH = '/Business-Days-Schedule/';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function createDistServer(): ReturnType<typeof createServer> {
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === BASE_PATH.slice(0, -1)) {
      response.writeHead(302, { location: BASE_PATH });
      response.end();
      return;
    }
    if (!pathname.startsWith(BASE_PATH)) {
      response.writeHead(404).end('not found');
      return;
    }
    pathname = pathname.slice(BASE_PATH.length - 1);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // ディレクトリを遡る指定を弾く。
    const filePath = join(DIST, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(DIST)) {
      response.writeHead(403).end('forbidden');
      return;
    }

    void stat(filePath)
      .then((info) => {
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200, {
          'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
          'content-length': info.size,
        });
        createReadStream(filePath).pipe(response);
      })
      .catch(() => {
        response.writeHead(404).end('not found');
      });
  });
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 4173);
  createDistServer().listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}${BASE_PATH}`);
  });
}
