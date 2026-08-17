const list = document.querySelector("#movies");
const template = document.querySelector("#movie-template");
const search = document.querySelector("#search");
const rating = document.querySelector("#rating");
const genre = document.querySelector("#genre");
const language = document.querySelector("#language");
const decade = document.querySelector("#decade");
const runtime = document.querySelector("#runtime");
const sort = document.querySelector("#sort");
const imdbTop = document.querySelector("#imdb-top");
const reset = document.querySelector("#reset");
const lucky = document.querySelector("#lucky");
const luckyAgain = document.querySelector("#lucky-again");
const luckyModal = document.querySelector("#lucky-modal");
const summary = document.querySelector("#summary");
const updated = document.querySelector("#updated");
const empty = document.querySelector("#empty");

let movies = [];
let visibleMovies = [];
let lastLuckyId = null;

function formatRuntime(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatExpiry(value) {
  if (!value) return null;
  const expiry = new Date(value);
  const days = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86_400_000));
  if (days === 0) return "Leaves today";
  if (days === 1) return "Leaves tomorrow";
  if (days <= 14) return `Leaves in ${days} days`;
  return `Leaves ${expiry.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: expiry.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  })}`;
}

function render() {
  const query = search.value.trim().toLowerCase();
  const minimum = Number(rating.value);
  const maximumRuntime = Number(runtime.value) || Infinity;
  const filtered = movies.filter((movie) => {
    const text = `${movie.title} ${movie.genres.join(" ")} ${(movie.languages ?? []).join(" ")}`.toLowerCase();
    const movieDecade = Math.floor(movie.year / 10) * 10;
    return (!query || text.includes(query))
      && (movie.userRating ?? 0) >= minimum
      && (!genre.value || movie.genres.includes(genre.value))
      && (!language.value || movie.languages?.includes(language.value))
      && (!decade.value || movieDecade === Number(decade.value))
      && (!movie.runtimeMinutes || movie.runtimeMinutes <= maximumRuntime)
      && (!imdbTop.checked || movie.imdbTop100Rank2020 !== null);
  }).sort((a, b) => {
    if (sort.value === "critics") return (b.criticScore ?? -1) - (a.criticScore ?? -1) || compareAudience(a, b);
    if (sort.value === "newest") return (b.year ?? 0) - (a.year ?? 0) || compareAudience(a, b);
    if (sort.value === "oldest") return (a.year ?? Infinity) - (b.year ?? Infinity) || compareAudience(a, b);
    if (sort.value === "title") return a.title.localeCompare(b.title);
    if (sort.value === "runtime") return (a.runtimeMinutes ?? Infinity) - (b.runtimeMinutes ?? Infinity) || compareAudience(a, b);
    if (sort.value === "expiry") {
      return (Date.parse(a.sbsExpiresAt) || Infinity) - (Date.parse(b.sbsExpiresAt) || Infinity) || compareAudience(a, b);
    }
    if (sort.value === "imdb") return (b.imdbRating2020 ?? -1) - (a.imdbRating2020 ?? -1) || compareAudience(a, b);
    return compareAudience(a, b);
  });
  visibleMovies = filtered;

  list.replaceChildren();
  filtered.forEach((movie, index) => {
    const fragment = template.content.cloneNode(true);
    fragment.querySelector(".rank").textContent = String(index + 1).padStart(2, "0");
    fragment.querySelector("h3").textContent = movie.title;
    fragment.querySelector(".year").textContent = movie.year ?? "";
    fragment.querySelector(".audience-score strong").textContent = movie.userRating?.toFixed(1) ?? "—";
    const imdbScore = fragment.querySelector(".imdb-score");
    const accolade = fragment.querySelector(".accolade");
    if (movie.imdbRating2020 !== null) {
      imdbScore.hidden = false;
      imdbScore.querySelector("strong").textContent = movie.imdbRating2020.toFixed(1);
      accolade.hidden = false;
      accolade.textContent = `IMDb Top 100 · #${movie.imdbTop100Rank2020} in the 2020 snapshot`;
    }
    fragment.querySelector(".plot").textContent = movie.plot ?? "No synopsis available.";
    fragment.querySelector(".meta").textContent = [
      movie.genres.slice(0, 3).join(" / "),
      formatRuntime(movie.runtimeMinutes),
      movie.languages?.length ? `Languages ${movie.languages.join(" / ")}` : null,
      movie.criticScore !== null ? `Critics ${movie.criticScore}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const expiry = fragment.querySelector(".expiry");
    expiry.textContent = formatExpiry(movie.sbsExpiresAt) ?? "";
    expiry.hidden = !movie.sbsExpiresAt;
    const imdb = fragment.querySelector(".imdb");
    if (movie.imdbId) imdb.href = `https://www.imdb.com/title/${movie.imdbId}/`;
    else imdb.remove();
    const watch = fragment.querySelector(".watch");
    if (movie.sbsUrl) watch.href = movie.sbsUrl;
    else watch.remove();
    list.append(fragment);
  });

  summary.textContent = `${filtered.length} of ${movies.length} films`;
  empty.hidden = filtered.length !== 0;
}

function showLuckyMovie() {
  if (!visibleMovies.length) return;
  const choices = visibleMovies.length > 1
    ? visibleMovies.filter((movie) => movie.id !== lastLuckyId)
    : visibleMovies;
  const movie = choices[Math.floor(Math.random() * choices.length)];
  lastLuckyId = movie.id;

  luckyModal.querySelector(".modal-score strong").textContent = movie.userRating?.toFixed(1) ?? "-";
  luckyModal.querySelector(".modal-kicker").textContent = "Your film for tonight";
  luckyModal.querySelector(".modal-title").textContent = movie.title;
  luckyModal.querySelector(".modal-meta").textContent = [
    movie.year,
    movie.genres.slice(0, 3).join(" / "),
    formatRuntime(movie.runtimeMinutes),
    movie.languages?.length ? movie.languages.join(" / ") : null,
    formatExpiry(movie.sbsExpiresAt),
  ].filter(Boolean).join(" · ");
  luckyModal.querySelector(".modal-plot").textContent = movie.plot ?? "No synopsis available.";
  luckyModal.querySelector(".modal-watch").href = movie.sbsUrl;

  if (!luckyModal.open) luckyModal.showModal();
}

function compareAudience(a, b) {
  return (b.userRating ?? -1) - (a.userRating ?? -1)
    || (b.criticScore ?? -1) - (a.criticScore ?? -1)
    || a.title.localeCompare(b.title);
}

function populateFilters() {
  const genres = [...new Set(movies.flatMap((movie) => movie.genres))].sort();
  const languages = [...new Set(movies.flatMap((movie) => movie.languages ?? []))].sort();
  const decades = [...new Set(movies.map((movie) => Math.floor(movie.year / 10) * 10))]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);

  for (const name of genres) genre.add(new Option(name, name));
  for (const name of languages) language.add(new Option(name, name));
  for (const year of decades) decade.add(new Option(`${year}s`, String(year)));
}

async function loadMovies() {
  const response = await fetch("/api/movies");
  const data = await response.json();
  if (response.status === 202) {
    summary.textContent = data.message ?? "Building the first catalogue…";
    setTimeout(loadMovies, 3000);
    return;
  }
  movies = data.movies;
  populateFilters();
  updated.textContent = `Catalogue refreshed ${new Date(data.refreshedAt).toLocaleDateString("en-AU", { dateStyle: "long" })}.`;
  render();
}

for (const control of [search, rating, genre, language, decade, runtime, sort, imdbTop]) {
  control.addEventListener(control === search ? "input" : "change", render);
}
reset.addEventListener("click", () => {
  search.value = "";
  rating.value = "0";
  genre.value = "";
  language.value = "";
  decade.value = "";
  runtime.value = "";
  sort.value = "audience";
  imdbTop.checked = false;
  render();
});
lucky.addEventListener("click", showLuckyMovie);
luckyAgain.addEventListener("click", showLuckyMovie);
luckyModal.addEventListener("click", (event) => {
  if (event.target === luckyModal) luckyModal.close();
});
loadMovies().catch(() => {
  summary.textContent = "The catalogue could not be loaded.";
});
