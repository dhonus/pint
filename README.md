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
- **shelf** — press `s` on any pin at any depth, it stays there across searches and reloads
- **compare** blows the shelf up into a full grid, for seeing six jackets next to each other
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
docker run -d --name pint --init -p 3000:3000 --restart unless-stopped pint
```

Set `PORT` to change the port inside the container. There are no volumes and no state on disk —
the shelf and recent searches live in your browser's localStorage, so the container is disposable.
Put it behind your reverse proxy and you're done.

## Keys

| Key           | Action                                                                     |
|---------------|----------------------------------------------------------------------------|
| `←` `→`       | move sideways. in a layer this swaps the big image itself, over a zoomed shelf image it walks the shelf, on the grid it moves the selection |
| `space`       | hold to peek, release to dismiss                                           |
| `s`           | add the pin under the cursor to the shelf                                  |
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
