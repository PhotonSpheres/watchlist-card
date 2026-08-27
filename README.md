# Watchlist Card

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A poster wall for Home Assistant, backed by the built-in **todo** integration.
Films and shows with artwork, synopsis, IMDb / TMDB / Rotten Tomatoes ratings
and "where to stream" — added by searching from inside the card.

> This card was made with the help of AI. The idea was a simple yet good-looking
> watchlist to use for my family.

![The watchlist grid](https://raw.githubusercontent.com/PhotonSpheres/Watchlist-Card/main/images/grid.png)

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

| Detail sheet | Search |
|---|---|
| ![Detail sheet](https://raw.githubusercontent.com/PhotonSpheres/Watchlist-Card/main/images/detail.png) | ![Search](https://raw.githubusercontent.com/PhotonSpheres/Watchlist-Card/main/images/search.png) |

---

## Installation

### HACS (recommended)

The card is not in the default HACS store yet, so add it as a custom repository:

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=PhotonSpheres&repository=Watchlist-Card&category=plugin)

Or by hand: **HACS** → ⋮ (top right) → **Custom repositories** → paste
`https://github.com/PhotonSpheres/Watchlist-Card`, type **Dashboard** → **Add**.
Then find *Watchlist Card* in HACS and **Download**.

HACS registers the Lovelace resource for you if your dashboards are in storage
mode (the default). If you manage Lovelace in YAML, add it yourself:

```yaml
lovelace:
  resources:
    - url: /hacsfiles/Watchlist-Card/watchlist-card.js
      type: module
```

Hard-refresh the browser afterwards (Ctrl/Cmd + Shift + R).

### Manual

Copy `watchlist-card.js` to `/config/www/`, then Settings → Dashboards → ⋮ →
**Resources** → **Add resource**, URL `/local/watchlist-card.js`, type
**JavaScript module**.

> If you previously installed the card by hand, **delete the old
> `/local/watchlist-card.js` resource** before or after switching to HACS.
> Two copies means `watchlist-card` gets defined twice and the second one
> throws.

---

## Setup

### 1. Create the list

Settings → Devices & services → **Add integration** → **Local To-do** →
name it `Watchlist`. That gives you `todo.watchlist`.

Local To-do is required (or any list that supports item descriptions —
CalDAV works, the Shopping List does not). The card tells you if the list you
picked can't store descriptions.

### 2. Get the two API keys

Both are free and take about two minutes. For TMDB a free account is required.

| Key | Where | Notes |
|---|---|---|
| **TMDB** | [themoviedb.org](https://www.themoviedb.org/settings/api) → Account/Settings → API → request a key | Copy the 32-character **API Key (v3 auth)**, *not* the long v4 Bearer token, while requesting a key, TMDB asks for the nature of the project, I added the link to this repo |
| **OMDb** | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) → FREE tier | You must click the activation link in the confirmation email, or every call returns an error |

TMDB supplies search, artwork and metadata. OMDb supplies the IMDb rating
(IMDb has no public API of its own), plus Rotten Tomatoes and Metascore when
they exist. Leave the OMDb key empty and the card falls back to TMDB's own
score — everything else still works.

OMDb's free tier allows 1,000 calls a day. The card uses one per title added.

### 3. Add the card

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
  rather than disappearing. Home Assistant keeps completed items until you
  clear them (`todo.remove_completed_items`).
- **Added by voice?** Expose `todo.watchlist` to Assist and say "add Dune Part
  Two to my watchlist". It shows up as a plain tile marked *tap to look up* —
  one tap, one pick, and it gets its poster.
- The header shows how many are queued and roughly how long they'd take to
  watch (episode runtime × episode count for series).

---

## Troubleshooting

**"Custom element doesn't exist: watchlist-card"** — the resource isn't
registered, or the browser cached the old page. Check Settings → Dashboards →
⋮ → Resources and hard-refresh.

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
account access, so the practical risk is somebody using up your OMDb quota or
misusing your TMDB key as it is only for your personal use.

---

## Credits

*This product uses the TMDB API but is not endorsed or certified by TMDB.*
Ratings data from [OMDb](https://www.omdbapi.com/). Released under the
[MIT licence](LICENSE).

[hacs-url]: https://github.com/hacs/integration
[hacs-badge]: https://img.shields.io/badge/HACS-custom-41BDF5.svg?style=for-the-badge
[release-url]: https://github.com/PhotonSpheres/Watchlist-Card/releases
[release-badge]: https://img.shields.io/github/v/release/PhotonSpheres/Watchlist-Card?style=for-the-badge
[license-badge]: https://img.shields.io/github/license/PhotonSpheres/Watchlist-Card?style=for-the-badge
