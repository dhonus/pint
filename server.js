import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { searchPins, getPin, getRelated, fetchImage } from './pinterest.js';

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

/** Rewrite upstream image URLs to our proxy so the browser never hits pinimg.com. */
function proxyImages(pin) {
  const proxy = (target) => `/api/image?url=${encodeURIComponent(target)}`;
  return { ...pin, thumb: proxy(pin.thumb), large: proxy(pin.large), full: proxy(pin.full) };
}

async function handleSearch(url, res) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return sendJson(res, 400, { error: 'Missing query' });

  const { pins, bookmark } = await searchPins(
    query.slice(0, 200),
    url.searchParams.get('bookmark') || undefined,
  );
  sendJson(res, 200, { query, pins: pins.map(proxyImages), bookmark });
}

const PIN_ID = /^[0-9]+$/;

/** Detail plus the first page of related pins — one round trip opens a layer. */
async function handlePin(pathname, res) {
  const id = pathname.slice('/api/pin/'.length);
  if (!PIN_ID.test(id)) return sendJson(res, 400, { error: 'Invalid pin id' });

  const [pin, related] = await Promise.all([
    getPin(id),
    // A pin with no related feed should still open, just without depth.
    getRelated(id).catch(() => ({ pins: [], bookmark: null })),
  ]);
  sendJson(res, 200, {
    pin: proxyImages(pin),
    related: related.pins.map(proxyImages),
    bookmark: related.bookmark,
  });
}

async function handleRelated(url, res) {
  const id = url.searchParams.get('id') || '';
  if (!PIN_ID.test(id)) return sendJson(res, 400, { error: 'Invalid pin id' });

  const { pins, bookmark } = await getRelated(id, url.searchParams.get('bookmark') || undefined);
  sendJson(res, 200, { pins: pins.map(proxyImages), bookmark });
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
    if (url.pathname.startsWith('/api/pin/')) return await handlePin(url.pathname, res);
    if (url.pathname === '/api/related') return await handleRelated(url, res);
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
