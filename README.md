# SBS Best Movies

A small server-backed site that ranks movies currently on SBS On Demand by Watchmode's aggregated audience rating.

## Run

1. [Request a free Watchmode API key](https://api.watchmode.com/requestApiKey). The free plan currently includes 2,500 monthly requests.
2. Copy `.env.example` to `.env` and set `WATCHMODE_API_KEY` to your key.
3. Run `npm start`.
4. Open `http://localhost:3000`.

See the [Watchmode API documentation](https://api.watchmode.com/docs) for endpoint and account details. Keep `.env` private; it and the generated catalogue are excluded from Git.

## Refreshing and hosting

Nothing refreshes while the Node process is stopped. If you run the site locally rather than hosting it continuously, update it manually before starting:

```sh
npm run sync      # Full Watchmode and SBS refresh
npm run validate  # Recheck cached availability against SBS only
npm run enrich    # Reapply the historical IMDb Top 100 data
npm start         # Serve the site at http://localhost:3000
```

`npm run sync` is the only quota-heavy command. Watchmode's free plan currently allows 2,500 requests per month. A full sync uses one source request per candidate and one detail request per SBS-verified movie, plus a few catalogue requests. With the current catalogue this is roughly 1,400 requests, so do not run a full sync more than once per month on the free plan. The command checks remaining quota and keeps a safety reserve before starting the title requests.

`npm run validate` calls SBS directly and uses no Watchmode quota. `npm run enrich` downloads the static IMDb CSV and also uses no Watchmode quota.

`npm start` checks `data/catalog.json` and automatically starts a refresh if the cache is missing or at least 30 days old. A continuously running server schedules another refresh every 30 days. The cache requires a persistent filesystem; an ephemeral host would lose it on restart and unnecessarily trigger another full sync.

The first run builds the catalogue and may take several minutes. Watchmode cannot sort by audience rating, so the server requests 250-title pages in descending rating bands (8+, 7–7.99, then 6–6.99) before fetching exact details in that order. Movies below 6 and unrated movies are excluded.

The server checks available quota before fetching title details, spaces API calls 250 ms apart, retries rate limits with backoff, and only replaces the cache after a complete refresh.

Each monthly refresh also retrieves the canonical SBS watch URL from Watchmode's title sources endpoint. This doubles the maximum per-title Watchmode cost to two credits. Before fetching details or displaying a movie, its SBS media ID is verified against SBS's own current `all-movies` catalogue and availability window. Stale Watchmode entries are discarded. Run `npm run validate` to revalidate an existing cache directly against SBS without spending Watchmode credits.

The cached non-image data is refreshed within Watchmode's 30-day cache allowance. The site intentionally does not use Watchmode poster URLs because its terms prohibit hotlinking and do not grant image usage rights.

Movies included in the linked 2020 IMDb Top 100 CSV also show that snapshot's IMDb rating and rank. These are labelled as 2020 values and are not presented as current IMDb ratings. `npm run enrich` applies this data to an existing catalogue without spending Watchmode credits.
