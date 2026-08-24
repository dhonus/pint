# pint

Pint is an alternative frontend for Pinterest. It fetches and parses the real site on the backend,
the frontend is its own thing. No account, no login wall, no app nag, and your browser never talks to
Pinterest directly.

The point is navigation. On Pinterest, opening a pin throws away the grid you were reading. Here it
opens on top of it instead, and stacks, so you can dig as deep as you want and still get back.

<img width="1656" height="1291" alt="Screenshot 2026-08-24 at 22 57 17" src="https://github.com/user-attachments/assets/fcb1dad2-d324-4806-8e9f-ee7d50f3e815" />

## Features

- pins open in stacked **layers** over the grid, never instead of it
- masonry grid that lazy loads without reshuffling what you've already seen
- a trail of every layer you opened, click any of them to jump back
- stash pins with `s` as you browse, at any depth
- save a stash as a named **shelf**, kept server side
- hold `s` or right-click to file a pin straight into a shelf
- compare view, the whole stash in one grid
- hold `space` to peek at anything without clicking
- keyword chips on every pin, straight from Pinterest's own tags
- back and forward drive the layer stack
- shareable urls, the whole dig included (`/?q=coats&pin=123,456,789`)
- works properly on a phone, gestures and all
- no dependencies, no build step, no framework


### Pin preview

![pint](https://github.com/user-attachments/assets/3570b7f8-8cd5-4ec6-8f5c-3a6da3dee2dd)

### Stacking pins
The core of the app is the ability to open details of pins on top of one another:

<img width="800" height="689" alt="ScreenRecording2026-08-24at23 07 49-ezgif com-optimize" src="https://github.com/user-attachments/assets/00b40928-fe35-44f3-9403-008d3f0b8907" />


## Keys

| Key         | Does                                                                 |
|-------------|----------------------------------------------------------------------|
| `←` `→`     | move sideways — the big image in a layer, the shelf in a zoom, the selection on the grid |
| `space`     | hold to peek, let go to dismiss                                      |
| `s`         | tap to stash, hold to pick a shelf to file it into                   |
| right-click | the same shelf picker, on any pin                                    |
| `esc`       | step back one thing at a time                                        |
| `/`         | jump to the search box                                               |

On a phone: tap to open, long-press for the shelf picker, swipe the big image to move through the feed.

![pint](https://github.com/user-attachments/assets/02fd6565-0e59-4607-9617-a6ee95032cab)

## Running

```bash
npm start          # http://localhost:3000
```

Node 20+, and that's the whole list. There's nothing to install.

### Docker

```bash
docker compose up -d
```

Saved shelves are the only thing that lives on disk — one JSON file in `PINT_DATA` (the `pint-data`
volume by default), so that's the only thing worth backing up. The stash and your recent searches sit
in the browser and don't follow you between devices. If results ever come back empty, run with
`PINT_DEBUG=1` and the logs will show you exactly what Pinterest replied.

## The Pinterest side

It calls Pinterest's own internal `/resource/<Name>/get/` endpoints — the same ones the site uses.
Two undocumented things are needed to avoid a 403, both handled in `pinterest.js`:

- `X-CSRFToken` has to match the `csrftoken` cookie. Nothing validates the value, so we mint one and
  send it in both places.
- `X-Pinterest-PWS-Handler` has to name the page the call would have come from. Get it wrong and you
  get `403 Invalid Resource Request` even with a perfectly good CSRF pair.

None of this is official and it can break whenever Pinterest feels like it. Worth knowing: from a
datacenter or VPN IP you'll often get a cheerful `200` with zero results, which looks like a bug here
but isn't.

## Notes

The masonry is hand-rolled. CSS `column-count` re-flows every item when you append, so lazy loading
shuffles everything above you mid-scroll. Each column is its own element and new cards go to the
shortest one, so nothing on screen moves.

### Mobile

<img width="550" height="1066" alt="Screenshot 2026-08-24 at 23 02 35" src="https://github.com/user-attachments/assets/5f61d301-539b-4f8e-baaa-46d225ca0996" />
