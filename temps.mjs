// Typical race-day temperatures for races that have none, from Open-Meteo's
// historical weather API (ERA5 reanalysis; free for non-commercial use, data
// CC BY 4.0, credited on the page).
//
// For each race: mean daily low and mean daily high (°F) over a 7-day window
// centred on the race's calendar date, across the 10 years in YEARS. Results
// are cached in temps.json by "lat,lon|MM-DD" (lat/lon rounded to 0.1°), so a
// location is only ever fetched once.
//
// Reads data/races-built.json (written by build.mjs); run build.mjs again after.
// Open-Meteo free tier: 600 calls/min, 5,000/hour, 10,000/day. Each key costs
// 10 calls, so MAX_CALLS caps a run and the rest backfills on later nights.
import fs from 'fs';

const CACHE = 'temps.json';
const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const MAX_CALLS = +(process.env.TEMPS_MAX_CALLS || 4000);
const PAUSE_MS = 800; // stays under 5,000 calls an hour
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const tempKey = (lat, lon, date) => `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lon * 10) / 10).toFixed(1)}|${date.slice(5, 10)}`;

async function fetchKey(key) {
  const [ll, md] = key.split('|');
  const [lat, lon] = ll.split(',');
  const lows = [], highs = [];
  for (const y of YEARS) {
    // Feb 29 races use Feb 28 in non-leap years
    const mid = new Date(Date.UTC(y, +md.slice(0, 2) - 1, Math.min(+md.slice(3), md === '02-29' ? 28 : 31)));
    const from = new Date(mid.getTime() - 3 * 864e5).toISOString().slice(0, 10);
    const to = new Date(mid.getTime() + 3 * 864e5).toISOString().slice(0, 10);
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${from}&end_date=${to}&daily=temperature_2m_min,temperature_2m_max&temperature_unit=fahrenheit&timezone=auto`;
    let j;
    for (let attempt = 1; ; attempt++) {
      let res;
      try { res = await fetch(u, { headers: { 'User-Agent': 'race-planner-build (personal calendar)' } }); }
      catch (e) { if (attempt >= 3) throw e; await sleep(5000 * attempt); continue; } // dropped connection
      if (res.ok) { j = await res.json(); break; }
      if (attempt >= 3 || (res.status < 500 && res.status !== 429)) throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await sleep(5000 * attempt);
    }
    (j.daily?.temperature_2m_min || []).forEach(v => v != null && lows.push(v));
    (j.daily?.temperature_2m_max || []).forEach(v => v != null && highs.push(v));
    await sleep(PAUSE_MS);
  }
  // need most of the 70 days to call it typical
  if (lows.length < 50 || highs.length < 50) return null;
  const mean = a => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
  return [mean(lows), mean(highs)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE)) : {};
  const races = JSON.parse(fs.readFileSync('data/races-built.json'));
  const want = [...new Set(races.filter(r => !r.temp).map(r => tempKey(r.lat, r.lon, r.date)))].filter(k => !(k in cache));
  console.log('temps: cached', Object.keys(cache).length, 'missing', want.length);
  let calls = 0, done = 0;
  for (const k of want) {
    if (calls + YEARS.length > MAX_CALLS) break;
    try { cache[k] = await fetchKey(k); done++; }
    catch (e) { console.error('temps stop:', e.message); break; }
    calls += YEARS.length;
    if (done % 25 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0));
  }
  const sorted = Object.fromEntries(Object.keys(cache).sort().map(k => [k, cache[k]]));
  fs.writeFileSync(CACHE, JSON.stringify(sorted, null, 0).replace(/,"/g, ',\n"'));
  console.log('temps: fetched', done, 'keys,', calls, 'calls;', want.length - done, 'left for next run');
}
