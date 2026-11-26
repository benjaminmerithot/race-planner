# Race Planner: handoff brief

A single-page race planner for the US and Canada: map, filters, registration and race-day feeds, sortable table, Jan-Dec calendar, hover cards with demand, size, course difficulty and typical temps.

## How it builds today

```
races.json          curated races (~100), hand-researched: dates, temps, difficulty, status, links
fetch-runsignup.mjs RunSignup races API -> data/runsignup.json (gitignored; kept only in the CI cache)
fulls.txt           every US/CA marathon from FindMyMarathon (name|city|state|MM/DD/YYYY|profile|finishers); enrichment layer
halves.txt          half marathons (date|name|city|st|dists|est|note); running.life fallback, mostly New England
demand.json         per-race demand level, note and 2025 weekend size (RunSignup Top 100)
reg.json            hand-entered key dates (openings, lotteries, deadlines) for the registration feed
labels.json         awards and labels per race id, each with a source URL
normals.json        typical temps from NOAA 1991-2020 daily normals, nearest similar-elevation station (normals.mjs); preferred
temps.json          fallback typical temps from Open-Meteo history where no station is near (temps.mjs)
elevations.json     race-site terrain elevations (Open-Meteo) used to pick NOAA stations
ascent.json         ascent/descent in feet per race id (from ascent.mjs and courses/<id>.gpx)
manual-geo.json     lat/lon overrides for towns the geocoders miss
build.mjs           merges everything, geocodes, dedupes, projects to SVG coords, writes data.js and index.html, COVERAGE.md
template.html       the whole UI; build injects data.js at /*DATA*/ and the build date at {{BUILT}}
```

Local build: `npm ci && node fetch-runsignup.mjs && node build.mjs && node normals.mjs && node temps.mjs && node build.mjs`.
Without data/runsignup.json the build still works from the committed files. `BUILD_DATE=YYYY-MM-DD` pins "today" (defaults to today, US Eastern). index.html is a build output and is not committed.

Nightly: `.github/workflows/nightly.yml` runs the same steps at 09:30 UTC, commits temps.json and COVERAGE.md, and deploys index.html to GitHub Pages. From 2027-01-01 RunSignup needs repo secrets `RSU_API_REG` and `RSU_API_REG_SECRET` (API caller registration).

Map geometry is pre-projected at build time (world-atlas, us-atlas, @geo-maps/earth-lakes-10km), with Alaska and Hawaii insets. The page has no runtime network calls.

## Data rules to keep

- Curated races win over imported ones. Imports merge into a curated race when the state matches, the date is within 3 days, and the names share a distinctive word (see `matchRace`).
- RunSignup listings use the stricter `rsuMatch`: within 40 km, and distances, state and town names, and capitals metro tags don't count as distinctive. Curated races only gain distances from a match; FindMyMarathon/running.life imports keep their ids (saved stars) and gain the real URL, confirmed date and open status.
- RunSignup has no sold-out flag. Its open/closed flag sets "Open" or "Check race site"; sold-out claims come only from races.json and demand.json.
- Generated key dates (next opening, last day before a price rise, early close) are added only for curated and sized races with no rows in reg.json.
- RunSignup API contract: at most 2 concurrent calls (we use 1), no bulk copy of their data in git.
- Dates not yet announced are projected +364 days from the last edition and flagged `est`.
- Never invent temps, elevation, demand or sell-out claims. Leave them blank and show "not tracked".
- Popularity = field-size bands + 1 level for lottery, qualifier-only or fast sell-out (see `POP` in template.html).

## Open work: status

1. **Pull listings automatically.** Done for the US via RunSignup. Canada: RunSignup has almost none and Race Roster has no public listings API (needs partner access).
2. **Half-marathon coverage.** US states covered by RunSignup; see COVERAGE.md for thin regions (DC, WY, all provinces).
3. **Typical temps.** Done: NOAA daily normals (normals.mjs) for ~97% of races; Open-Meteo fallback (temps.mjs) for the rest.
4. **Ascent and descent.** Tooling done (ascent.mjs); needs course GPX files in courses/. Not shown in the UI yet (`asc` field).
5. **Awards and labels.** labels.json: Abbott WMM + World Athletics 2026 label calendar (no tiers). Not shown in the UI yet (`labels` field). No Boston qualifier data.
6. **Real race URLs.** Done for races found on RunSignup; the rest keep a web-search link.
7. **Registration windows.** Generated from RunSignup price periods and close dates.
8. **Refresh schedule.** Nightly GitHub Actions + Pages.

## UI notes from the owner

- Filters in a left column (1/4); the right 3/4 switches between Map, List and a Jan-Dec calendar (this year, next year from November), all driven by the same filters. Registration and Race days cards side by side below. Plain header, no colored band.
- Clicking a race anywhere (list row, calendar day, feeds) switches to the map and opens its card.
- Pins that would sit on top of each other at the current zoom become a numbered bubble (3+) coloured by its most common distance, or a small ring (2). Clicking a bubble zooms in; if its races share one spot (same town) it opens a date-sorted list instead.
- Zoom must stay gentle. Type stays compact. Dropdown carets are padded custom chevrons.
- Sold-out rows: struck-through red name, dimmed row, red badge.
- Avoid em-dash-heavy or AI-sounding copy.
