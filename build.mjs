import fs from 'fs';
import { geoConicConformal, geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';

const world = JSON.parse(fs.readFileSync('node_modules/world-atlas/countries-50m.json'));
const us = JSON.parse(fs.readFileSync('node_modules/us-atlas/states-10m.json'));
const W = 1000, H = 620;

const countries = feature(world, world.objects.countries);
const keep = new Set(['840', '124', '484']); // US, Canada, Mexico
const na = { type: 'FeatureCollection', features: countries.features.filter(f => keep.has(f.id)) };

const bbox = { type: 'MultiPoint', coordinates: [[-127, 25], [-64, 25], [-127, 53], [-60, 53], [-95, 56], [-95, 24], [-61, 45]] };
const proj = geoConicConformal().parallels([33, 49]).rotate([96, 0]).fitExtent([[232, 14], [W - 14, H - 14]], bbox);
const r = n => Math.round(n * 10) / 10;
const round = d => d && d.replace(/-?\d+\.\d+/g, m => String(r(+m)));
const path = geoPath(proj);
const clip = f => round(path(f));

const usOnly = countries.features.find(f => f.id === '840');
const ca = countries.features.find(f => f.id === '124');
const mx = countries.features.find(f => f.id === '484');
const states = mesh(us, us.objects.states, (a, b) => a !== b);
import { geoArea } from 'd3-geo';
const lakesRaw = JSON.parse(fs.readFileSync('node_modules/@geo-maps/earth-lakes-10km/map.geo.json'));
const polys = [];
for (const g of lakesRaw.geometries) {
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const p of list) {
    const inBox = p[0].some(([x, y]) => x > -130 && x < -55 && y > 24 && y < 58);
    if (!inBox) continue;
    let poly = { type: 'Polygon', coordinates: p };
    if (geoArea(poly) > 2 * Math.PI) poly = { type: 'Polygon', coordinates: p.map(r => r.slice().reverse()) };
    if (geoArea(poly) < 2e-6) continue; // drop tiny lakes
    polys.push(poly.coordinates);
  }
}
const lakes = { type: 'MultiPolygon', coordinates: polys };
console.log('lakes kept', polys.length);

// Hawaii inset
const hiFeat = feature(us, us.objects.states).features.find(f => f.properties.name === 'Hawaii');
const hiBox = { x: 14, y: 418, w: 200, h: 110 };
const hiProj = geoMercator().fitExtent([[hiBox.x + 10, hiBox.y + 10], [hiBox.x + hiBox.w - 10, hiBox.y + hiBox.h - 10]], hiFeat);
const hiPath = geoPath(hiProj);
const akFeat = feature(us, us.objects.states).features.find(f => f.properties.name === 'Alaska');
const akBox = { x: 14, y: 250, w: 200, h: 156 };
const akProj = geoConicConformal().parallels([55, 65]).rotate([152, 0])
  .fitExtent([[akBox.x + 8, akBox.y + 8], [akBox.x + akBox.w - 8, akBox.y + akBox.h - 8]], { type: 'MultiPoint', coordinates: [[-168, 54], [-130, 55], [-166, 71], [-141, 70]] })
  .clipExtent([[akBox.x, akBox.y], [akBox.x + akBox.w, akBox.y + akBox.h]]);
const akPath = geoPath(akProj);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const zipcodes = require('zipcodes');
const cities = require('all-the-cities');
const CAADM = { AB: '01', BC: '02', MB: '03', NB: '04', NL: '05', NS: '07', NT: '13', ON: '08', PE: '09', QC: '10', SK: '11', YT: '12' };
const MANUAL = JSON.parse(fs.readFileSync('manual-geo.json'));
const geocode = (city, st) => {
  const k = city + ',' + st; if (MANUAL[k]) return MANUAL[k];
  if (CAADM[st]) { const c = cities.filter(x => x.country === 'CA' && x.adminCode === CAADM[st] && x.name.toLowerCase() === city.toLowerCase()).sort((a, b) => b.population - a.population)[0]; return c ? [c.loc.coordinates[1], c.loc.coordinates[0]] : null; }
  const z = zipcodes.lookupByName(city, st); if (z && z.length) return [z[0].latitude, z[0].longitude];
  const c = cities.filter(x => x.country === 'US' && x.adminCode === st && x.name.toLowerCase() === city.toLowerCase()).sort((a, b) => b.population - a.population)[0];
  return c ? [c.loc.coordinates[1], c.loc.coordinates[0]] : null;
};
// Dates before this roll forward a year. Set BUILD_DATE to reproduce an old build.
const TODAY = process.env.BUILD_DATE || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const iso = d => d.toISOString().slice(0, 10);
const rollForward = s => { let d = new Date(s + 'T12:00:00Z'); let rolled = false; while (iso(d) < TODAY) { d = new Date(d.getTime() + 364 * 864e5); rolled = true; } return [iso(d), rolled]; };
const PROF = { 'Very Flat': [1, 'Flat'], 'Mostly Flat': [1, 'Mostly flat'], 'Downhill': [2, 'Net downhill'], 'Rolling Hills': [2, 'Rolling'], 'Hilly': [4, 'Hilly'], 'Very Hilly': [5, 'Very hilly'] };
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const unmatched = [];
const curatedRaw = JSON.parse(fs.readFileSync('races.json'));
const curated = curatedRaw.map(a => {
  const [id, name, city, region, country, lat, lon, date, est, dists, diff, profile, note, temp, status, url] = a;
  const p = region === 'HI' ? hiProj([lon, lat]) : region === 'AK' ? akProj([lon, lat]) : proj([lon, lat]);
  return { id, name, city, region, country, lat, lon, date, est: !!est, dists: dists.split(','), diff, profile, note, temp, status, url, x: r(p[0]), y: r(p[1]) };
});

