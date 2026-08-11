# pint

An alternative frontend for Pinterest. The backend fetches and parses Pinterest;
the frontend is its own thing. No tracking, no login wall, no app nag.

## Run

```sh
npm start          # http://localhost:3000
PORT=8080 npm start
```

No dependencies — just Node 20+ (uses built-in `fetch`).

## The idea: nothing ever navigates

Pinterest's core annoyance is that opening a pin is *destructive*. It tears down
the grid you were scanning, and coming back loses your place. Digging into an
idea costs you the trail that led to it.

Here, clicking a pin never routes anywhere. It opens a **layer** over the frozen
results grid, and layers stack:

- Click a pin → it opens as a layer. The grid underneath keeps its exact scroll
  position, because it was never unmounted.
- Every layer shows *more like this*. Click one of those → a new layer stacks on
  top, and the previous one recedes behind it. Depth is something you can see.
- The **rail** on the left is your trail — one chip per layer. Click any chip to
  pop straight back to that level; the layer you return to kept its own scroll.
- Back/forward drive the stack instead of leaving the page, and the whole trail
  lives in the URL (`/?q=coats&pin=123,456,789`), so a dig is shareable.

## The shelf

The collecting workflow, which Pinterest makes you use boards for. Press `S` on
any pin — in the grid, inside any layer, at any depth — and it lands on the shelf
at the bottom. It persists across searches and reloads (`localStorage`).

**Compare** expands the shelf into a full grid, so you can see six jackets next
to each other. That's the thing plain Pinterest can't do.

## Keys

| Key | Does |
| --- | --- |
| `Space` (hold) | Peek: enlarge whatever you're pointing at. Release to dismiss. Most looks shouldn't cost a click. |
| `S` | Shelf the pin under the cursor |
| `Esc` | Step back one layer (closes compare/peek first) |
| `Backspace` | Step back one layer |
| `/` | Focus the search box |

## Layout

| File               | Role                                                   |
| ------------------ | ------------------------------------------------------ |
| `server.js`        | HTTP server: search, pin, related, image proxy, static  |
| `pinterest.js`     | Talks to Pinterest's web API, normalizes pins           |
| `public/app.js`    | Search grid, history, keyboard                          |
| `public/layers.js` | The layer stack and the rail                            |
| `public/shelf.js`  | Shelf store (persisted); `shelf-ui.js` is the bar       |
| `public/cards.js`  | The pin card, shared by grid, layers, and shelf         |
| `public/peek.js`   | Hold-Space preview                                      |

## API

- `GET /api/search?q=<query>&bookmark=<cursor>` → `{ query, pins, bookmark }`
- `GET /api/pin/<id>` → `{ pin, related, bookmark }` — detail plus the first page
  of related pins, so opening a layer is one round trip
- `GET /api/related?id=<id>&bookmark=<cursor>` → `{ pins, bookmark }`
- `GET /api/image?url=<i.pinimg.com url>` → streams the image

Pass a returned `bookmark` back to get the next page; `null` means the end. Every
image URL in a response already points at `/api/image`, so the browser never
contacts Pinterest or `pinimg.com` directly.

## How it talks to Pinterest

It calls Pinterest's own web endpoints (`/resource/<Name>/get/`), the same ones
pinterest.com uses. Two undocumented requirements, both handled in
`pinterest.js`:

1. The `X-CSRFToken` header must match the `csrftoken` cookie. The value isn't
   validated, so we mint a random one at startup and send it in both places.
2. `X-Pinterest-PWS-Handler` must name the page the call would have come from
   (`www/search/[scope].js`, `www/pin/[id].js`). Without the right one the
   endpoint answers `403 Invalid Resource Request` even with a valid CSRF pair.

These are unofficial endpoints: they can change without notice, and heavy
traffic from one IP may get rate limited (surfaced as HTTP 429).

## Ideas next

- Boards and users as layer types, not just pins
- Multiple named shelves, and export (the data is already local)
- Response caching so repeat searches don't re-hit Pinterest
