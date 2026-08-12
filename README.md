# pint

Pint is an alternative frontend for Pinterest. The backend fetches and parses the real site, the
frontend is its own thing. No account, no login wall, no app nag, and your browser never talks to
Pinterest directly.

The whole point is navigation. On Pinterest, opening a pin throws away the grid you were scanning and
going back loses your place. Here nothing ever navigates — pins open as **layers** stacked on top of
your results, and you can dig as deep as you like without losing the trail that got you there.

![pint](https://github.com/user-attachments/assets/e2382265-d89d-4d7e-80fe-52a5558ffc96)

## Features

- search with a masonry grid that lazy loads and never reshuffles what's already on screen
- **layers** — pins open on top of the frozen grid, and related pins stack another layer on top of that
- the **rail** on the left is your trail, click any level to pop straight back to it
- **stash** — tap `s` on any pin at any depth to throw it in the tray at the bottom, local and disposable
- **shelves** — save a stash as a named shelf, kept server side. hold `s` or right-click a pin to file it straight into one
- **everything** view puts every pin from every shelf in one scroll
- **compare** blows the stash up into a full grid, for seeing six jackets next to each other
- hold `space` to peek at whatever you're pointing at, no click needed
- arrow keys walk the big image sideways through the feed it came from
- back/forward drive the layer stack instead of leaving the page
- the whole dig lives in the URL (`/?q=coats&pin=123,456,789`), so it's shareable
- all images proxied through the backend
- no dependencies, no build step, no framework

![pint](https://github.com/user-attachments/assets/35c718ba-6184-4016-9dab-54b869f8b845)

### Planned

- boards and users as layer types, not just pins
- multiple named shelves + export
- response caching so repeat searches don't re-hit Pinterest

## Running

```bash
npm start          # http://localhost:3000
PORT=8080 npm start
```

Needs Node 20+ for built-in `fetch`. That's it — there's nothing to install.

### Docker

```bash
docker compose up -d
```

Or without compose:

```bash
docker build -t pint .
docker run -d --name pint --init -p 3000:3000 -v pint-data:/data --restart unless-stopped pint
```

Publish elsewhere with `PINT_PORT=8080 docker compose up -d`, or bind it to localhost only
(`127.0.0.1:8080:3000`) if it sits behind a reverse proxy.

Saved shelves live in the `pint-data` volume — that's the only state, so it's the only thing worth
backing up. The stash and recent searches are browser-side and don't follow you between devices.
`PINT_DEBUG=1` logs what Pinterest actually replies with, worth turning on if results come back empty.

## Keys

| Key           | Action                                                                     |
|---------------|----------------------------------------------------------------------------|
| `←` `→`       | move sideways. in a layer this swaps the big image itself, over a zoomed shelf image it walks the shelf, on the grid it moves the selection |
| `space`       | hold to peek, release to dismiss                                           |
| `s`           | tap to stash the pin under the cursor, hold to pick a shelf to file it into |
| right-click   | same shelf picker, on any pin                                              |
| `esc`         | step back — zoom first, then compare, then one layer                       |
| `backspace`   | step back one layer                                                        |
| `/`           | focus the search box                                                       |

![pint](https://github.com/user-attachments/assets/02fd6565-0e59-4607-9617-a6ee95032cab)

## Layout

| File                | Role                                                   |
|---------------------|--------------------------------------------------------|
| `server.js`         | http server — search, pin, related, image proxy, static |
| `pinterest.js`      | talks to Pinterest, normalizes pins                     |
| `public/app.js`     | search grid, history, keyboard                          |
| `public/layers.js`  | the layer stack and the rail                            |
| `public/masonry.js` | append-only column masonry                              |
| `public/shelf.js`   | shelf store, `shelf-ui.js` is the bar and compare view  |
| `public/cards.js`   | the pin card, shared everywhere                         |
| `public/peek.js`    | hold-space peek and click-to-zoom                       |
| `public/home.js`    | empty state — starters and recent searches              |

## API

| Endpoint                                | Returns                                        |
|-----------------------------------------|------------------------------------------------|
| `/api/search?q=&bookmark=`              | `{ query, pins, bookmark }`                    |
| `/api/pin/<id>`                         | `{ pin, related, bookmark }` — one round trip  |
| `/api/related?id=&bookmark=`            | `{ pins, bookmark }`                           |
| `/api/image?url=<i.pinimg.com url>`     | streams the image                              |

Pass a returned `bookmark` back for the next page, `null` means the end. Image URLs in responses
already point at `/api/image`.

Shelves are the only thing that accepts writes:

| Endpoint                              | Method                                    |
|---------------------------------------|-------------------------------------------|
| `/api/shelves`                        | `GET` list (`?full=1` for pins), `POST` create |
| `/api/shelves/<id>`                   | `GET`, `PATCH` (`name`, `addPins`), `DELETE` |
| `/api/shelves/<id>/pins/<pinId>`      | `DELETE`                                  |

They're stored as one JSON file in `PINT_DATA` (default `./data`), written atomically. Incoming
pins are stripped to the fields that get rendered, and image URLs are only accepted if they point
at pint's own proxy.

## How it talks to Pinterest

It calls Pinterest's own internal `/resource/<Name>/get/` endpoints — the same ones pinterest.com
uses. Two undocumented things are needed to not get a 403, both handled in `pinterest.js`:

- `X-CSRFToken` must match the `csrftoken` cookie. The value isn't validated, so we just mint a
  random one at startup and send it in both places.
- `X-Pinterest-PWS-Handler` must name the page the call would have come from (`www/search/[scope].js`,
  `www/pin/[id].js`). Get it wrong and you get `403 Invalid Resource Request` even with a valid CSRF pair.

These are unofficial and can change without notice. Hammering them from one IP will get you rate
limited, which shows up as a 429.

## Notes

- the masonry is hand-rolled because CSS `column-count` redistributes every item when you append,
  so lazy loading shuffles everything above you and you lose your place mid-scroll. each column is
  its own element and new cards go to the shortest one, so nothing on screen ever moves
- an `IntersectionObserver` only reports *changes*, so once a page lands the sentinel is usually
  still in view and never fires again — the grid re-observes after each batch, the layer feed just
  measures its scroller's distance to the bottom
