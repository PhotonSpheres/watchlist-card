/*!
 * Watchlist Card for Home Assistant
 * A poster-wall watchlist backed by the built-in `todo` integration.
 *
 * Metadata (poster, year, genres, runtime, IMDb/TMDB ratings, streaming
 * providers) is fetched once from TMDB + OMDb when a title is added and then
 * cached inside the to-do item's own `description` field, so day-to-day
 * rendering costs zero API calls.
 *
 * Data sources: TMDB (search, artwork, metadata) and OMDb (IMDb rating).
 * This product uses the TMDB API but is not endorsed or certified by TMDB.
 */

const WL_VERSION = "0.1.0";
const WL_MARK = "#wl#";                       // marker line holding the JSON blob
const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const OMDB_API = "https://www.omdbapi.com/";

// mdi:dice-5 — the "surprise me" button
const WL_DICE =
  "M19,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5A2,2 0 0,0 19,3M7,7A1.5,1.5 0 0,1 8.5,5.5A1.5,1.5 0 0,1 10,7A1.5,1.5 0 0,1 8.5,8.5A1.5,1.5 0 0,1 7,7M8.5,18.5A1.5,1.5 0 0,1 7,17A1.5,1.5 0 0,1 8.5,15.5A1.5,1.5 0 0,1 10,17A1.5,1.5 0 0,1 8.5,18.5M10.5,12A1.5,1.5 0 0,1 12,10.5A1.5,1.5 0 0,1 13.5,12A1.5,1.5 0 0,1 12,13.5A1.5,1.5 0 0,1 10.5,12M15.5,5.5A1.5,1.5 0 0,1 17,7A1.5,1.5 0 0,1 15.5,8.5A1.5,1.5 0 0,1 14,7A1.5,1.5 0 0,1 15.5,5.5M15.5,18.5A1.5,1.5 0 0,1 14,17A1.5,1.5 0 0,1 15.5,15.5A1.5,1.5 0 0,1 17,17A1.5,1.5 0 0,1 15.5,18.5Z";

/* ------------------------------------------------------------------ utils */

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

const img = (path, size) => (path ? `${TMDB_IMG}/${size}${path}` : null);

const year = (d) => (d && d.length >= 4 ? d.slice(0, 4) : "");

const runtimeStr = (min) => {
  if (!min || min <= 0) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

const bulkRuntime = (mins) => {
  if (!mins) return "";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

/* -------------------------------------------------- description codec ---- */
/* The to-do description keeps a human-readable first line (so the stock
 * to-do card and Assist still show something sensible) followed by a
 * machine line: #wl#{...json...}                                            */

function decodeMeta(description) {
  if (!description) return null;
  for (const line of String(description).split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith(WL_MARK)) {
      try {
        const m = JSON.parse(t.slice(WL_MARK.length));
        return m && typeof m === "object" ? m : null;
      } catch (e) { return null; }
    }
  }
  return null;
}

function humanLine(m) {
  const bits = [];
  if (m.year) bits.push(m.year);
  if (m.mt === "tv" && m.seasons) {
    bits.push(m.seasons === 1 ? "1 season" : `${m.seasons} seasons`);
  } else if (m.runtime) bits.push(runtimeStr(m.runtime));
  if (m.genres && m.genres.length) bits.push(m.genres.slice(0, 2).join(", "));
  if (m.imdb_rating) bits.push(`IMDb ${m.imdb_rating}`);
  else if (m.tmdb_rating) bits.push(`TMDB ${m.tmdb_rating}`);
  return bits.join(" · ");
}

function encodeMeta(m) {
  return `${humanLine(m)}\n${WL_MARK}${JSON.stringify(m)}`;
}

/* ------------------------------------------------------------- api layer */

async function jget(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).status_message || ""; } catch (e) { /* ignore */ }
    throw new Error(`HTTP ${res.status}${detail ? ` – ${detail}` : ""}`);
  }
  return res.json();
}

async function tmdbSearch(key, query, lang, types) {
  const url =
    `${TMDB_API}/search/multi?api_key=${encodeURIComponent(key)}` +
    `&query=${encodeURIComponent(query)}&language=${encodeURIComponent(lang)}` +
    `&include_adult=false&page=1`;
  const data = await jget(url);
  return (data.results || [])
    .filter((r) => types.includes(r.media_type))
    .map((r) => ({
      id: r.id,
      mt: r.media_type,
      title: r.title || r.name || "",
      original: r.original_title || r.original_name || "",
      year: year(r.release_date || r.first_air_date),
      poster: r.poster_path || null,
      tmdb_rating: r.vote_average ? Number(r.vote_average).toFixed(1) : null,
      popularity: r.popularity || 0,
    }))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 12);
}

