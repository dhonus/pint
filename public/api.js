async function json(url, signal) {
  const res = await fetch(url, { signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Abort is a cancellation, not a failure — callers shouldn't report it. */
export const isAbort = (err) => err?.name === 'AbortError';

export function searchPins(query, bookmark) {
  const params = new URLSearchParams({ q: query });
  if (bookmark) params.set('bookmark', bookmark);
  return json(`/api/search?${params}`);
}

export function getPin(id, signal) {
  return json(`/api/pin/${encodeURIComponent(id)}`, signal);
}

export function getRelated(id, bookmark, signal) {
  const params = new URLSearchParams({ id });
  if (bookmark) params.set('bookmark', bookmark);
  return json(`/api/related?${params}`, signal);
}
