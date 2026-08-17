import test from "node:test";
import assert from "node:assert/strict";
import { getSbsMediaId, parseCsv, toMovie } from "../server.mjs";

test("toMovie maps ranking fields and preserves list fallbacks", () => {
  assert.deepEqual(
    toMovie(
      { id: 12, title: "Fallback", year: 1999, imdb_id: "tt123" },
      { title: "Film", user_rating: 8.2, critic_score: 91, runtime_minutes: 95, genre_names: ["Drama"] },
    ),
    {
      id: 12,
      title: "Film",
      year: 1999,
      imdbId: "tt123",
      imdbTop100Rank2020: null,
      imdbRating2020: null,
      imdbVotes2020: null,
      sbsMediaId: null,
      sbsUrl: null,
      sbsExpiresAt: null,
      languages: [],
      userRating: 8.2,
      criticScore: 91,
      runtimeMinutes: 95,
      genres: ["Drama"],
      plot: null,
    },
  );
});

test("getSbsMediaId extracts the SBS asset ID", () => {
  assert.equal(
    getSbsMediaId("https://www.sbs.com.au/ondemand/movie/the-lives-of-others/317983299630"),
    "317983299630",
  );
});

test("parseCsv handles quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsv('id,title\r\n1,"A, Film"\r\n2,"Say ""Hi"""\r\n'), [
    ["id", "title"],
    ["1", "A, Film"],
    ["2", 'Say "Hi"'],
  ]);
});