function pickCert(details, mt, region) {
  try {
    if (mt === "movie") {
      const list = (details.release_dates && details.release_dates.results) || [];
      for (const want of [region, "US"]) {
        const hit = list.find((r) => r.iso_3166_1 === want);
        const c = hit && (hit.release_dates || []).map((d) => d.certification).find(Boolean);
        if (c) return c;
      }
    } else {
      const list = (details.content_ratings && details.content_ratings.results) || [];
      for (const want of [region, "US"]) {
        const hit = list.find((r) => r.iso_3166_1 === want);
        if (hit && hit.rating) return hit.rating;
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

function pickProviders(details, region) {
  try {
    const r = details["watch/providers"] && details["watch/providers"].results;
    const reg = r && r[region];
    if (!reg) return [];
    const seen = new Set();
    const out = [];
    for (const bucket of ["flatrate", "free", "ads"]) {
      for (const p of reg[bucket] || []) {
        if (seen.has(p.provider_id)) continue;
        seen.add(p.provider_id);
        out.push({ n: p.provider_name, l: p.logo_path || null });
      }
    }
    return out.slice(0, 6);
  } catch (e) { return []; }
}

async function tmdbDetails(key, id, mt, lang, region) {
  const append =
    mt === "movie"
      ? "external_ids,watch/providers,release_dates"
      : "external_ids,watch/providers,content_ratings";
  const url =
    `${TMDB_API}/${mt}/${id}?api_key=${encodeURIComponent(key)}` +
    `&language=${encodeURIComponent(lang)}&append_to_response=${append}`;
  const d = await jget(url);
  const epRun = Array.isArray(d.episode_run_time) ? d.episode_run_time[0] : null;
  return {
    v: 1,
    mt,
    id: d.id,
    imdb: d.imdb_id || (d.external_ids && d.external_ids.imdb_id) || null,
    title: d.title || d.name || "",
    original: d.original_title || d.original_name || "",
    year: year(d.release_date || d.first_air_date),
    released: d.release_date || d.first_air_date || null,
    poster: d.poster_path || null,
    backdrop: d.backdrop_path || null,
    tmdb_rating: d.vote_average ? Number(d.vote_average).toFixed(1) : null,
    genres: (d.genres || []).map((g) => g.name).slice(0, 4),
    runtime: mt === "movie" ? d.runtime || null : epRun || null,
    seasons: mt === "tv" ? d.number_of_seasons || null : null,
    episodes: mt === "tv" ? d.number_of_episodes || null : null,
    status: d.status || null,
    cert: pickCert(d, mt, region),
    tagline: d.tagline || null,
    overview: (d.overview || "").slice(0, 500),
    providers: pickProviders(d, region),
  };
}

async function omdbEnrich(key, meta) {
  if (!key || !meta.imdb) return meta;
  try {
    const d = await jget(
      `${OMDB_API}?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(meta.imdb)}&r=json`
    );
    if (!d || d.Response === "False") return meta;
    if (d.imdbRating && d.imdbRating !== "N/A") meta.imdb_rating = d.imdbRating;
    if (d.imdbVotes && d.imdbVotes !== "N/A") meta.imdb_votes = d.imdbVotes;
    for (const r of d.Ratings || []) {
      if (r.Source === "Rotten Tomatoes") meta.rt = r.Value;
      if (r.Source === "Metacritic") meta.mc = String(r.Value).split("/")[0];
    }
    if (!meta.cert && d.Rated && d.Rated !== "N/A") meta.cert = d.Rated;
    if (!meta.runtime && d.Runtime && /\d/.test(d.Runtime)) {
      meta.runtime = parseInt(d.Runtime, 10) || null;
    }
  } catch (e) { /* OMDb is best-effort */ }
  return meta;
}

async function buildMeta(cfg, id, mt) {
  const meta = await tmdbDetails(cfg.tmdb_api_key, id, mt, cfg.language, cfg.region);
  await omdbEnrich(cfg.omdb_api_key, meta);
  meta.added = new Date().toISOString().slice(0, 10);
  return meta;
}

/* ------------------------------------------------------------------ style */

const WL_STYLE = `
  :host { display:block; }
  ha-card { padding:12px 12px 14px; overflow:hidden; }
  .head { display:flex; align-items:center; gap:10px; margin:2px 4px 12px; }
  .titles { min-width:0; flex:1; }
  .title { font-size:20px; font-weight:500; line-height:1.2;
           color:var(--primary-text-color); overflow:hidden;
           text-overflow:ellipsis; white-space:nowrap; }
  .sub { font-size:12px; color:var(--secondary-text-color); margin-top:2px; }
  .iconbtn { flex:0 0 auto; display:inline-flex; align-items:center;
             justify-content:center; width:38px; height:38px; border:none;
             border-radius:50%; cursor:pointer; color:var(--primary-text-color);
             background:var(--secondary-background-color); font-size:20px;
             line-height:1; transition:background .15s, color .15s; }
  .iconbtn svg { display:block; }
  .iconbtn:hover { filter:brightness(1.12); }
  .iconbtn.primary { background:var(--primary-color); color:var(--text-primary-color,#fff); }
  .bar { display:flex; align-items:center; gap:6px; margin:0 4px 12px;
         flex-wrap:wrap; }
  .chip { border:none; cursor:pointer; padding:5px 12px; border-radius:16px;
          font-size:13px; font-family:inherit; color:var(--primary-text-color);
          background:var(--secondary-background-color); transition:.15s; }
  .chip[aria-pressed="true"] { background:var(--primary-color);
          color:var(--text-primary-color,#fff); }
  .spacer { flex:1; }
  .sels { display:flex; align-items:center; gap:6px; margin-left:auto; }
  .bar select { font-family:inherit; font-size:13px; padding:5px 8px;
          border-radius:8px; border:1px solid var(--divider-color);
          background:var(--card-background-color); color:var(--primary-text-color);
          max-width:44vw; }
  .bar select.genre[data-on="1"] { border-color:var(--primary-color);
          color:var(--primary-color); }

  .grid { display:grid; gap:14px 12px;
          grid-template-columns:repeat(auto-fill,minmax(var(--wl-tile,116px),1fr)); }
  .tile { cursor:pointer; -webkit-tap-highlight-color:transparent;
          border:none; padding:0; background:none; font:inherit;
          text-align:left; display:block; }
  .art { position:relative; aspect-ratio:2/3; border-radius:10px;
         overflow:hidden; background:var(--secondary-background-color);
         box-shadow:0 2px 6px rgba(0,0,0,.28); transition:transform .18s ease; }
  .tile:hover .art { transform:translateY(-3px) scale(1.02); }
  .art img { width:100%; height:100%; object-fit:cover; display:block; }
  .noart { width:100%; height:100%; display:flex; align-items:center;
           justify-content:center; text-align:center; padding:8px;
           font-size:11px; line-height:1.3; color:var(--secondary-text-color);
           box-sizing:border-box; }
  .done .art img, .done .art .noart { filter:grayscale(1); opacity:.4; }
  .done .art { box-shadow:none; }
  .done .cap, .done .capy { opacity:.6; }
  .check { position:absolute; inset:0; display:flex; align-items:center;
           justify-content:center; font-size:30px; font-weight:700; color:#fff; }
  .check span { display:flex; align-items:center; justify-content:center;
           width:46px; height:46px; border-radius:50%;
           background:rgba(0,0,0,.55); backdrop-filter:blur(2px); }
  .badge { position:absolute; top:5px; right:5px; padding:2px 6px;
           border-radius:6px; font-size:11px; font-weight:600;
           background:rgba(0,0,0,.72); color:#f5c518; backdrop-filter:blur(3px); }
  .badge.tmdb { color:#01d277; }
  .mtag { position:absolute; top:5px; left:5px; padding:1px 5px;
          border-radius:5px; font-size:10px; font-weight:600; letter-spacing:.4px;
          background:rgba(0,0,0,.66); color:#fff; text-transform:uppercase; }
  .miss { position:absolute; bottom:5px; left:5px; right:5px; padding:2px 4px;
          border-radius:5px; font-size:10px; text-align:center;
          background:rgba(0,0,0,.72); color:#fff; }
  .cap { margin-top:6px; font-size:12.5px; line-height:1.25;
         color:var(--primary-text-color); display:-webkit-box;
         -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .capy { font-size:11px; color:var(--secondary-text-color); margin-top:1px; }
  .empty { padding:34px 12px; text-align:center; color:var(--secondary-text-color);
           font-size:14px; line-height:1.5; }

  dialog { border:none; padding:0; border-radius:16px; width:min(560px,94vw);
           max-height:88vh; background:var(--card-background-color);
           color:var(--primary-text-color); overflow:hidden; }
  dialog::backdrop { background:rgba(0,0,0,.6); backdrop-filter:blur(2px); }
  .sheet { display:flex; flex-direction:column; max-height:88vh; }
  .hero { position:relative; aspect-ratio:16/7; flex:0 0 auto; overflow:hidden;
          background:var(--secondary-background-color); }
  .hero img { position:absolute; top:0; left:0; width:100%; height:100%;
              object-fit:cover; display:block; }
  .hero::after { content:""; position:absolute; inset:0;
        background:linear-gradient(to bottom,transparent 30%,var(--card-background-color)); }
  .close { position:absolute; top:8px; right:8px; z-index:3; width:32px;
           height:32px; border:none; border-radius:50%; cursor:pointer;
           background:rgba(0,0,0,.55); color:#fff; font-size:18px; line-height:1; }
  .body { padding:0 20px 18px; overflow:auto; min-height:0; }
  .body.pad { padding-top:18px; }
  .dtitle { font-size:22px; font-weight:600; line-height:1.2; margin:0 0 4px; }
  .dorig { font-size:13px; color:var(--secondary-text-color); margin:0 0 8px;
           font-style:italic; }
  .metarow { display:flex; flex-wrap:wrap; gap:6px 10px; font-size:13px;
             color:var(--secondary-text-color); margin-bottom:12px; }
  .pill { display:inline-block; padding:1px 7px; border-radius:5px;
          border:1px solid var(--divider-color); font-size:11.5px; }
  .rates { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
  .rate { display:flex; flex-direction:column; align-items:center; min-width:64px;
          padding:6px 10px; border-radius:10px;
          background:var(--secondary-background-color); }
  .rate b { font-size:16px; line-height:1.1; }
  .rate span { font-size:10px; letter-spacing:.5px; text-transform:uppercase;
               color:var(--secondary-text-color); margin-top:2px; }
  .rate.imdb b { color:#f5c518; }
  .rate.tmdb b { color:#01d277; }
  .rate.rt b   { color:#fa320a; }
  .over { font-size:14px; line-height:1.55; margin:0 0 14px;
          color:var(--primary-text-color); }
  .seclbl { font-size:11px; letter-spacing:.6px; text-transform:uppercase;
            color:var(--secondary-text-color); margin:0 0 6px; }
  .provs { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:16px; }
  .prov { display:flex; align-items:center; gap:6px; padding:4px 9px 4px 4px;
          border-radius:9px; background:var(--secondary-background-color);
          font-size:12px; }
  .prov img { width:22px; height:22px; border-radius:5px; display:block; }
  .acts { display:flex; flex-wrap:wrap; gap:8px; }
  .btn { font:inherit; font-size:13.5px; padding:8px 14px; border-radius:10px;
         border:1px solid var(--divider-color); cursor:pointer;
         background:var(--card-background-color); color:var(--primary-text-color); }
  .btn:hover { background:var(--secondary-background-color); }
  .btn.fill { background:var(--primary-color); color:var(--text-primary-color,#fff);
              border-color:transparent; }
  .btn.danger { color:var(--error-color,#db4437); }
  .btn[disabled] { opacity:.5; cursor:default; }
  .links { margin-top:12px; font-size:12.5px; }
  .links a { color:var(--primary-color); text-decoration:none; margin-right:14px; }

  .srchhead { padding:16px 56px 10px 18px; }
  .srchhead input { width:100%; box-sizing:border-box; font:inherit;
        font-size:16px; padding:11px 13px; border-radius:11px;
        border:1px solid var(--divider-color);
        background:var(--secondary-background-color);
        color:var(--primary-text-color); }
  .srchhead input:focus { outline:2px solid var(--primary-color); outline-offset:-1px; }
  .results { overflow:auto; padding:0 10px 14px; }
  .res { display:flex; gap:11px; align-items:center; width:100%; text-align:left;
         padding:8px; border:none; border-radius:11px; cursor:pointer;
         background:none; font:inherit; color:var(--primary-text-color); }
  .res:hover { background:var(--secondary-background-color); }
  .res[disabled] { opacity:.5; cursor:default; }
  .res[disabled]:hover { background:none; }
  .res img, .res .ph { width:46px; height:69px; flex:0 0 46px; border-radius:6px;
         object-fit:cover; background:var(--secondary-background-color); }
  .res .rt2 { min-width:0; display:flex; flex-direction:column; gap:3px; }
  .res .rn { display:block; font-size:14.5px; font-weight:500; overflow:hidden;
             text-overflow:ellipsis; white-space:nowrap; }
  .res .rm { display:block; font-size:12px; color:var(--secondary-text-color); }
  .res .on { display:block; font-size:11px; color:var(--primary-color); }
  .note { padding:22px 18px; text-align:center; font-size:13.5px;
          color:var(--secondary-text-color); line-height:1.5; }
  .err { color:var(--error-color,#db4437); }
  .spin { width:22px; height:22px; margin:22px auto; border-radius:50%;
          border:2px solid var(--divider-color);
          border-top-color:var(--primary-color); animation:wlspin .8s linear infinite; }
  @keyframes wlspin { to { transform:rotate(360deg); } }
  .roll { text-align:center; }
  .rollart { width:min(190px,52vw); aspect-ratio:2/3; margin:2px auto 14px;
             border-radius:12px; overflow:hidden; position:relative;
             background:var(--secondary-background-color);
             box-shadow:0 6px 20px rgba(0,0,0,.35); }
  .rollart img { width:100%; height:100%; object-fit:cover; display:block; }
  .rolling .rollart { animation:wlwob .42s ease-in-out infinite; }
  @keyframes wlwob { 0%,100% { transform:rotate(-1.4deg) } 50% { transform:rotate(1.4deg) } }
  .rolltitle { font-size:19px; font-weight:600; line-height:1.25; margin:0 0 4px;
               min-height:23px; }
  .rollsub { font-size:13px; color:var(--secondary-text-color); margin:0 0 16px;
             min-height:17px; }
  .roll .acts { justify-content:center; }
  @media (max-width:500px) { .body { padding:0 15px 16px; } }
`;

/* ------------------------------------------------------------------- card */

const FEAT_DESCRIPTION = 64;   // TodoListEntityFeature.SET_DESCRIPTION_ON_ITEM

const SORTS = {
  list:        { label: "List order" },
  added_desc:  { label: "Recently added" },
  rating_desc: { label: "Rating" },
  year_desc:   { label: "Year" },
  title_asc:   { label: "Title A–Z" },
};

class WatchlistCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items = [];
    this._loaded = false;
    this._error = null;
    this._unsub = null;
    this._built = false;
    this._busy = new Set();
    this._rollTimer = null;
    this._lastRoll = null;
  }

  static getConfigElement() {
    return document.createElement("watchlist-card-editor");
  }

  static getStubConfig(hass) {
    const first = Object.keys(hass && hass.states ? hass.states : {})
      .find((e) => e.startsWith("todo."));
    return {
      entity: first || "todo.watchlist",
      tmdb_api_key: "",
      omdb_api_key: "",
      language: "en-US",
      region: "DE",
    };
  }

  setConfig(config) {
    if (!config || !config.entity) throw new Error("You need to define an entity (a todo.* list)");
    if (!String(config.entity).startsWith("todo.")) throw new Error("Entity must be a todo.* list");
    const mt = Array.isArray(config.media_types) && config.media_types.length
      ? config.media_types : ["movie", "tv"];
    this._config = {
      title: null,
      tmdb_api_key: "",
      omdb_api_key: "",
      language: "en-US",
      region: "DE",
      tile_width: 116,
      columns: null,
      default_filter: "todo",
      default_sort: "added_desc",
      show_watched_tab: true,
      show_genre_filter: true,
      show_random_button: true,
      show_providers: true,
      rename_on_lookup: true,
      ...config,
      media_types: mt,
    };
    this._filter = ["todo", "done", "all"].includes(this._config.default_filter)
      ? this._config.default_filter : "todo";
    this._sort = SORTS[this._config.default_sort] ? this._config.default_sort : "added_desc";
    this._type = "all";
    this._genre = "all";
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) { this._resubscribe(); this._build(); }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._config) { this._resubscribe(); this._build(); }
  }
  get hass() { return this._hass; }

  connectedCallback() { if (this._config && this._hass) this._resubscribe(); }

  disconnectedCallback() {
    if (this._unsub) { try { this._unsub(); } catch (e) { /* ignore */ } this._unsub = null; }
  }

  getCardSize() { return 3 + Math.ceil(this._visible().length / 4) * 2; }

  getGridOptions() { return { columns: "full", rows: "auto", min_columns: 6 }; }

  /* --------------------------------------------------------- data layer */

  async _resubscribe() {
    if (this._unsub) { try { this._unsub(); } catch (e) { /* ignore */ } this._unsub = null; }
    const conn = this._hass && this._hass.connection;
    if (!conn) return;
    const entity = this._config.entity;
    try {
      const unsub = await conn.subscribeMessage(
        (msg) => {
          this._items = (msg && msg.items) || [];
          this._loaded = true;
          this._error = null;
          this._renderHead();
          this._renderGrid();
        },
        { type: "todo/item/subscribe", entity_id: entity }
      );
      if (entity !== this._config.entity) { try { unsub(); } catch (e) { /* ignore */ } return; }
      this._unsub = unsub;
    } catch (e) {
      this._loaded = true;
      this._error = `Could not read ${entity}: ${e && e.message ? e.message : e}`;
      this._renderGrid();
    }
  }

  _canDescribe() {
    const st = this._hass && this._hass.states && this._hass.states[this._config.entity];
    if (!st) return true;                       // unknown yet — assume yes
    const f = Number(st.attributes && st.attributes.supported_features) || 0;
    return (f & FEAT_DESCRIPTION) !== 0;
  }

  _entry(item) {
    return { item, meta: decodeMeta(item.description) };
  }

  _visible() {
    const cfg = this._config;
    let rows = (this._items || []).map((i) => this._entry(i));
    if (this._filter === "todo") rows = rows.filter((r) => r.item.status !== "completed");
    else if (this._filter === "done") rows = rows.filter((r) => r.item.status === "completed");
    if (this._type !== "all") rows = rows.filter((r) => r.meta && r.meta.mt === this._type);
    if (this._genre !== "all") {
      const want = this._genre.toLowerCase();
      rows = rows.filter((r) => r.meta && (r.meta.genres || [])
        .some((g) => String(g).toLowerCase() === want));
    }
    if (cfg.media_types.length === 1) {
      rows = rows.filter((r) => !r.meta || r.meta.mt === cfg.media_types[0]);
    }
    const num = (r) => {
      const m = r.meta || {};
      return parseFloat(m.imdb_rating || m.tmdb_rating || 0) || 0;
    };
    const sorters = {
      list: null,
      added_desc: (a, b) => String((b.meta && b.meta.added) || "").localeCompare(String((a.meta && a.meta.added) || "")),
      rating_desc: (a, b) => num(b) - num(a),
      year_desc: (a, b) => String((b.meta && b.meta.year) || "").localeCompare(String((a.meta && a.meta.year) || "")),
      title_asc: (a, b) => String(a.item.summary || "").localeCompare(String(b.item.summary || "")),
    };
    const s = sorters[this._sort];
    if (s) rows = rows.slice().sort(s);
    return rows;
  }

  /* Genres found on the items the *other* filters let through, so the
   * dropdown only ever offers something that would really show up.
   * Genre names come from TMDB in the configured language.               */
  _genreOptions() {
    const cfg = this._config;
    const found = new Map();                       // lower-case key -> label
    for (const item of this._items || []) {
      if (this._filter === "todo" && item.status === "completed") continue;
      if (this._filter === "done" && item.status !== "completed") continue;
      const meta = decodeMeta(item.description);
      if (!meta) continue;
      if (this._type !== "all" && meta.mt !== this._type) continue;
      if (cfg.media_types.length === 1 && meta.mt !== cfg.media_types[0]) continue;
      for (const g of meta.genres || []) {
        const label = String(g).trim();
        if (label) found.set(label.toLowerCase(), label);
      }
    }
    // keep the active genre selectable even when nothing matches it now
    if (this._genre !== "all" && !found.has(this._genre.toLowerCase())) {
      found.set(this._genre.toLowerCase(), this._genre);
    }
    return Array.from(found.values()).sort((a, b) => a.localeCompare(b));
  }

  /* ------------------------------------------------------------ chrome */

  _build() {
    if (this._built || !this.shadowRoot) return;
    const st = document.createElement("style");
    st.textContent = WL_STYLE;
    const card = document.createElement("ha-card");
    card.innerHTML =
      '<div class="head"></div><div class="bar"></div><div class="grid"></div>';
    const dlg = document.createElement("dialog");
    this.shadowRoot.append(st, card, dlg);
    this._el = {
      card,
      head: card.querySelector(".head"),
      bar: card.querySelector(".bar"),
      grid: card.querySelector(".grid"),
      dlg,
    };
    if (this._config.columns) {
      this._el.grid.style.gridTemplateColumns = `repeat(${this._config.columns},1fr)`;
    } else {
      this._el.grid.style.setProperty("--wl-tile", `${this._config.tile_width}px`);
    }
    this._el.grid.addEventListener("click", (ev) => {
      const t = ev.target.closest(".tile");
      if (t) this._openDetail(t.dataset.uid);
    });
    this._el.bar.addEventListener("click", (ev) => {
      const c = ev.target.closest(".chip");
      if (!c) return;
      if (c.dataset.filter) this._filter = c.dataset.filter;
      if (c.dataset.type) this._type = c.dataset.type;
      this._renderHead(); this._renderGrid();
    });
    dlg.addEventListener("click", (ev) => { if (ev.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => this._stopRoll());
    this._built = true;
    this._renderHead();
    this._renderGrid();
  }

  _listName() {
    if (this._config.title) return this._config.title;
    const st = this._hass && this._hass.states && this._hass.states[this._config.entity];
    return (st && st.attributes && st.attributes.friendly_name) || "Watchlist";
  }

  _renderHead() {
    if (!this._built) return;
    const rows = (this._items || []).map((i) => this._entry(i));
    const open = rows.filter((r) => r.item.status !== "completed");
    const done = rows.filter((r) => r.item.status === "completed");
    let mins = 0;
    for (const r of open) {
      const m = r.meta;
      if (!m) continue;
      if (m.mt === "tv") mins += (m.runtime || 0) * (m.episodes || 0);
      else mins += m.runtime || 0;
    }
    const sub = [
      `${open.length} to watch`,
      done.length ? `${done.length} watched` : "",
      mins ? bulkRuntime(mins) : "",
      this._genre !== "all" ? `${this._visible().length} in ${this._genre}` : "",
    ].filter(Boolean).join(" · ");

    this._el.head.innerHTML =
      `<div class="titles"><div class="title">${esc(this._listName())}</div>` +
      `<div class="sub">${esc(sub)}</div></div>` +
      (this._config.show_random_button
        ? '<button class="iconbtn" id="roll" title="Surprise me" ' +
          'aria-label="Pick something at random">' +
          '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
          `<path fill="currentColor" d="${WL_DICE}"/></svg></button>`
        : "") +
      `<button class="iconbtn primary" id="add" title="Add a title" aria-label="Add a title">` +
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>';
    this._el.head.querySelector("#add").onclick = () => this._openSearch();
    const rollBtn = this._el.head.querySelector("#roll");
    if (rollBtn) rollBtn.onclick = () => this._openRandom();

    const chip = (k, v, lbl) =>
      `<button class="chip" data-${k}="${v}" aria-pressed="${
        (k === "filter" ? this._filter : this._type) === v}">${esc(lbl)}</button>`;
    let bar = chip("filter", "todo", "To watch");
    if (this._config.show_watched_tab) bar += chip("filter", "done", "Watched");
    bar += chip("filter", "all", "All");
    if (this._config.media_types.length > 1) {
      bar += '<span style="width:8px"></span>' +
        chip("type", "all", "Any") + chip("type", "movie", "Movies") + chip("type", "tv", "TV");
    }
    bar += '<span class="sels">';
    if (this._config.show_genre_filter) {
      const genres = this._genreOptions();
      const active = this._genre.toLowerCase();
      bar += `<select class="genre" aria-label="Genre"${this._genre !== "all" ? ' data-on="1"' : ""}>` +
        `<option value="all"${this._genre === "all" ? " selected" : ""}>All genres</option>` +
        genres.map((g) =>
          `<option value="${esc(g)}"${g.toLowerCase() === active ? " selected" : ""}>${esc(g)}</option>`
        ).join("") + "</select>";
    }
    bar += '<select class="sort" aria-label="Sort">' +
      Object.entries(SORTS).map(([k, v]) =>
        `<option value="${k}"${k === this._sort ? " selected" : ""}>${esc(v.label)}</option>`
      ).join("") + "</select></span>";
    this._el.bar.innerHTML = bar;
    this._el.bar.querySelector(".sort").onchange = (ev) => {
      this._sort = ev.target.value; this._renderGrid();
    };
    const gsel = this._el.bar.querySelector(".genre");
    if (gsel) gsel.onchange = (ev) => {
      this._genre = ev.target.value;
      this._renderHead(); this._renderGrid();
    };
  }

  _renderGrid() {
    if (!this._built) return;
    const g = this._el.grid;
    if (this._error) {
      g.style.display = "block";
      g.innerHTML = `<div class="empty err">${esc(this._error)}</div>`;
      return;
    }
    if (!this._loaded) {
      g.style.display = "block";
      g.innerHTML = '<div class="spin"></div>';
      return;
    }
    if (!this._canDescribe()) {
      g.style.display = "block";
      g.innerHTML =
        '<div class="empty err">This to-do list cannot store descriptions, so it ' +
        'has nowhere to keep the poster and rating data.<br>Use a <b>Local To-do</b> ' +
        'list (Settings → Devices &amp; services → Add integration → Local To-do).</div>';
      return;
    }
    const rows = this._visible();
    if (!rows.length) {
      g.style.display = "block";
      if (this._genre !== "all") {
        g.innerHTML =
          `<div class="empty">Nothing tagged <b>${esc(this._genre)}</b> in this tab.` +
          '<br><br><button class="btn" id="clrgenre">Show all genres</button></div>';
        g.querySelector("#clrgenre").onclick = () => {
          this._genre = "all"; this._renderHead(); this._renderGrid();
        };
        return;
      }
      g.innerHTML =
        '<div class="empty">' +
        (this._filter === "done" ? "Nothing watched yet."
          : "Nothing here yet — tap + to add a film or show.") +
        "</div>";
      return;
    }
    g.style.display = "grid";
    g.innerHTML = rows.map((r) => this._tile(r)).join("");
  }

  _tile({ item, meta }) {
    const doneCls = item.status === "completed" ? " done" : "";
    const title = esc(meta && meta.title ? meta.title : item.summary || "");
    let art;
    if (meta && meta.poster) {
      art = `<img loading="lazy" src="${esc(img(meta.poster, "w342"))}" alt="">`;
    } else {
      art = `<div class="noart">${title}</div>`;
    }
    let over = "";
    if (meta) {
      const rating = meta.imdb_rating || meta.tmdb_rating;
      if (rating) {
        over += `<span class="badge${meta.imdb_rating ? "" : " tmdb"}">${esc(rating)}</span>`;
      }
      if (this._config.media_types.length > 1 && meta.mt === "tv") {
        over += '<span class="mtag">TV</span>';
      }
    } else {
      over += '<span class="miss">tap to look up</span>';
    }
    if (item.status === "completed") over += '<div class="check"><span>✓</span></div>';
    const sub = meta
      ? [meta.year, meta.mt === "tv" && meta.seasons ? `${meta.seasons} seasons` : ""]
          .filter(Boolean).join(" · ")
      : "";
    return (
      `<button class="tile${doneCls}" data-uid="${esc(item.uid)}">` +
      `<div class="art">${art}${over}</div>` +
      `<div class="cap">${title}</div>` +
      (sub ? `<div class="capy">${esc(sub)}</div>` : "") +
      "</button>"
    );
  }

  /* ----------------------------------------------------------- dialogs */

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", {
      detail: { message }, bubbles: true, composed: true,
    }));
  }

  _openDialog(html) {
    this._stopRoll();
    const d = this._el.dlg;
    d.innerHTML = html;
    if (!d.open) d.showModal();
    const c = d.querySelector(".close");
    if (c) c.onclick = () => d.close();
    return d;
  }

  _openDetail(uid) {
    const item = (this._items || []).find((i) => i.uid === uid);
    if (!item) return;
    const meta = decodeMeta(item.description);
    const done = item.status === "completed";

    if (!meta) {
      this._openDialog(
        '<div class="sheet"><button class="close">✕</button>' +
        '<div class="body pad">' +
        `<h2 class="dtitle">${esc(item.summary || "")}</h2>` +
        '<p class="over">No metadata yet. Look it up to pull the poster, ' +
        'synopsis and ratings.</p>' +
        '<div class="acts">' +
        '<button class="btn fill" id="lookup">Look up</button>' +
        `<button class="btn" id="watch">${done ? "Move back to watchlist" : "Mark watched"}</button>` +
        '<button class="btn danger" id="remove">Remove</button>' +
        "</div></div></div>"
      );
      this._wireDetail(item, meta);
      return;
    }

    const back = img(meta.backdrop, "w780") || img(meta.poster, "w780");
    const metaBits = [
      meta.mt === "tv" ? "Series" : "Film",
      meta.year,
      meta.mt === "tv"
        ? [meta.seasons ? `${meta.seasons} season${meta.seasons > 1 ? "s" : ""}` : "",
           meta.episodes ? `${meta.episodes} episodes` : ""].filter(Boolean).join(" · ")
        : runtimeStr(meta.runtime),
      meta.status && meta.mt === "tv" ? meta.status : "",
    ].filter(Boolean);

    const rates = [];
    if (meta.imdb_rating) rates.push(
      `<div class="rate imdb"><b>${esc(meta.imdb_rating)}</b><span>IMDb${
        meta.imdb_votes ? ` · ${esc(meta.imdb_votes)}` : ""}</span></div>`);
    if (meta.tmdb_rating) rates.push(
      `<div class="rate tmdb"><b>${esc(meta.tmdb_rating)}</b><span>TMDB</span></div>`);
    if (meta.rt) rates.push(`<div class="rate rt"><b>${esc(meta.rt)}</b><span>Tomatometer</span></div>`);
    if (meta.mc) rates.push(`<div class="rate"><b>${esc(meta.mc)}</b><span>Metascore</span></div>`);

    const provs = (this._config.show_providers && (meta.providers || []).length)
      ? `<p class="seclbl">Streaming in ${esc(this._config.region)}</p><div class="provs">` +
        meta.providers.map((p) =>
          `<span class="prov">${p.l ? `<img src="${esc(img(p.l, "w92"))}" alt="">` : ""}${esc(p.n)}</span>`
        ).join("") + "</div>"
      : "";

    const links = [];
    if (meta.imdb) links.push(`<a href="https://www.imdb.com/title/${esc(meta.imdb)}/" target="_blank" rel="noopener">IMDb ↗</a>`);
    links.push(`<a href="https://www.themoviedb.org/${esc(meta.mt)}/${esc(meta.id)}" target="_blank" rel="noopener">TMDB ↗</a>`);

    this._openDialog(
      '<div class="sheet"><button class="close">✕</button>' +
      (back ? `<div class="hero"><img src="${esc(back)}" alt=""></div>` : "") +
      `<div class="body${back ? "" : " pad"}">` +
      `<h2 class="dtitle">${esc(meta.title || item.summary)}</h2>` +
      (meta.original && meta.original !== meta.title
        ? `<p class="dorig">${esc(meta.original)}</p>` : "") +
      `<div class="metarow">${metaBits.map((b) => esc(b)).join(" · ")}` +
      (meta.cert ? ` <span class="pill">${esc(meta.cert)}</span>` : "") +
      (meta.genres || []).map((g) => ` <span class="pill">${esc(g)}</span>`).join("") +
      "</div>" +
      (rates.length ? `<div class="rates">${rates.join("")}</div>` : "") +
      (meta.overview ? `<p class="over">${esc(meta.overview)}</p>` : "") +
      provs +
      '<div class="acts">' +
      `<button class="btn fill" id="watch">${done ? "Move back to watchlist" : "Mark watched"}</button>` +
      '<button class="btn" id="lookup">Refresh data</button>' +
      '<button class="btn danger" id="remove">Remove</button>' +
      "</div>" +
      `<div class="links">${links.join("")}</div>` +
      "</div></div>"
    );
    this._wireDetail(item, meta);
  }

  _wireDetail(item, meta) {
    const d = this._el.dlg;
    const done = item.status === "completed";
    const w = d.querySelector("#watch");
    if (w) w.onclick = async () => {
      w.disabled = true;
      await this._setStatus(item, done ? "needs_action" : "completed");
      d.close();
    };
    const l = d.querySelector("#lookup");
    if (l) l.onclick = () => {
      if (meta && meta.id) this._refresh(item, meta, l);
      else this._openSearch(item.summary, item.uid);
    };
    const r = d.querySelector("#remove");
    if (r) r.onclick = async () => {
      r.disabled = true;
      await this._remove(item);
      d.close();
    };
  }

  _openSearch(prefill, targetUid) {
    const cfg = this._config;
    if (!cfg.tmdb_api_key) {
      this._openDialog(
        '<div class="sheet"><button class="close">✕</button>' +
        '<div class="note err">No TMDB API key configured.<br>' +
        'Add <code>tmdb_api_key</code> to the card configuration.</div></div>'
      );
      return;
    }
    const d = this._openDialog(
      '<div class="sheet"><button class="close">✕</button>' +
      '<div class="srchhead"><input type="search" id="q" autocomplete="off" ' +
      `placeholder="Search films and shows…" value="${esc(prefill || "")}"></div>` +
      '<div class="results" id="res"><div class="note">Start typing to search TMDB.</div></div>' +
      "</div>"
    );
    const input = d.querySelector("#q");
    const res = d.querySelector("#res");
    const known = new Set(
      (this._items || []).map((i) => { const m = decodeMeta(i.description); return m ? `${m.mt}:${m.id}` : null; })
        .filter(Boolean)
    );

    const run = async (q) => {
      if (!q || q.trim().length < 2) {
        res.innerHTML = '<div class="note">Start typing to search TMDB.</div>';
        return;
      }
      res.innerHTML = '<div class="spin"></div>';
      try {
        const hits = await tmdbSearch(cfg.tmdb_api_key, q.trim(), cfg.language, cfg.media_types);
        if (!hits.length) { res.innerHTML = '<div class="note">Nothing found.</div>'; return; }
        res.innerHTML = hits.map((h, idx) => {
          const on = known.has(`${h.mt}:${h.id}`);
          const thumb = h.poster
            ? `<img loading="lazy" src="${esc(img(h.poster, "w92"))}" alt="">`
            : '<span class="ph"></span>';
          const line = [h.mt === "tv" ? "TV" : "Film", h.year,
            h.tmdb_rating ? `TMDB ${h.tmdb_rating}` : ""].filter(Boolean).join(" · ");
          // when attaching metadata to an existing item, keep the row clickable
          return `<button class="res" data-i="${idx}"${on && !targetUid ? " disabled" : ""}>${thumb}` +
            `<span class="rt2"><span class="rn">${esc(h.title)}</span>` +
            `<span class="rm">${esc(line)}</span>` +
            (on ? '<span class="on">already on the list</span>' : "") +
            "</span></button>";
        }).join("");
        res.querySelectorAll(".res").forEach((btn) => {
          btn.onclick = () => this._pick(hits[Number(btn.dataset.i)], targetUid, res);
        });
      } catch (e) {
        res.innerHTML = `<div class="note err">TMDB search failed: ${esc(e.message || e)}</div>`;
      }
    };

    const deferred = debounce((v) => run(v), 350);
    input.addEventListener("input", () => deferred(input.value));
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") run(input.value); });
    setTimeout(() => { input.focus(); if (prefill) run(prefill); }, 60);
  }

  /* ------------------------------------------------------- random pick */

  _stopRoll() {
    if (this._rollTimer) { clearTimeout(this._rollTimer); this._rollTimer = null; }
  }

  _rollFace(row) {
    const meta = row.meta;
    const title = esc(meta && meta.title ? meta.title : row.item.summary || "");
    return meta && meta.poster
      ? `<img src="${esc(img(meta.poster, "w342"))}" alt="">`
      : `<div class="noart">${title}</div>`;
  }

  _rollLine(row) {
    const m = row.meta || {};
    return [
      m.mt === "tv" ? "Series" : (m.mt === "movie" ? "Film" : ""),
      m.year,
      m.mt === "tv"
        ? (m.seasons ? `${m.seasons} season${m.seasons > 1 ? "s" : ""}` : "")
        : runtimeStr(m.runtime),
      (m.genres || []).slice(0, 2).join(", "),
      m.imdb_rating ? `IMDb ${m.imdb_rating}`
        : (m.tmdb_rating ? `TMDB ${m.tmdb_rating}` : ""),
    ].filter(Boolean).join(" · ");
  }

  /* Picks one of whatever the tabs, the type chips and the genre dropdown
   * are currently showing, with a short roulette on the way there.       */
  _openRandom() {
    const shown = this._visible();
    // titles that were never looked up have no poster, runtime or rating, so
    // they make a poor "what shall we watch" answer — skip them if we can
    const withMeta = shown.filter((r) => r.meta);
    const pool = withMeta.length ? withMeta : shown;
    if (!pool.length) {
      this._toast(this._genre !== "all"
        ? `Nothing tagged ${this._genre} to pick from.`
        : "Nothing to pick from here.");
      return;
    }

    let winner = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) {                       // don't repeat the last roll
      for (let i = 0; i < 8 && winner.item.uid === this._lastRoll; i++) {
        winner = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    this._lastRoll = winner.item.uid;

    const scope = [
      this._filter === "done" ? "watched" : (this._filter === "all" ? "everything" : ""),
      this._type === "movie" ? "films" : (this._type === "tv" ? "series" : ""),
      this._genre !== "all" ? this._genre : "",
    ].filter(Boolean).join(" · ");

    const d = this._openDialog(
      '<div class="sheet"><button class="close">✕</button>' +
      '<div class="body pad roll rolling">' +
      `<p class="seclbl" id="rlbl">Picking from ${pool.length} title${
        pool.length > 1 ? "s" : ""}${scope ? ` · ${esc(scope)}` : ""}</p>` +
      '<div class="rollart" id="rart"></div>' +
      '<div class="rolltitle" id="rtit">&nbsp;</div>' +
      '<div class="rollsub" id="rsub">&nbsp;</div>' +
      '<div class="acts" id="racts"></div>' +
      "</div></div>"
    );
    const box = d.querySelector(".roll");
    const art = d.querySelector("#rart");
    const tit = d.querySelector("#rtit");

    const paint = (row) => {
      art.innerHTML = this._rollFace(row);
      tit.textContent = (row.meta && row.meta.title) || row.item.summary || "";
    };

    const land = () => {
      this._rollTimer = null;
      box.classList.remove("rolling");
      paint(winner);
      d.querySelector("#rlbl").textContent = "Tonight’s pick";
      d.querySelector("#rsub").textContent = this._rollLine(winner) || "";
      d.querySelector("#racts").innerHTML =
        '<button class="btn fill" id="rdet">Open details</button>' +
        (pool.length > 1 ? '<button class="btn" id="ragain">Roll again</button>' : "");
      const det = d.querySelector("#rdet");
      if (det) det.onclick = () => this._openDetail(winner.item.uid);
      const again = d.querySelector("#ragain");
      if (again) again.onclick = () => this._openRandom();
    };

    const still = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pool.length === 1 || still) { land(); return; }

    const seq = [];
    const steps = 9 + Math.floor(Math.random() * 3);
    for (let i = 0; i < steps; i++) {
      seq.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    let i = 0;
    const tick = () => {
      paint(seq[i]);
      const delay = 62 + i * i * 4;             // eases out towards the end
      i += 1;
      this._rollTimer = setTimeout(i < seq.length ? tick : land, delay);
    };
    tick();
  }

  /* ----------------------------------------------------------- actions */

  async _pick(hit, targetUid, res) {
    const cfg = this._config;
    res.innerHTML = '<div class="spin"></div>';
    try {
      const meta = await buildMeta(cfg, hit.id, hit.mt);
      const description = encodeMeta(meta);
      if (targetUid) {
        const data = { entity_id: cfg.entity, item: targetUid, description };
        if (cfg.rename_on_lookup && meta.title) data.rename = meta.title;
        await this._hass.callService("todo", "update_item", data);
      } else {
        await this._hass.callService("todo", "add_item", {
          entity_id: cfg.entity, item: meta.title || hit.title, description,
        });
      }
      this._el.dlg.close();
      this._toast(`${meta.title} added to ${this._listName()}`);
    } catch (e) {
      res.innerHTML = `<div class="note err">Could not add it: ${esc(e.message || e)}</div>`;
    }
  }

  async _refresh(item, meta, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
    try {
      const fresh = await buildMeta(this._config, meta.id, meta.mt);
      fresh.added = meta.added || fresh.added;
      await this._hass.callService("todo", "update_item", {
        entity_id: this._config.entity, item: item.uid, description: encodeMeta(fresh),
      });
      this._el.dlg.close();
      this._toast(`${fresh.title} refreshed`);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Refresh data"; }
      this._toast(`Refresh failed: ${e.message || e}`);
    }
  }

  async _setStatus(item, status) {
    try {
      const data = { entity_id: this._config.entity, item: item.uid, status };
      if (this._canDescribe() && item.description) data.description = item.description;
      await this._hass.callService("todo", "update_item", data);
    } catch (e) {
      this._toast(`Could not update: ${e.message || e}`);
    }
  }

  async _remove(item) {
    try {
      await this._hass.callService("todo", "remove_item", {
        entity_id: this._config.entity, item: item.uid,
      });
    } catch (e) {
      this._toast(`Could not remove: ${e.message || e}`);
    }
  }
}

