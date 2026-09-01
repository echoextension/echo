import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PIXEL_PNG = readFileSync(path.join(ROOT, 'icons/icon16.png'));

function htmlPage(label) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>${label}</title></head>
<body>
  <h1 id="fixture-ready">${label}</h1>
  <a id="fixture-link" href="https://example.test/target">fixture link</a>
  <img id="fixture-image" alt="fixture" src="/pixel.png">
</body>
</html>`;
}

export async function startLocalFixtureServer() {
  const requests = [];
  let origin = '';
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', origin || 'http://127.0.0.1');
    requests.push({
      headers: { ...request.headers },
      method: request.method,
      pathname: url.pathname,
      token: url.searchParams.get('token') || ''
    });

    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }
    if (url.pathname.startsWith('/fixture/')) {
      const label = url.pathname.split('/').at(-1) || 'fixture';
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8'
      });
      response.end(htmlPage(label));
      return;
    }
    if (url.pathname === '/pixel.png') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': PIXEL_PNG.length,
        'Content-Type': 'image/png'
      });
      response.end(PIXEL_PNG);
      return;
    }
    if (url.pathname === '/protected-image') {
      if (request.headers.referer !== `${origin}/`) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('referer required');
        return;
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': PIXEL_PNG.length,
        'Content-Type': 'image/png'
      });
      response.end(PIXEL_PNG);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  return Object.freeze({
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    origin,
    requestsFor(token) {
      return requests.filter(request => request.token === token);
    },
    snapshotRequests() {
      return structuredClone(requests);
    },
    url(pathname, token = '') {
      const url = new URL(pathname, origin);
      if (token) url.searchParams.set('token', token);
      return url.href;
    }
  });
}

export { PIXEL_PNG };
