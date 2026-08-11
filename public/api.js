async function json(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function searchPins(query, bookmark) {
  const params = new URLSearchParams({ q: query });
  if (bookmark) params.set('bookmark', bookmark);
  return json(`/api/search?${params}`);
}

export function getPin(id) {
  return json(`/api/pin/${encodeURIComponent(id)}`);
}

export function getRelated(id, bookmark) {
  const params = new URLSearchParams({ id });
  if (bookmark) params.set('bookmark', bookmark);
  return json(`/api/related?${params}`);
}
