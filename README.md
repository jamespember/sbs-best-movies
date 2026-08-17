# SBS Best Movies

A small server-backed site that ranks movies currently on SBS On Demand by Watchmode's aggregated audience rating.

## Run

1. Add your Watchmode key to `.env` (see `.env.example`).
2. Run `npm start`.
3. Open `http://localhost:3000`.

The first run builds the catalogue and may take several minutes. Watchmode cannot sort by audience rating, so the server requests 250-title pages in descending rating bands (8+, 7–7.99, then 6–6.99) before fetching exact details in that order. Movies below 6 and unrated movies are excluded.

The server refreshes every 30 days, checks available quota before fetching title details, spaces API calls 250 ms apart, retries rate limits with backoff, and only replaces the cache after a complete refresh. Run `npm run sync` to force a refresh manually.

Each monthly refresh also retrieves the canonical SBS watch URL from Watchmode's title sources endpoint. This doubles the maximum per-title Watchmode cost to two credits. Before fetching details or displaying a movie, its SBS media ID is verified against SBS's own current `all-movies` catalogue and availability window. Stale Watchmode entries are discarded. Run `npm run validate` to revalidate an existing cache directly against SBS without spending Watchmode credits.

The cached non-image data is refreshed within Watchmode's 30-day cache allowance. The site intentionally does not use Watchmode poster URLs because its terms prohibit hotlinking and do not grant image usage rights.

Movies included in the linked 2020 IMDb Top 100 CSV also show that snapshot's IMDb rating and rank. These are labelled as 2020 values and are not presented as current IMDb ratings. `npm run enrich` applies this data to an existing catalogue without spending Watchmode credits.
