import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const CACHE_FILE = join(ROOT, "data", "catalog.json");
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const WATCHMODE_URL = "https://api.watchmode.com/v1";
const IMDB_TOP_100_URL = "https://gist.githubusercontent.com/stungeye/a3af50385215b758637e73eaacac93a3/raw/c1f936ae9dedc4d80398e6c11dbc95835c3c8f20/movies.csv";
const SBS_CATALOG_URL = "https://catalogue.pr.sbsod.com/collections/all-movies";
const SBS_SOURCE_ID = "429";
const REQUEST_INTERVAL_MS = 250;
const QUOTA_RESERVE = 20;
const MAX_TIMER_MS = 2_147_483_647;
const RATING_BANDS = [
  { low: "8", high: "10" },
  { low: "7", high: "7.99" },
  { low: "6", high: "6.99" },
];

let syncPromise = null;
let lastRequestAt = 0;
let syncState = { status: "idle", message: null };

async function loadEnv() {
  try {
    const source = await readFile(join(ROOT, ".env"), "utf8");
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function getImdbTop100() {
  const response = await fetch(IMDB_TOP_100_URL, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`IMDb Top 100 dataset returned ${response.status}`);
  const rows = parseCsv(await response.text());
  const headers = rows.shift();
  const idIndex = headers.indexOf("imdb_title_id");
  const ratingIndex = headers.indexOf("avg_vote");
  const votesIndex = headers.indexOf("votes");

  return new Map(rows.slice(0, 100).map((row, index) => [row[idIndex], {
    rank: index + 1,
    rating: Number(row[ratingIndex]),
    votes: Number(row[votesIndex]),
  }]));
}

async function getCurrentSbsCatalog() {
  const items = [];
  let cursor = null;

  do {
    const url = new URL(SBS_CATALOG_URL);
    if (cursor) url.searchParams.set("cursor", cursor);
    else url.searchParams.set("limit", "100");
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`SBS catalogue returned ${response.status}`);
    const page = await response.json();
    items.push(...page.items);
    cursor = page.meta?.nextCursor ?? null;
  } while (cursor);

  const now = Date.now();
  return new Map(items
    .filter((item) => {
      const starts = Date.parse(item.availability?.start ?? 0);
      const ends = Date.parse(item.availability?.end ?? 0);
      return starts <= now && now <= ends;
    })
    .map((item) => [String(item.mpxMediaID), item]));
}

function getSbsMediaId(url) {
  return url?.match(/\/(\d+)\/?(?:\?.*)?$/)?.[1] ?? null;
}

function getSbsUrl(item) {
  return `https://www.sbs.com.au/ondemand/movie/${item.slug}/${item.mpxMediaID}`;
}

async function watchmode(path, params = {}, attempt = 0) {
  const wait = Math.max(0, lastRequestAt + REQUEST_INTERVAL_MS - Date.now());
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();

  const url = new URL(`${WATCHMODE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { "X-API-Key": process.env.WATCHMODE_API_KEY },
    signal: AbortSignal.timeout(20_000),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 2 ** attempt * 1000;
    await sleep(delay);
    return watchmode(path, params, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Watchmode ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

async function getCachedCatalog() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function cacheIsFresh() {
  try {
    const catalog = await getCachedCatalog();
    return Date.now() - new Date(catalog.refreshedAt).getTime() < CACHE_MAX_AGE_MS;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function getRankedSbsCandidates() {
  const titles = new Map();

  for (const band of RATING_BANDS) {
    const query = {
      source_ids: SBS_SOURCE_ID,
      regions: "AU",
      types: "movie",
      limit: "250",
      sort_by: "popularity_desc",
      user_rating_low: band.low,
      user_rating_high: band.high,
    };
    const firstPage = await watchmode("/list-titles/", { ...query, page: "1" });
    for (const title of firstPage.titles) titles.set(title.id, title);

    for (let page = 2; page <= firstPage.total_pages; page += 1) {
      const result = await watchmode("/list-titles/", { ...query, page: String(page) });
      for (const title of result.titles) titles.set(title.id, title);
    }
  }

  return [...titles.values()];
}

async function checkQuota(requiredCredits) {
  const status = await watchmode("/status/");
  const quota = status.quota ?? status.account_quota;
  const used = status.quotaUsed ?? status.quota_used ?? status.account_quota_used;

  if (Number.isFinite(quota) && Number.isFinite(used)) {
    const available = quota - used;
    if (available < requiredCredits + QUOTA_RESERVE) {
      throw new Error(`Refresh needs about ${requiredCredits} credits; only ${available} remain this month.`);
    }
  }
}

function toMovie(summary, details, imdbTop100 = new Map(), sbsItem = null) {
  const imdbId = details.imdb_id ?? summary.imdb_id;
  const imdbEntry = imdbTop100.get(imdbId);
  return {
    id: summary.id,
    title: details.title ?? summary.title,
    year: details.year ?? summary.year,
    imdbId,
    imdbTop100Rank2020: imdbEntry?.rank ?? null,
    imdbRating2020: imdbEntry?.rating ?? null,
    imdbVotes2020: imdbEntry?.votes ?? null,
    sbsMediaId: sbsItem ? String(sbsItem.mpxMediaID) : null,
    sbsUrl: sbsItem ? getSbsUrl(sbsItem) : null,
    sbsExpiresAt: sbsItem?.availability?.end ?? null,
    userRating: details.user_rating ?? null,
    criticScore: details.critic_score ?? null,
    runtimeMinutes: details.runtime_minutes ?? null,
    genres: details.genre_names ?? [],
    plot: details.plot_overview ?? null,
  };
}

async function refreshCatalog({ force = false } = {}) {
  if (!process.env.WATCHMODE_API_KEY) throw new Error("WATCHMODE_API_KEY is not configured.");
  if (!force && (await cacheIsFresh())) return getCachedCatalog();

  syncState = { status: "syncing", message: "Checking the SBS catalogue" };
  const [summaries, imdbTop100, sbsCatalog] = await Promise.all([
    getRankedSbsCandidates(),
    getImdbTop100(),
    getCurrentSbsCatalog(),
  ]);
  await checkQuota(summaries.length * 2);
  syncState = { status: "syncing", message: `Fetching ratings for ${summaries.length} movies` };

  const movies = [];
  for (let index = 0; index < summaries.length; index += 1) {
    const summary = summaries[index];
    const sources = await watchmode(`/title/${summary.id}/sources/`, { regions: "AU" });
    const sbsUrl = sources.find((source) => source.source_id === Number(SBS_SOURCE_ID))?.web_url ?? null;
    const sbsItem = sbsCatalog.get(getSbsMediaId(sbsUrl));
    if (sbsItem) {
      const details = await watchmode(`/title/${summary.id}/details/`);
      movies.push(toMovie(summary, details, imdbTop100, sbsItem));
    }
    syncState.message = `Fetching ratings: ${index + 1} of ${summaries.length}`;
  }

  movies.sort((a, b) =>
    (b.userRating ?? -1) - (a.userRating ?? -1) ||
    (b.criticScore ?? -1) - (a.criticScore ?? -1) ||
    a.title.localeCompare(b.title),
  );

  const catalog = {
    refreshedAt: new Date().toISOString(),
    source: "Watchmode / SBS On Demand (AU)",
    sbsValidatedAt: new Date().toISOString(),
    ratingNote: "User ratings are Watchmode aggregated audience scores, not IMDb ratings.",
    movies,
  };

  await mkdir(join(ROOT, "data"), { recursive: true });
  const tempFile = `${CACHE_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(catalog), "utf8");
  await rename(tempFile, CACHE_FILE);
  syncState = { status: "ready", message: null };
  return catalog;
}

async function enrichCachedCatalog() {
  const catalog = await getCachedCatalog();
  if (!catalog) throw new Error("No cached catalogue is available to enrich.");
  const imdbTop100 = await getImdbTop100();
  catalog.movies = catalog.movies.map((movie) => {
    const entry = imdbTop100.get(movie.imdbId);
    return {
      ...movie,
      imdbTop100Rank2020: entry?.rank ?? null,
      imdbRating2020: entry?.rating ?? null,
      imdbVotes2020: entry?.votes ?? null,
    };
  });
  catalog.imdbDataset = "IMDb Top 100 snapshot from July 2020, via stungeye/movies.csv";
  const tempFile = `${CACHE_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(catalog), "utf8");
  await rename(tempFile, CACHE_FILE);
}

async function validateCachedCatalogAgainstSbs() {
  const catalog = await getCachedCatalog();
  if (!catalog) throw new Error("No cached catalogue is available to validate.");
  const sbsCatalog = await getCurrentSbsCatalog();
  catalog.movies = catalog.movies.flatMap((movie) => {
    const mediaId = movie.sbsMediaId ?? getSbsMediaId(movie.sbsUrl);
    const item = sbsCatalog.get(mediaId);
    return item ? [{
      ...movie,
      sbsMediaId: mediaId,
      sbsUrl: getSbsUrl(item),
      sbsExpiresAt: item.availability?.end ?? null,
    }] : [];
  });
  catalog.sbsValidatedAt = new Date().toISOString();
  const tempFile = `${CACHE_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(catalog), "utf8");
  await rename(tempFile, CACHE_FILE);
}

function startRefresh(options) {
  if (!syncPromise) {
    syncPromise = refreshCatalog(options)
      .catch((error) => {
        syncState = { status: "error", message: error.message };
        console.error(error.message);
        throw error;
      })
      .finally(() => {
        syncPromise = null;
      });
  }
  return syncPromise;
}

function scheduleMonthlyRefresh(refreshAt = Date.now() + CACHE_MAX_AGE_MS) {
  const remaining = refreshAt - Date.now();
  const timer = setTimeout(() => {
    if (remaining > MAX_TIMER_MS) {
      scheduleMonthlyRefresh(refreshAt);
    } else {
      startRefresh({ force: true }).catch(() => {}).finally(() => scheduleMonthlyRefresh());
    }
  }, Math.min(remaining, MAX_TIMER_MS));
  timer.unref();
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");

  if (url.pathname === "/api/movies") {
    const catalog = await getCachedCatalog();
    if (catalog) return sendJson(response, 200, catalog);
    return sendJson(response, 202, { ...syncState, movies: [] });
  }

  if (url.pathname === "/api/status") return sendJson(response, 200, syncState);

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(response, 403, { error: "Forbidden" });

  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
    response.end(file);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    throw error;
  }
}

async function main() {
  await loadEnv();

  if (process.argv.includes("--sync-only")) {
    await startRefresh({ force: true });
  } else if (process.argv.includes("--enrich-only")) {
    await enrichCachedCatalog();
  } else if (process.argv.includes("--validate-only")) {
    await validateCachedCatalogAgainstSbs();
  } else {
    const server = createServer((request, response) => {
      handleRequest(request, response).catch((error) => {
        console.error(error);
        sendJson(response, 500, { error: "Internal server error" });
      });
    });

    server.listen(Number(process.env.PORT) || 3000, () => {
      console.log(`SBS Best Movies: http://localhost:${Number(process.env.PORT) || 3000}`);
    });

    startRefresh().catch(() => {});
    scheduleMonthlyRefresh();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { getSbsMediaId, parseCsv, toMovie };
