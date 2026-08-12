import crypto from 'node:crypto';

const ORIGIN = 'https://www.pinterest.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SEARCH_HANDLER = 'www/search/[scope].js';
const PIN_HANDLER = 'www/pin/[id].js';

// PINT_DEBUG=1 dumps what Pinterest actually replied. Worth turning on when a
// deployment gets empty feeds — Pinterest answers datacenter and VPN exit IPs
// with a valid, empty 200 rather than an error.
const DEBUG = process.env.PINT_DEBUG === '1';

// Pinterest's web API rejects anonymous calls unless the CSRF header matches the
// csrftoken cookie. It never validates the value itself, so we mint our own and
// keep it for the lifetime of the process.
const csrfToken = crypto.randomBytes(16).toString('hex');

/**
 * Call one of Pinterest's internal `/resource/<Name>/get/` endpoints.
 * The PWS-Handler header must match the page the call would come from, or the
 * endpoint answers 403 "Invalid Resource Request".
 */
async function callResource(name, options, { sourceUrl, handler }) {
  const data = { options, context: {} };
  const url =
    `${ORIGIN}/resource/${name}/get/` +
    `?source_url=${encodeURIComponent(sourceUrl)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*, q=0.01',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
      'X-APP-VERSION': '4a1b2c3',
      'X-Pinterest-AppState': 'active',
      'X-Pinterest-PWS-Handler': handler,
      'X-CSRFToken': csrfToken,
      Cookie: `csrftoken=${csrfToken}`,
      Referer: ORIGIN + sourceUrl,
    },
  });

  if (!res.ok) {
    throw Object.assign(new Error(`Pinterest returned ${res.status}`), {
      status: res.status === 429 ? 429 : res.status === 404 ? 404 : 502,
    });
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Bot-detection pages come back as HTML with a 200.
    console.error(`${name}: upstream sent non-JSON (${text.length}b): ${text.slice(0, 200)}`);
    throw Object.assign(new Error('Pinterest sent an unexpected response'), { status: 502 });
  }

  const resource = body.resource_response || {};
  if (DEBUG) {
    const data = resource.data;
    const count = Array.isArray(data) ? data.length : data?.results?.length;
    console.log(
      `${name}: http=${res.status} status=${resource.status} items=${count ?? 'n/a'}` +
        ` bookmark=${resource.bookmark ? 'yes' : 'no'}` +
        (resource.message ? ` message=${resource.message}` : '') +
        (count === 0 ? ` body=${text.slice(0, 400)}` : ''),
    );
  }
  if (resource.status && resource.status !== 'success') {
    throw Object.assign(new Error(resource.message || 'Pinterest request failed'), {
      status: 502,
    });
  }
  return resource;
}

/** Pull the image variants we care about out of a raw pin object. */
function pickImages(pin) {
  const images = pin.images || {};
  const orig = images.orig || images['736x'] || images['474x'];
  const thumb = images['474x'] || images['236x'] || images['736x'] || orig;
  if (!thumb?.url) return null;
  return {
    thumb: thumb.url,
    thumbWidth: thumb.width || null,
    thumbHeight: thumb.height || null,
    large: images['736x']?.url || orig?.url || thumb.url,
    full: orig?.url || thumb.url,
  };
}

function normalizePin(pin) {
  const images = pickImages(pin);
  if (!images) return null;
  return {
    id: pin.id,
    title: (pin.grid_title || pin.title || '').trim(),
    description: (pin.description || pin.closeup_unified_description || '').trim(),
    // Aspect ratio lets the grid reserve space before the image loads.
    width: images.thumbWidth,
    height: images.thumbHeight,
    color: pin.dominant_color || '#2a2a2e',
    thumb: images.thumb,
    large: images.large,
    full: images.full,
    domain: pin.domain || '',
    link: pin.link || null,
    pinUrl: `${ORIGIN}/pin/${pin.id}/`,
  };
}

/** The related feed interleaves non-pin cards ("story" units) we can't render. */
function normalizeFeed(items, label) {
  const raw = items || [];
  const pins = raw
    .filter((item) => !item.type || item.type === 'pin')
    .map(normalizePin)
    .filter(Boolean);

  // An empty feed is the symptom of an IP Pinterest doesn't like — it answers
  // 200 with nothing rather than an error. Say so, or it looks like a bug here.
  if (raw.length && !pins.length) {
    console.warn(`${label}: upstream sent ${raw.length} items, none renderable as pins`);
  } else if (!raw.length) {
    console.warn(`${label}: upstream returned an empty feed`);
  }
  return pins;
}

/** "-end-" is Pinterest's sentinel for "no more pages". */
function nextBookmark(resource) {
  const mark = resource.bookmark || null;
  return mark && mark !== '-end-' ? mark : null;
}

/**
 * Search pins.
 * @returns {Promise<{pins: object[], bookmark: string|null}>}
 */
export async function searchPins(query, bookmark) {
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
  const resource = await callResource(
    'BaseSearchResource',
    {
      query,
      scope: 'pins',
      bookmarks: bookmark ? [bookmark] : [],
      page_size: 25,
      no_fetch_context_on_resource: false,
    },
    { sourceUrl, handler: SEARCH_HANDLER },
  );
  return {
    pins: normalizeFeed(resource.data?.results, `search "${query}"`),
    bookmark: nextBookmark(resource),
  };
}

/** Full detail for a single pin. */
export async function getPin(id) {
  const resource = await callResource(
    'PinResource',
    { id, field_set_key: 'detailed', fetch_visual_search_objects: false },
    { sourceUrl: `/pin/${id}/`, handler: PIN_HANDLER },
  );
  const raw = resource.data;
  if (!raw?.id) throw Object.assign(new Error('Pin not found'), { status: 404 });

  const pin = normalizePin(raw);
  if (!pin) throw Object.assign(new Error('Pin has no image'), { status: 404 });

  return {
    ...pin,
    alt: (raw.alt_text || raw.auto_alt_text || '').trim(),
    pinner: raw.pinner
      ? { username: raw.pinner.username, name: raw.pinner.full_name || '' }
      : null,
    board: raw.board ? { name: raw.board.name, url: raw.board.url } : null,
  };
}

/** The "more like this" feed for a pin — the fuel for digging deeper. */
export async function getRelated(id, bookmark) {
  const resource = await callResource(
    'RelatedPinFeedResource',
    {
      pin: id,
      page_size: 25,
      bookmarks: bookmark ? [bookmark] : [],
      add_vase: true,
      prepend: false,
    },
    { sourceUrl: `/pin/${id}/`, handler: PIN_HANDLER },
  );
  return {
    pins: normalizeFeed(resource.data),
    bookmark: nextBookmark(resource),
  };
}

const IMAGE_HOST = /^i(?:\d)?\.pinimg\.com$/;

/** Fetch an image so the browser never talks to Pinterest directly. */
export async function fetchImage(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Invalid image url'), { status: 400 });
  }
  if (url.protocol !== 'https:' || !IMAGE_HOST.test(url.hostname)) {
    throw Object.assign(new Error('Host not allowed'), { status: 400 });
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'image/*', Referer: ORIGIN + '/' },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Upstream image ${res.status}`), { status: 502 });
  }
  return {
    body: res.body,
    type: res.headers.get('content-type') || 'image/jpeg',
    length: res.headers.get('content-length'),
  };
}
