import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { searchPins, getPin, getRelated, fetchImage } from './pinterest.js';
import {
  listShelves,
  pinIndex,
  getShelf,
  createShelf,
  updateShelf,
  deleteShelf,
  removePin,
  dataDir,
} from './store.js';

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

const MAX_BODY = 4 * 1024 * 1024;

/** Read a JSON request body, refusing anything oversized. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * /api/shelves            GET (list, ?full=1) · POST (create)
 * /api/shelves/<id>       GET · PATCH (rename / add pins) · DELETE
 * /api/shelves/<id>/pins/<pinId>   DELETE
 */
async function handleShelves(req, res, url) {
  const rest = url.pathname.slice('/api/shelves'.length).replace(/^\//, '');
  const [id, section, pinId] = rest.split('/');

  if (!id) {
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        shelves: await listShelves({ full: url.searchParams.get('full') === '1' }),
        // Query param rather than a path, so it can't collide with a shelf id.
        pins: url.searchParams.get('index') === '1' ? await pinIndex() : undefined,
      });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      return sendJson(res, 201, { shelf: await createShelf(body) });
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (section === 'pins' && pinId) {
    if (req.method !== 'DELETE') return sendJson(res, 405, { error: 'Method not allowed' });
    return sendJson(res, 200, { shelf: await removePin(id, pinId) });
  }

  if (req.method === 'GET') {
    const shelf = await getShelf(id);
    if (!shelf) return sendJson(res, 404, { error: 'Shelf not found' });
    return sendJson(res, 200, { shelf });
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req);
    return sendJson(res, 200, { shelf: await updateShelf(id, body) });
  }
  if (req.method === 'DELETE') {
    await deleteShelf(id);
    return sendJson(res, 200, { ok: true });
  }
  return sendJson(res, 405, { error: 'Method not allowed' });
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
    // Shelves are the only thing that accepts writes.
    if (url.pathname === '/api/shelves' || url.pathname.startsWith('/api/shelves/')) {
      return await handleShelves(req, res, url);
    }
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
  console.log(`shelves stored in ${dataDir}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Don't let a hung keep-alive connection hold the shutdown open.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
