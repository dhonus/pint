# pint

An alternative frontend for Pinterest. The backend fetches and parses Pinterest;
the frontend is its own thing. No tracking, no login wall, no app nag.

## Run

```sh
npm start          # http://localhost:3000
PORT=8080 npm start
```

No dependencies — just Node 20+ (uses built-in `fetch`).

## What works

- Search bar; results in a masonry grid
- Pagination via infinite scroll plus a "Load more" fallback
- Queries live in the URL (`/?q=cats`), so back/forward and sharing work
- All images are proxied through the backend, so the browser never contacts
  Pinterest or `pinimg.com` directly

## Layout

| File            | Role                                                        |
| --------------- | ----------------------------------------------------------- |
| `server.js`     | HTTP server: `/api/search`, `/api/image`, static files       |
| `pinterest.js`  | Talks to Pinterest's web API, normalizes pins                |
| `public/`       | Frontend (plain HTML/CSS/JS, no build step)                  |

## API

`GET /api/search?q=<query>&bookmark=<cursor>`

```json
{
  "query": "cats",
  "pins": [
    {
      "id": "123",
      "title": "…",
      "description": "…",
      "width": 474,
      "height": 265,
      "color": "#50817b",
      "thumb": "/api/image?url=…",
      "full": "/api/image?url=…",
      "domain": "example.com",
      "link": "https://example.com/…",
      "pinUrl": "https://www.pinterest.com/pin/123/"
    }
  ],
  "bookmark": "opaque-cursor-or-null"
}
```

Pass the returned `bookmark` back to get the next page; `null` means the end.

`GET /api/image?url=<i.pinimg.com url>` streams an image. Only `i*.pinimg.com`
hosts are accepted.

## How it talks to Pinterest

It calls Pinterest's own web endpoint (`/resource/BaseSearchResource/get/`), the
same one pinterest.com uses. That endpoint rejects requests unless the
`X-CSRFToken` header matches the `csrftoken` cookie — it doesn't validate the
value, so `pinterest.js` mints a random one at startup and sends it in both
places.

This is an unofficial, undocumented endpoint: it can change without notice, and
heavy traffic from one IP may get rate limited (surfaced as HTTP 429).

## Ideas next

- Boards, users, and related-pins scopes
- Pin detail page instead of linking straight to the image
- Response caching so repeat searches don't re-hit Pinterest
# pint
