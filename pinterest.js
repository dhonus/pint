import crypto from 'node:crypto';

const ORIGIN = 'https://www.pinterest.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Pinterest's web API rejects anonymous calls unless the CSRF header matches the
// csrftoken cookie. It never validates the value itself, so we mint our own and
// keep it for the lifetime of the process.
const csrfToken = crypto.randomBytes(16).toString('hex');

function headers(referer) {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/javascript, */*, q=0.01',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Requested-With': 'XMLHttpRequest',
    'X-APP-VERSION': '4a1b2c3',
    'X-Pinterest-AppState': 'active',
    'X-Pinterest-PWS-Handler': 'www/search/[scope].js',
    'X-CSRFToken': csrfToken,
    Cookie: `csrftoken=${csrfToken}`,
    Referer: referer,
  };
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
    full: orig?.url || thumb.url,
  };
}

function normalizePin(pin) {
  const images = pickImages(pin);
  if (!images) return null;
  return {
    id: pin.id,
    title: (pin.grid_title || pin.title || '').trim(),
    description: (pin.description || '').trim(),
    // Aspect ratio lets the grid reserve space before the image loads.
    width: images.thumbWidth,
    height: images.thumbHeight,
    color: pin.dominant_color || '#2a2a2e',
    thumb: images.thumb,
    full: images.full,
    domain: pin.domain || '',
    link: pin.link || null,
    pinUrl: `${ORIGIN}/pin/${pin.id}/`,
  };
}

/**
 * Search pins.
 * @param {string} query
 * @param {string} [bookmark] opaque cursor returned by a previous call
 * @returns {Promise<{pins: object[], bookmark: string|null}>}
 */
export async function searchPins(query, bookmark) {
  const sourceUrl = `/search/pins/?q=${encodeURIComponent(query)}`;
  const data = {
    options: {
      query,
      scope: 'pins',
      bookmarks: bookmark ? [bookmark] : [],
      page_size: 25,
      no_fetch_context_on_resource: false,
    },
    context: {},
  };
  const url =
    `${ORIGIN}/resource/BaseSearchResource/get/` +
    `?source_url=${encodeURIComponent(sourceUrl)}` +
    `&data=${encodeURIComponent(JSON.stringify(data))}`;

  const res = await fetch(url, { headers: headers(ORIGIN + sourceUrl) });
  if (!res.ok) {
    throw Object.assign(new Error(`Pinterest returned ${res.status}`), {
      status: res.status === 429 ? 429 : 502,
    });
  }

  const body = await res.json();
  const resource = body.resource_response || {};
  if (resource.status && resource.status !== 'success') {
    throw Object.assign(new Error(resource.message || 'Pinterest request failed'), {
      status: 502,
    });
  }

  const results = resource.data?.results || [];
  const next = resource.bookmark || null;
  return {
    pins: results.map(normalizePin).filter(Boolean),
    // "-end-" is Pinterest's sentinel for "no more pages".
    bookmark: next && next !== '-end-' ? next : null,
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
