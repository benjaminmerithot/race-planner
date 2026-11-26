# Race Planner: handoff brief

A single-page race planner for the US and Canada: map, filters, registration and race-day feeds, sortable table, 12-month calendar, hover cards with demand, size, course difficulty and typical temps.

## How it builds today

```
races.json      curated races (~100), hand-researched: dates, temps, difficulty, status, links
fulls.txt       every US/CA marathon from FindMyMarathon (name|city|state|MM/DD/YYYY|profile|finishers)
halves.txt      half marathons (date|name|city|st|dists|est|note), only partly complete
demand.json     per-race demand level, note and 2025 weekend size (RunSignup Top 100)
manual-geo.json lat/lon overrides for towns the geocoders miss
build.mjs       merges everything, geocodes (zipcodes + all-the-cities), dedupes, projects to SVG coords, writes data.js
template.html   the whole UI; build step injects data.js at /*DATA*/ to produce index.html
```

Build: `npm install && node build.mjs && python3 -c "t=open('template.html').read();open('index.html','w').write(t.replace('/*DATA*/',open('data.js').read()))"`

Map geometry is pre-projected at build time (world-atlas, us-atlas, @geo-maps/earth-lakes-10km), with Alaska and Hawaii insets. The page has no runtime network calls.

## Data rules to keep

- Curated races win over imported ones. Imports merge into a curated race when the state matches, the date is within 3 days, and the names share a distinctive word (see `matchRace`).
- Dates not yet announced are projected +364 days from the last edition and flagged `est`.
- Never invent temps, elevation, demand or sell-out claims. Leave them blank and show "not tracked".
- Popularity = field-size bands + 1 level for lottery, qualifier-only or fast sell-out (see `POP` in template.html).

## Open work, in priority order

1. **Pull listings automatically.** Replace fulls.txt and halves.txt with a scheduled fetch from a race-listing source. RunSignup has a public races API with search by distance, state and date; check its docs for rate limits and whether an API key is needed. Race Roster covers much of Canada. Keep FindMyMarathon finisher counts and profiles as an enrichment layer.
2. **Finish half-marathon coverage** for every state and province; running.life state pages are the current fallback source.
3. **Typical temps** for imported races, from climate normals (for example NOAA or Open-Meteo historical) by lat/lon and race date.
4. **Total ascent and descent** per course, from published elevation profiles or course GPX files.
5. **Awards and labels:** World Athletics labels, Abbott WMM, Boston qualifier status, best-of lists.
6. **Real race URLs** for imported races (currently a web-search link).
7. **Registration windows and sell-out timing** for more races, from the listing source.
8. **Refresh schedule:** rebuild nightly or weekly and redeploy.

## UI notes from the owner

- Map on the left two-thirds, feeds stacked on the right. Plain header, no colored band.
- Zoom must stay gentle. Type stays compact. Dropdown carets are padded custom chevrons.
- Sold-out rows: struck-through red name, dimmed row, red badge.
- Avoid em-dash-heavy or AI-sounding copy.
