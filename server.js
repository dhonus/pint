import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { searchPins, fetchImage } from './pinterest.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleSearch(url, res) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return sendJson(res, 400, { error: 'Missing query' });

  const { pins, bookmark } = await searchPins(
    query.slice(0, 200),
    url.searchParams.get('bookmark') || undefined,
  );
  // Hand the browser proxied URLs so it never hits pinimg.com itself.
  const items = pins.map((pin) => ({
    ...pin,
    thumb: `/api/image?url=${encodeURIComponent(pin.thumb)}`,
    full: `/api/image?url=${encodeURIComponent(pin.full)}`,
  }));
  sendJson(res, 200, { query, pins: items, bookmark });
}

async function handleImage(url, res) {
  const target = url.searchParams.get('url');
  if (!target) return sendJson(res, 400, { error: 'Missing url' });

  const image = await fetchImage(target);
  const headers = {
    'Content-Type': image.type,
    'Cache-Control': 'public, max-age=86400',
  };
  if (image.length) headers['Content-Length'] = image.length;
  res.writeHead(200, headers);
  Readable.fromWeb(image.body).pipe(res);
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(PUBLIC_DIR, rel);
  // Reject anything that escapes the public directory.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
    });
    fs.createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    if (url.pathname === '/api/search') return await handleSearch(url, res);
    if (url.pathname === '/api/image') return await handleImage(url, res);
    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error(`${url.pathname}: ${err.message}`);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`pint listening on http://localhost:${PORT}`);
});