customElements.define("watchlist-card", WatchlistCard);

/* ----------------------------------------------------------------- editor */

const WL_SCHEMA = [
  { name: "entity", required: true, selector: { entity: { domain: "todo" } } },
  { name: "title", selector: { text: {} } },
  { name: "tmdb_api_key", required: true, selector: { text: {} } },
  { name: "omdb_api_key", selector: { text: {} } },
  {
    name: "", type: "grid", schema: [
      { name: "language", selector: { text: {} } },
      { name: "region", selector: { text: {} } },
      { name: "tile_width", selector: { number: { min: 70, max: 240, mode: "box", unit_of_measurement: "px" } } },
      { name: "columns", selector: { number: { min: 0, max: 12, mode: "box" } } },
    ],
  },
  {
    name: "media_types", selector: {
      select: {
        multiple: true, mode: "list",
        options: [{ value: "movie", label: "Movies" }, { value: "tv", label: "TV shows" }],
      },
    },
  },
  {
    name: "", type: "grid", schema: [
      {
        name: "default_filter", selector: {
          select: {
            mode: "dropdown", options: [
              { value: "todo", label: "To watch" },
              { value: "done", label: "Watched" },
              { value: "all", label: "All" },
            ],
          },
        },
      },
      {
        name: "default_sort", selector: {
          select: {
            mode: "dropdown",
            options: Object.entries(SORTS).map(([value, v]) => ({ value, label: v.label })),
          },
        },
      },
    ],
  },
  {
    name: "", type: "grid", schema: [
      { name: "show_watched_tab", selector: { boolean: {} } },
      { name: "show_genre_filter", selector: { boolean: {} } },
      { name: "show_random_button", selector: { boolean: {} } },
      { name: "show_providers", selector: { boolean: {} } },
      { name: "rename_on_lookup", selector: { boolean: {} } },
    ],
  },
];

