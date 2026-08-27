# Watchlist Card

A poster wall for Home Assistant, backed by the built-in **todo** integration.
Films and shows with artwork, synopsis, IMDb / TMDB / Rotten Tomatoes ratings
and "where to stream" — added by searching from inside the card.

![grid](shot-grid.png)

---

## How it works

The to-do list is the only database. Each item's `summary` is the title;
everything else (poster, year, genres, runtime, ratings, providers) is fetched
**once** from TMDB + OMDb when you add the title, then cached inside that
item's `description` field:

```
2024 · 2h 47m · Science Fiction, Adventure · IMDb 8.5
#wl#{"v":1,"mt":"movie","id":693134,"imdb":"tt15239678", … }
```

The first line stays human-readable, so the item still looks sensible in the
stock to-do card and in Assist. Rendering the wall costs **zero API calls** —
the network is only touched while searching, adding, or refreshing a title.

---

## 1. Create the list

Settings → Devices & services → **Add integration** → **Local To-do** →
name it `Watchlist`. That gives you `todo.watchlist`.

Local To-do is required (or any list that supports item descriptions —
CalDAV works, the Shopping List does not). The card tells you if the list you
picked can't store descriptions.

## 2. Get the two API keys

Both are free and take about two minutes.

| Key | Where | Notes |
|---|---|---|
| **TMDB** | themoviedb.org → account → Settings → API → request a Developer key | Copy the 32-character **API Key (v3 auth)**, *not* the long v4 Bearer token |
| **OMDb** | omdbapi.com/apikey.aspx → FREE tier | You must click the activation link in the confirmation email, or every call returns an error |

TMDB supplies search, artwork and metadata. OMDb supplies the IMDb rating
(IMDb has no public API of its own), plus Rotten Tomatoes and Metascore when
they exist. Leave the OMDb key empty and the card falls back to TMDB's own
score — everything else still works.

OMDb's free tier allows 1,000 calls a day. The card uses one per title added.

## 3. Install the card

1. Copy `watchlist-card.js` into `/config/www/` (create the folder if it
   doesn't exist — via the File editor or Studio Code Server app, Samba, or
   the Terminal app).
2. Settings → Dashboards → ⋮ (top right) → **Resources** → **Add resource**
   - URL: `/local/watchlist-card.js`
   - Type: **JavaScript module**
3. Hard-refresh the browser (Ctrl/Cmd + Shift + R). On the companion app:
   Settings → Companion App → Debugging → Reset frontend cache.

## 4. Add it to a dashboard

Edit dashboard → **Add card** → search for *Watchlist*. The visual editor has
fields for the list, both keys, and the display options. Or in YAML:

```yaml
type: custom:watchlist-card
entity: todo.watchlist
tmdb_api_key: YOUR_TMDB_V3_KEY
omdb_api_key: YOUR_OMDB_KEY
region: DE
language: en-US
```

---

## Configuration

| Option | Default | What it does |
|---|---|---|
| `entity` | *(required)* | The `todo.*` list |
| `tmdb_api_key` | *(required)* | TMDB v3 API key |
| `omdb_api_key` | — | OMDb key; without it there is no IMDb score |
| `title` | list's friendly name | Card heading |
| `language` | `en-US` | TMDB language for titles and synopses |
| `region` | `DE` | Country used for streaming providers and age ratings |
| `media_types` | `[movie, tv]` | Restrict to `[movie]` or `[tv]` |
| `tile_width` | `116` | Minimum poster width in px — smaller means more per row |
| `columns` | *(auto)* | Force a fixed column count instead |
| `default_filter` | `todo` | Opening tab: `todo`, `done` or `all` |
| `default_sort` | `added_desc` | `list`, `added_desc`, `rating_desc`, `year_desc`, `title_asc` |
| `show_watched_tab` | `true` | Show the "Watched" tab |
| `show_providers` | `true` | Show streaming services in the detail sheet |
| `rename_on_lookup` | `true` | Replace a typed title with the official one |

---

## Using it

- **+** opens search. Type two characters, pick a result — poster and metadata
  are stored and the tile appears.
- **Tap a poster** for the detail sheet: ratings, synopsis, genres, where to
  stream, and buttons to mark watched, refresh the data, or remove it.
- **Mark watched** sets the item to `completed`; it moves to the Watched tab
  rather than disappearing. HA keeps completed items until you clear them
  (`todo.remove_completed_items`).
- **Added by voice?** Expose `todo.watchlist` to Assist and say "add Dune Part
  Two to my watchlist". It shows up as a plain tile marked *tap to look up* —
  one tap, one pick, and it gets its poster.
- The header shows how many are queued and roughly how long they'd take to
  watch (episode runtime × episode count for series).

---

## Troubleshooting

**"Custom element doesn't exist: watchlist-card"** — the resource isn't
registered, or the browser cached the old page. Re-check step 3 and
hard-refresh.

**Search fails with HTTP 401** — that's the v4 Bearer token in the
`tmdb_api_key` field. You need the short v3 key.

**No IMDb badge, only a green TMDB number** — the OMDb key is missing or
was never activated by email.

**Grey tiles, no posters** — the browser showing the dashboard needs to reach
`image.tmdb.org`; posters are loaded client-side.

**A title has the wrong data** — open it and press *Refresh data*, or remove
and re-add it from search.

---

## A note on the API keys

They live in the dashboard configuration, which means anyone who can view that
dashboard can read them. Both are read-only keys for public film data with no
account access, so the practical risk is somebody using up your OMDb quota.
Worth knowing, not worth losing sleep over.

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
