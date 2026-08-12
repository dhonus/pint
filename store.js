import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PINT_DATA || path.join(HERE, 'data');
const FILE = path.join(DATA_DIR, 'shelves.json');

const MAX_SHELVES = 500;
const MAX_PINS = 2000;
const MAX_NAME = 80;

// Single user, small data: keep it all in memory and write the whole file on
// change. Writes are chained so two requests can't interleave.
let shelves = null;
let writing = Promise.resolve();

/** Only store fields we render, and only image URLs that point at our proxy. */
const PROXY = /^\/api\/image\?url=https%3A%2F%2Fi\d?\.pinimg\.com%2F/i;

function sanitizePin(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '');
  if (!/^[0-9]+$/.test(id)) return null;

  const image = (value) => (typeof value === 'string' && PROXY.test(value) ? value : null);
  const thumb = image(raw.thumb);
  if (!thumb) return null;

  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  return {
    id,
    title: text(raw.title, 200),
    thumb,
    large: image(raw.large) || thumb,
    full: image(raw.full) || thumb,
    color: /^#[0-9a-f]{3,8}$/i.test(raw.color || '') ? raw.color : '#2a2a2e',
    width: Number.isFinite(raw.width) ? raw.width : null,
    height: Number.isFinite(raw.height) ? raw.height : null,
    domain: text(raw.domain, 120),
    link: typeof raw.link === 'string' && /^https:\/\//.test(raw.link) ? raw.link.slice(0, 800) : null,
    pinUrl: `https://www.pinterest.com/pin/${id}/`,
  };
}

function sanitizePins(list) {
  return (Array.isArray(list) ? list : []).map(sanitizePin).filter(Boolean).slice(0, MAX_PINS);
}

function cleanName(name, fallback) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '';
  return trimmed || fallback;
}

async function load() {
  if (shelves) return shelves;
  try {
    const raw = JSON.parse(await fsp.readFile(FILE, 'utf8'));
    shelves = Array.isArray(raw?.shelves) ? raw.shelves : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`shelves: could not read ${FILE} (${err.message})`);
    shelves = [];
  }
  return shelves;
}

function persist() {
  // Write to a sibling then rename, so a crash mid-write can't truncate the file.
  writing = writing.then(async () => {
    const body = JSON.stringify({ shelves }, null, 2);
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fsp.mkdir(DATA_DIR, { recursive: true });
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, FILE);
  });
  return writing.catch((err) => {
    console.error(`shelves: write failed (${err.message})`);
  });
}

/** Summary view — enough to render the index without shipping every pin. */
function summarize(shelf) {
  return {
    id: shelf.id,
    name: shelf.name,
    count: shelf.pins.length,
    cover: shelf.pins.slice(0, 4).map((pin) => pin.thumb),
    created: shelf.created,
    updated: shelf.updated,
  };
}

export async function listShelves({ full = false } = {}) {
  const all = await load();
  return full ? all : all.map(summarize);
}

/**
 * Which shelves each pin is in, as `{ pinId: [name, ...] }`.
 * Small enough to ship whole, and it's what lets the grid mark saved pins.
 */
export async function pinIndex() {
  const all = await load();
  const index = {};
  for (const shelf of all) {
    for (const pin of shelf.pins) {
      (index[pin.id] ||= []).push(shelf.name);
    }
  }
  return index;
}

export async function getShelf(id) {
  const all = await load();
  return all.find((shelf) => shelf.id === id) || null;
}

export async function createShelf({ name, pins }) {
  const all = await load();
  if (all.length >= MAX_SHELVES) {
    throw Object.assign(new Error('Too many shelves'), { status: 409 });
  }
  const now = new Date().toISOString();
  const shelf = {
    id: crypto.randomUUID(),
    name: cleanName(name, 'Untitled shelf'),
    created: now,
    updated: now,
    pins: sanitizePins(pins),
  };
  all.unshift(shelf);
  await persist();
  return shelf;
}

export async function updateShelf(id, { name, addPins }) {
  const shelf = await getShelf(id);
  if (!shelf) throw Object.assign(new Error('Shelf not found'), { status: 404 });

  if (name !== undefined) shelf.name = cleanName(name, shelf.name);
  if (addPins !== undefined) {
    const existing = new Set(shelf.pins.map((pin) => pin.id));
    const incoming = sanitizePins(addPins).filter((pin) => !existing.has(pin.id));
    shelf.pins = [...incoming, ...shelf.pins].slice(0, MAX_PINS);
  }
  shelf.updated = new Date().toISOString();
  await persist();
  return shelf;
}

export async function deleteShelf(id) {
  const all = await load();
  const index = all.findIndex((shelf) => shelf.id === id);
  if (index === -1) throw Object.assign(new Error('Shelf not found'), { status: 404 });
  all.splice(index, 1);
  await persist();
}

export async function removePin(id, pinId) {
  const shelf = await getShelf(id);
  if (!shelf) throw Object.assign(new Error('Shelf not found'), { status: 404 });
  shelf.pins = shelf.pins.filter((pin) => pin.id !== pinId);
  shelf.updated = new Date().toISOString();
  await persist();
  return shelf;
}

export const dataDir = DATA_DIR;
