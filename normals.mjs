// Typical race-day temps from NOAA's 1991-2020 daily climate normals: the
// nearest station within MAX_KM, normal daily low and high (°F) averaged over
// the 7 days centred on the race's calendar date.
//
// One archive (165 MB) covers every station, so a single download fills
// nearly every US race at once. Results are cached in normals.json by
// "lat,lon|MM-DD" (same keys as temps.json); null means no station near enough,
// and temps.mjs (Open-Meteo) fills those.
//
// Reads data/races-built.json (written by build.mjs); run build.mjs again after.
import fs from 'fs';
import readline from 'readline';
import { execFileSync } from 'child_process';

const OUT = 'normals.json';
const DIR = 'data/noaa';
const ARCHIVE = 'https://www.ncei.noaa.gov/data/normals-daily/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_daily_temperature_by-variable_c20230403.tar.gz';
const MAX_KM = 40;

const km = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const tempKey = (lat, lon, date) => `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lon * 10) / 10).toFixed(1)}|${date.slice(5, 10)}`;

const cache = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const races = JSON.parse(fs.readFileSync('data/races-built.json'));
// keys matched without a site elevation are flagged 'noelev' and redone once one is available
const want = [...new Set(races.map(r => tempKey(r.lat, r.lon, r.date)))].filter(k => !(k in cache) || (cache[k] && cache[k][3] === 'noelev'));
console.log('normals: cached', Object.keys(cache).length, 'new keys', want.length);
if (!want.length) process.exit(0);

// fetch and unpack the archive only when there is something new to look up
fs.mkdirSync(DIR, { recursive: true });
if (!fs.existsSync(`${DIR}/dly-temp-normal.csv`)) {
  if (!fs.existsSync(`${DIR}/daily-temperature.tar.gz`)) {
    console.log('normals: downloading NOAA archive');
    const res = await fetch(ARCHIVE, { headers: { 'User-Agent': 'race-planner-build (personal calendar)' } });
    if (!res.ok) { console.error('NOAA', res.status); process.exit(1); }
    fs.writeFileSync(`${DIR}/daily-temperature.tar.gz`, Buffer.from(await res.arrayBuffer()));
  }
  execFileSync('tar', ['-xzf', 'daily-temperature.tar.gz', 'dly_inventory.txt', 'dly-temp-normal.csv'], { cwd: DIR });
}

// stations: "ID lat lon elev(m) ST NAME ..."
const stations = fs.readFileSync(`${DIR}/dly_inventory.txt`, 'utf8').split('\n').filter(Boolean)
  .map(l => { const [id, lat, lon, elev] = l.trim().split(/\s+/); return { id, ll: [+lat, +lon], elev: +elev }; });

// Race-site terrain elevation (Open-Meteo elevation API, 100 points a call),
// cached in elevations.json. Lets us skip an upcountry station for a
// sea-level race: each 100 m of elevation difference counts like 10 km.
const ELEV = 'elevations.json';
const elev = fs.existsSync(ELEV) ? JSON.parse(fs.readFileSync(ELEV)) : {};
const lls = [...new Set(want.map(k => k.split('|')[0]))].filter(ll => !(ll in elev));
for (let i = 0; i < lls.length; i += 100) {
  const chunk = lls.slice(i, i + 100).map(ll => ll.split(','));
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(c => c[0]).join(',')}&longitude=${chunk.map(c => c[1]).join(',')}`, { headers: { 'User-Agent': 'race-planner-build (personal calendar)' } });
    if (!res.ok) throw new Error('elevation ' + res.status);
    (await res.json()).elevation.forEach((e, j) => { elev[chunk[j].join(',')] = e; });
  } catch (e) { console.warn('normals: elevation lookup failed, using distance only:', e.message); break; }
  await new Promise(r => setTimeout(r, 400));
}
fs.writeFileSync(ELEV, JSON.stringify(elev));

const nearest = {};
for (const k of want) {
  const ll = k.split('|')[0], [lat, lon] = ll.split(',').map(Number), e0 = elev[ll];
  let best = null, bs = Infinity;
  for (const s of stations) {
    if (Math.abs(s.ll[0] - lat) > 0.5 || Math.abs(s.ll[1] - lon) > 0.7) continue;
    const d = km([lat, lon], s.ll); if (d > MAX_KM) continue;
    const de = e0 == null || !Number.isFinite(s.elev) ? 0 : Math.abs(s.elev - e0);
    if (de > 300) continue;
    const score = d + de / 10; if (score < bs) { bs = score; best = s.id; }
  }
  nearest[k] = best;
}
const needed = new Set(Object.values(nearest).filter(Boolean));

// stream the 227 MB CSV, keeping only the stations we need
const norm = {}; // id -> { 'MM-DD': [tmin, tmax] }
const rl = readline.createInterface({ input: fs.createReadStream(`${DIR}/dly-temp-normal.csv`) });
let header = null;
for await (const line of rl) {
  if (!header) { header = line.split(','); continue; }
  const id = line.slice(0, line.indexOf(','));
  if (!needed.has(id)) continue;
  const f = line.split(',').map(s => s.trim());
  const col = name => f[header.indexOf(name)];
  const ok = name => col('meas_flag_' + name) !== 'M' && col(name) !== '' && +col(name) > -700;
  if (!ok('DLY-TMAX-NORMAL') || !ok('DLY-TMIN-NORMAL')) continue;
  (norm[id] ||= {})[`${col('month')}-${col('day')}`] = [+col('DLY-TMIN-NORMAL'), +col('DLY-TMAX-NORMAL')];
}

let filled = 0;
for (const k of want) {
  const id = nearest[k], days = id && norm[id];
  const flag = elev[k.split('|')[0]] == null ? ['noelev'] : [];
  if (!days) { cache[k] = flag.length ? [null, null, null, 'noelev'] : null; continue; }
  const md = k.split('|')[1];
  const mid = Date.UTC(2021, +md.slice(0, 2) - 1, Math.min(+md.slice(3), md === '02-29' ? 28 : 31)); // 2021: not a leap year
  const vals = [];
  for (let i = -3; i <= 3; i++) { const d = new Date(mid + i * 864e5).toISOString().slice(5, 10); if (days[d]) vals.push(days[d]); }
  if (vals.length < 5) { cache[k] = flag.length ? [null, null, null, 'noelev'] : null; continue; }
  const mean = j => Math.round(vals.reduce((s, v) => s + v[j], 0) / vals.length);
  cache[k] = [mean(0), mean(1), id, ...flag]; filled++;
}
const sorted = Object.fromEntries(Object.keys(cache).sort().map(k => [k, cache[k]]));
fs.writeFileSync(OUT, JSON.stringify(sorted).replace(/,"/g, ',\n"'));
console.log('normals: filled', filled, 'of', want.length, 'new keys;', want.length - filled, 'have no station within', MAX_KM, 'km');