const WL_LABELS = {
  entity: "To-do list",
  title: "Card title (optional)",
  tmdb_api_key: "TMDB API key",
  omdb_api_key: "OMDb API key (for IMDb ratings)",
  language: "Language (e.g. en-US)",
  region: "Streaming region (e.g. DE)",
  tile_width: "Minimum poster width",
  columns: "Fixed columns (0 = auto)",
  media_types: "Include",
  default_filter: "Default tab",
  default_sort: "Default sort",
  show_watched_tab: "Show 'Watched' tab",
  show_genre_filter: "Show genre dropdown",
  show_random_button: "Show 'Surprise me' button",
  show_providers: "Show streaming providers",
  rename_on_lookup: "Use the official title",
};

async function wlEnsureHaForm() {
  if (customElements.get("ha-form")) return true;
  try {
    const helpers = await window.loadCardHelpers();
    const el = await helpers.createCardElement({ type: "entities", entities: [] });
    if (el && el.constructor && el.constructor.getConfigElement) {
      await el.constructor.getConfigElement();
    }
  } catch (e) { /* ignore */ }
  await Promise.race([
    customElements.whenDefined("ha-form"),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  return !!customElements.get("ha-form");
}

class WatchlistCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { language: "en-US", region: "DE", ...config };
    this._render();
  }
  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  async _render() {
    if (this._form) { this._form.data = this._config; return; }
    if (this._rendering) return;
    this._rendering = true;
    const ok = await wlEnsureHaForm();
    this._rendering = false;
    if (!ok) {
      this.innerHTML =
        '<p style="padding:8px 0">The visual editor could not load. ' +
        'Switch to <b>Show code editor</b> and configure the card in YAML.</p>';
      return;
    }
    const form = document.createElement("ha-form");
    form.hass = this._hass;
    form.data = this._config;
    form.schema = WL_SCHEMA;
    form.computeLabel = (s) => WL_LABELS[s.name] || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const config = { type: "custom:watchlist-card", ...ev.detail.value };
      if (!config.columns) delete config.columns;
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config }, bubbles: true, composed: true,
      }));
    });
    this._form = form;
    this.innerHTML = "";
    this.appendChild(form);
  }
}

customElements.define("watchlist-card-editor", WatchlistCardEditor);

/* ----------------------------------------------------------- registration */

window.customCards = window.customCards || [];
window.customCards.push({
  type: "watchlist-card",
  name: "Watchlist Card",
  description: "A poster wall for a to-do list — films and shows with artwork, metadata and IMDb ratings.",
  preview: false,
});

console.info(
  `%c WATCHLIST-CARD %c ${WL_VERSION} `,
  "color:#fff;background:#f5c518;font-weight:700",
  "color:#f5c518;background:#222"
);