const near = (a, b, days = 3) => Math.abs(new Date(a) - new Date(b)) <= days * 864e5;
const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
const GEN = new Set('marathon marathons half the and of city international run running race races festival weekend rock roll n annual presented by classic distance memorial mini'.split(' '));
const sig = (name, city) => { const cw = new Set(city.toLowerCase().split(/[^a-z]+/)); return new Set(name.toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GEN.has(w) && !cw.has(w))); };
function matchRace(list, name, city, st, date, dist, days = 3) {
  const s = sig(name, city);
  const cands = list.filter(r => r.region === st && near(r.date, date, days)).sort((a, b) => (b.dists.includes(dist) - a.dists.includes(dist)));
  const words = n => new Set(n.toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GEN.has(w)));
  for (const r of cands) { const A = words(name), B = words(r.name); const c1 = new Set(city.toLowerCase().split(/[^a-z]+/)); const cw = new Set(r.city.toLowerCase().split(/[^a-z]+/).filter(w => c1.has(w))); if ([...A].some(w => B.has(w) && !cw.has(w))) return r; }
  for (const r of cands) { const t = sig(r.name, r.city); if (norm(r.city) === norm(city) && (s.size === 0 || t.size === 0) && r.dists.includes(dist)) return r; }
  return null;
}
const imported = [];
for (const line of fs.readFileSync('fulls.txt', 'utf8').trim().split('\n')) {
  const [name, city, st, mdy, prof, fin] = line.split('|');
  const [m, d, y] = mdy.split('/'); const [date, rolled] = rollForward(`${y}-${m}-${d}`);
  const fins = +fin || 0;
  const hit = matchRace(curated, name, city, st, date, 'full');
  if (hit) { hit.fin = fins || hit.fin; continue; }
  const g = geocode(city, st); if (!g) { unmatched.push(city + ',' + st); continue; }
  const p = PROF[prof] || [0, 'Not rated'];
  imported.push({ id: 'f-' + slug(name + '-' + st), name, city, region: st, country: CAADM[st] ? 'CA' : 'US', lat: g[0], lon: g[1], date, est: rolled, dists: ['full'], diff: p[0], profile: p[1], note: 'Course profile and size from FindMyMarathon', temp: null, status: 'Check race site', url: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + city + ' ' + (rolled ? '' : y)), fin: fins, src: 'fmm' });
}
const hl = fs.readFileSync('halves.txt', 'utf8').trim().split('\n').slice(1);
for (const line of hl) {
  const [date, name, city, st, dists, est, note] = line.split('|');
  const ds = dists.split(',');
  const hit = matchRace([...curated, ...imported], name, city, st, date, 'half');
  if (hit) { ds.forEach(x => { if (!hit.dists.includes(x)) hit.dists.push(x); }); continue; }
  const g = geocode(city, st); if (!g) { unmatched.push(city + ',' + st); continue; }
  imported.push({ id: 'h-' + slug(name + '-' + st), name, city, region: st, country: CAADM[st] ? 'CA' : 'US', lat: g[0], lon: g[1], date, est: est === '1', dists: ds, diff: 0, profile: 'Not rated', note: note || 'Listed on running.life', temp: null, status: 'Check race site', url: 'https://www.google.com/search?q=' + encodeURIComponent(name + ' ' + city), fin: 0, src: 'rl' });
}
// RunSignup listings (fetch-runsignup.mjs). Curated races keep every field and
// only gain distances; FindMyMarathon and running.life imports keep their ids
// (saved stars) and gain the real URL, confirmed date and open status.
// Stricter than matchRace: RunSignup has many race series that run the same
// name on the same day in different cities ("Squirrel 5K, 10K, & 13.1M at
// Augusta, GA"). Same state, within 40 km, date within 3 days (10 for est.
// dates), and a shared word that is not generic, a distance, or a place name.
const km = (a, b) => { const R = 6371, t = Math.PI / 180, dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t; const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const STATE_WORDS = new Set('alabama alaska arizona arkansas california colorado connecticut delaware district columbia florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada new hampshire jersey mexico york north carolina dakota ohio oklahoma oregon pennsylvania rhode island south tennessee texas utah vermont virginia washington west wisconsin wyoming'.split(' '));
const DIST_WORD = w => /^\d+(\.\d+)?(k|m|mi|mile|miles|km)?$/.test(w) || ['k', 'm', 'mi', 'mile', 'miles', 'km', 'half', 'full', 'ultra', 'ultramarathon', 'trail', 'trails', 'series', 'relay', 'kids', 'fun', 'early', 'bird', 'experience', 'at', 'by', 'in', 'on', 'for', 'a', 'the', 'w', 's'].includes(w);
// one-word town names per state ("Holiday, FL", "Sunrise, FL") read as places in series names
const TOWN_WORDS = {};
for (const c of cities) if (c.country === 'US' && !/\s/.test(c.name)) (TOWN_WORDS[c.adminCode] ||= new Set()).add(c.name.toLowerCase());
// series listings tag the metro in capitals: "Run for Donuts MIAMI"
const capsTags = name => new Set((name.match(/\b[A-Z]{3,}\b/g) || []).map(w => w.toLowerCase()));
const rsuWords = (name, cities) => new Set(name.toLowerCase().replace(/['’.]/g, '').split(/[^a-z0-9]+/).filter(w => w && !GEN.has(w) && !DIST_WORD(w) && !STATE_WORDS.has(w) && !cities.has(w) && w.length > 1));
function rsuMatch(pool, x, g) {
  const cands = pool.filter(q => q.region === x.region && near(q.date, x.date, q.est ? 10 : 3) && km([q.lat, q.lon], g) <= 40);
  for (const q of cands) {
    const cities = new Set([...x.city.toLowerCase().split(/[^a-z]+/), ...q.city.toLowerCase().split(/[^a-z]+/), x.region.toLowerCase(), q.region.toLowerCase()]);
    // a capitals metro tag on the RunSignup name ("SuperHeroes Run NYC") is a place, not a name
    for (const w of capsTags(x.name)) if (x.name !== x.name.toUpperCase()) cities.add(w);
    if (q.rsuOnly) {
      // two RunSignup listings: same day, same town (or 10 km); series and town words don't count
      if (q.date !== x.date || (norm(q.city) !== norm(x.city) && km([q.lat, q.lon], g) > 10)) continue;
      for (const w of [...capsTags(q.name), ...(TOWN_WORDS[x.region] || [])]) cities.add(w);
      // drop the organizer ("... by Califlow Runs"): one organizer runs many events
      const bare = n => n.replace(/[,\s-]*\b(hosted |presented )?by\b.*$/i, '');
      const A = rsuWords(bare(x.name), cities), B = rsuWords(bare(q.name), cities);
      if ([...A].some(w => B.has(w))) return q;
      continue;
    }
    const A = rsuWords(x.name, cities), B = rsuWords(q.name, cities);
    if ([...A].some(w => B.has(w))) return q;
    // "Cedar Rapids Marathon" vs "Cedar Rapids Marathon Weekend": same city and
    // one name contains the other, or both are only generic and place words
    const nx = norm(x.name), nq = norm(q.name);
    if (norm(q.city) === norm(x.city) && x.dists.some(d => (d === 'full' || d === 'half') && q.dists.includes(d)) &&
      ((A.size === 0 && B.size === 0) || nx.includes(nq) || nq.includes(nx))) return q;
  }
  return null;
}
const RSU = fs.existsSync('data/runsignup.json') ? JSON.parse(fs.readFileSync('data/runsignup.json')).races : [];
const rsuOf = new Map(); // race id -> RunSignup record, for the registration feed
const zipGeo = z => { const x = z && zipcodes.lookup(z.slice(0, 5)); return x && x.latitude ? [x.latitude, x.longitude] : null; };
let rsuNew = 0, rsuCurated = 0, rsuUpgraded = 0;
// charity-team and group-reservation pages for races listed elsewhere
const NOT_A_RACE = /\b(team|charity group|reservation system|students on the go|students run|any city)\b/i;
for (const x of RSU) {
  if (NOT_A_RACE.test(x.name)) continue;
  const g = zipGeo(x.zip) || geocode(x.city, x.region);
  const hit = g && rsuMatch([...curated, ...imported], x, g);
  const addDists = q => x.dists.forEach(d => { if (!q.dists.includes(d)) q.dists.push(d); });
  if (hit && !hit.src && !hit.rsu) { addDists(hit); if (!rsuOf.has(hit.id)) { rsuOf.set(hit.id, x); rsuCurated++; } continue; }
  if (hit) {
    if (!hit.rsu) rsuUpgraded++;
    addDists(hit); hit.url = x.site || x.url; hit.status = x.open ? 'Open' : 'Check race site';
    if (hit.est) { hit.date = x.date; hit.est = false; }
    delete hit.src; hit.rsu = x.rsid; if (!rsuOf.has(hit.id)) rsuOf.set(hit.id, x);
    continue;
  }
  if (!g) { unmatched.push(x.city + ',' + x.region); continue; }
  let id = 'r-' + slug(x.name + '-' + x.region); if (imported.some(q => q.id === id)) id += '-' + x.rsid;
  const q = { id, name: x.name, city: x.city, region: x.region, country: x.country, lat: g[0], lon: g[1], date: x.date, est: false, dists: x.dists.slice(), diff: 0, profile: 'Not rated', note: 'Listed on RunSignup', temp: null, status: x.open ? 'Open' : 'Check race site', url: x.site || x.url, fin: 0, rsu: x.rsid, rsuOnly: true };
  imported.push(q); rsuOf.set(id, x); rsuNew++;
}
console.log('runsignup', RSU.length, 'listings:', rsuNew, 'new,', rsuUpgraded, 'imports upgraded,', rsuCurated, 'matched curated');
console.log('imported', imported.length, 'unmatched', JSON.stringify(unmatched));
const DEMAND = JSON.parse(fs.readFileSync('demand.json'));
// Typical temps for races without hand-researched ones: NOAA 1991-2020 daily
// normals at a nearby station (normals.mjs) first, else Open-Meteo history (temps.mjs).
const NORMALS = fs.existsSync('normals.json') ? JSON.parse(fs.readFileSync('normals.json')) : {};
const TEMPS = fs.existsSync('temps.json') ? JSON.parse(fs.readFileSync('temps.json')) : {};
const tKey = (lat, lon, date) => `${(Math.round(lat * 10) / 10).toFixed(1)},${(Math.round(lon * 10) / 10).toFixed(1)}|${date.slice(5, 10)}`;
for (const q of [...curated, ...imported]) {
  if (q.temp) continue;
  const k = tKey(q.lat, q.lon, q.date), n = NORMALS[k];
  if (n && n[0] != null) q.temp = [n[0], n[1]];
  else if (TEMPS[k]) q.temp = TEMPS[k];
}
// Awards and labels (labels.json, hand-entered with sources) and total ascent
// and descent in feet (ascent.json, from ascent.mjs). Only set when known.
const LABELS = fs.existsSync('labels.json') ? JSON.parse(fs.readFileSync('labels.json')).races : {};
const ASCENT = fs.existsSync('ascent.json') ? JSON.parse(fs.readFileSync('ascent.json')) : {};
for (const q of [...curated, ...imported]) {
  if (LABELS[q.id]) q.labels = LABELS[q.id].map(l => l.label);
  if (ASCENT[q.id]) q.asc = [ASCENT[q.id].up, ASCENT[q.id].down];
}
const races = [...curated, ...imported].map(({ rsu, rsuOnly, ...q }) => { const p = q.region === 'HI' ? hiProj([q.lon, q.lat]) : q.region === 'AK' ? akProj([q.lon, q.lat]) : proj([q.lon, q.lat]); const dm = DEMAND[q.id] || {}; return { ...q, dem: dm.lvl || '', demNote: dm.note || '', wk: dm.wk || 0, x: r(p[0]), y: r(p[1]) }; }).filter(q => p0(q));
function p0(q) { return q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H; }
// Price periods for the season planner: the headline event's RunSignup
// periods that haven't closed yet, as [opens, closes, fee] (dates YYYY-MM-DD).
for (const q of races) {
  const x = rsuOf.get(q.id); if (!x) continue;
  const ev = x.events.find(e => e.d === (q.dists.includes('full') && x.dists.includes('full') ? 'full' : 'half')) || x.events[0];
  const ps = (ev.periods || []).filter(p => p.opens && p.closes && p.fee && p.closes.slice(0, 10) >= TODAY)
    .sort((a, b) => a.opens.localeCompare(b.opens)).map(p => [p.opens.slice(0, 10), p.closes.slice(0, 10), p.fee]);
  if (ps.length) { q.fees = ps; q.feeDist = ev.d; }
}
const reg = JSON.parse(fs.readFileSync('reg.json')); // hand-entered key dates
// Next registration date for races RunSignup lists, unless reg.json already has
// dates for that race (hand-entered rows win). One row per race, the next one:
// opening day, the last day before a price rise, or an early close. Only for
// curated races and races with a known field size, or the feed drowns.
const handReg = new Set(reg.map(g => g.id));
const inPage = new Set(races.map(q => q.id));
const usd = n => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
for (const [id, x] of rsuOf) {
  if (handReg.has(id) || !inPage.has(id)) continue;
  const race = races.find(q => q.id === id);
  // keep the Key dates feed readable: curated races and races with a known field size
  if (race.id.match(/^[rfh]-/) && !(race.fin || race.wk)) continue;
  const ev = x.events.find(e => e.d === (x.dists.includes('full') ? 'full' : 'half'));
  const ps = (ev.periods || []).filter(pp => pp.opens && pp.closes).sort((a, b) => a.opens.localeCompare(b.opens));
  const rows = [];
  if (ps.length && ps[0].opens.slice(0, 10) > TODAY) rows.push([ps[0].opens.slice(0, 10), 'Registration opens']);
  for (let i = 0; i + 1 < ps.length; i++) {
    const a = ps[i], b = ps[i + 1];
    if (a.fee && b.fee && b.fee > a.fee) rows.push([a.closes.slice(0, 10), `Price increases after today (${usd(a.fee)} to ${usd(b.fee)})`]);
  }
  const close = (ev.closes || (ps.length ? ps[ps.length - 1].closes : '') || '').slice(0, 10);
  if (close && close < race.date) rows.push([close, 'Registration closes']);
  const next = rows.filter(([d]) => d >= TODAY && d <= race.date).sort((a, b) => a[0].localeCompare(b[0]))[0];
  if (next) reg.push({ id, d: next[0], label: next[1], est: false });
}

const geo = {
  W, H,
  us: clip(usOnly), ca: clip(ca), mx: clip(mx), states: clip(states), lakes: clip(lakes),
  hi: round(hiPath(hiFeat)), hiBox, ak: round(akPath(akFeat)), akBox
};
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/races-built.json', JSON.stringify(races.map(({ id, lat, lon, date, temp }) => ({ id, lat, lon, date, temp }))));
fs.writeFileSync('data.js', 'const GEO=' + JSON.stringify(geo) + ';\nconst RACES=' + JSON.stringify(races) + ';\nconst REG=' + JSON.stringify(reg) + ';\n');
const tpl = fs.readFileSync('template.html', 'utf8');
const data = fs.readFileSync('data.js', 'utf8');
const built = new Date(TODAY + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
fs.writeFileSync('index.html', tpl.replace('/*DATA*/', () => data).replace('{{BUILT}}', built));
console.log('data.js', (fs.statSync('data.js').size / 1024).toFixed(0), 'KB', races.length, 'races');
// Coverage report: upcoming halves and fulls per state and province.
{
  const regions = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' ');
  const up = races.filter(q => q.date >= TODAY);
  const n = (st, d) => up.filter(q => q.region === st && q.dists.includes(d)).length;
  const rows = regions.map(st => [st, n(st, 'half'), n(st, 'full'), up.filter(q => q.region === st && q.temp).length, up.filter(q => q.region === st).length]);
  const thin = rows.filter(([st, h]) => h < 3).map(r => r[0]);
  const lines = ['# Coverage', '', `Upcoming races per state and province, from the build on ${TODAY}. Regions with fewer than 3 halves: ${thin.join(', ') || 'none'}.`, '', '| Region | Halves | Fulls | With temps | All races |', '|---|---:|---:|---:|---:|',
    ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} |`),
    `| **Total** | ${up.filter(q => q.dists.includes('half')).length} | ${up.filter(q => q.dists.includes('full')).length} | ${up.filter(q => q.temp).length} | ${up.length} |`, ''];
  fs.writeFileSync('COVERAGE.md', lines.join('\n'));
  console.log('coverage: thin half regions', thin.join(' '));
}
const off = races.filter(x => x.x < 0 || x.x > W || x.y < 0 || x.y > H);
console.log('off-map:', off.map(x => x.id));
