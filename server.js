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
  checkStore,
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

  const { pins, guides, bookmark } = await searchPins(
    query.slice(0, 200),
    url.searchParams.get('bookmark') || undefined,
  );
  sendJson(res, 200, {
    query,
    pins: pins.map(proxyImages),
    // Thumbnails go through the proxy like everything else.
    guides: guides.map((guide) => ({
      ...guide,
      image: guide.image ? `/api/image?url=${encodeURIComponent(guide.image)}` : null,
    })),
    bookmark,
  });
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

/**
 * A token that changes whenever the front end does, stamped onto the asset
 * links in index.html. New headers can't rescue a copy the browser cached
 * before it ever saw them — only a different URL can, so a deploy gets one.
 */
async function assetVersion() {
  const files = ['style.css', 'app.js'];
  const stamps = await Promise.all(
    files.map((name) =>
      fsp
        .stat(path.join(PUBLIC_DIR, name))
        .then((s) => s.mtimeMs)
        .catch(() => 0),
    ),
  );
  return Math.floor(Math.max(...stamps)).toString(36);
}

async function serveIndex(file, req, res) {
  const [html, version] = await Promise.all([fsp.readFile(file, 'utf8'), assetVersion()]);
  const body = html
    .replace('href="/style.css"', `href="/style.css?v=${version}"`)
    .replace('src="/app.js"', `src="/app.js?v=${version}"`);

  const etag = `W/"index-${version}"`;
  const headers = {
    'Content-Type': MIME['.html'],
    'Cache-Control': 'no-cache',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

async function serveStatic(pathname, req, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(PUBLIC_DIR, rel);
  // Reject anything that escapes the public directory.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    if (rel === 'index.html') return await serveIndex(file, req, res);

    // Size and mtime change whenever you deploy, so the tag changes with the
    // deploy. `no-cache` means "revalidate before using", not "don't store" —
    // unchanged files still come back as an empty 304.
    const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    // A module's own imports resolve without the parent's query string, so the
    // rest of the graph would still come from a stale cache. Stamp them too.
    if (path.extname(file) === '.js') {
      const version = await assetVersion();
      const code = (await fsp.readFile(file, 'utf8')).replace(
        /(\bfrom\s+|\bimport\s+)'\.\/([\w-]+\.js)'/g,
        `$1'./$2?v=${version}'`,
      );
      res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(code) });
      return res.end(req.method === 'HEAD' ? undefined : code);
    }

    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method not allowed' });
    }
    if (url.pathname === '/api/search') return await handleSearch(url, res);
    if (url.pathname.startsWith('/api/pin/')) return await handlePin(url.pathname, res);
    if (url.pathname === '/api/related') return await handleRelated(url, res);
    if (url.pathname === '/api/image') return await handleImage(url, res);
    return await serveStatic(url.pathname, req, res);
  } catch (err) {
    console.error(`${url.pathname}: ${err.message}`);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.destroy();
  }
});

server.listen(PORT, async () => {
  console.log(`pint listening on http://localhost:${PORT}`);
  if (await checkStore()) console.log(`shelves stored in ${dataDir}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Don't let a hung keep-alive connection hold the shutdown open.
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
